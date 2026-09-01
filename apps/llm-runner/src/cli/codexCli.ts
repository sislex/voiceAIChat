// LLM-клиент через Codex CLI: spawn('codex', ['exec', '--json', ...]) + построчный
// разбор JSONL. Аналог ClaudeCli; spawn инжектируется для тестов. Паритет по
// пробросу команд на агентов достигается MCP-конфигом (streamable HTTP). В режиме
// плана MCP не подключается, а локальный процесс жёстко ограничен read-only sandbox.

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { KANBAN_ASSISTANT_HINT, MAKE_ASSISTANT_HINT, kbToolHint, parseCodexActivity, parseCodexLine, previewToolHint } from '@voicechat/shared'
import type { LlmClient, LlmHandle, LlmRequest, LlmStreamHandlers } from '@voicechat/shared'
import { cliProfileEnv } from './cliProfiles.js'
import { killCliChild } from './childKill.js'

export type SpawnFn = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv }
) => ChildProcess

export interface CodexCliOptions {
  spawn?: SpawnFn
  /** Имя/путь бинаря. По умолчанию 'codex' (ищется в PATH). */
  binPath?: string
  /** Возвращает изолированный HOME владельца запроса. */
  profileHome?: (userId: string) => string
}

function describeSpawnError(err: unknown): string {
  const code = (err as { code?: string })?.code
  if (code === 'ENOENT') {
    return 'Codex CLI не найден. Установите Codex и выполните `codex login`.'
  }
  return `Не удалось запустить Codex CLI: ${err instanceof Error ? err.message : String(err)}`
}

function describeExit(code: number | null, stderr: string): string {
  const s = stderr.trim()
  if (/log ?in|not logged|authenticat|unauthor|credential/i.test(s)) {
    return 'Похоже, вход в Codex не выполнен. Выполните `codex login` в терминале.'
  }
  return `Codex CLI завершился с кодом ${code}${s ? `: ${s}` : ''}`
}

/** permissionMode → sandbox-флаги codex (для НЕ-remote выполнения). */
function sandboxArgs(permissionMode?: string): string[] {
  switch (permissionMode) {
    case 'plan':
      return ['--sandbox', 'read-only']
    case 'acceptEdits':
      return ['--sandbox', 'workspace-write']
    case 'bypassPermissions':
    default:
      return ['--dangerously-bypass-approvals-and-sandbox']
  }
}

/**
 * argv и текст промпта для `codex exec`: sandbox-флаги, MCP-серверы и добавки к
 * промпту (у codex нет `--append-system-prompt`, поэтому инструкции идут в сам
 * текст). Зовут двое: класс `CodexCli` и сырой ран исполнителя (`run/rawRun.ts`).
 * Промпт всегда уходит через stdin — см. комментарий про ARG_MAX ниже.
 */
export function codexInvocation(req: LlmRequest): { args: string[]; prompt: string } {
  // Проброс команд на агента: MCP-инструмент вместо локального shell.
  let prompt = req.prompt
  const args = ['exec', '--json', '--skip-git-repo-check']
  if (req.model) args.push('-m', req.model)
  if (req.cwd) args.push('-C', req.cwd)

  if (req.executionDisabled) {
    prompt =
      `Для этого сообщения машина не выбрана. Не выполняй shell-команды и не запускай команды никаким способом.\n\n${prompt}`
  }

  // База знаний подключается ДО ветвления plan/remote: она read-only, глушить
  // её в режиме «План» незачем — наоборот, там она главный источник контекста.
  if (req.kbMcpUrl) {
    args.push('-c', `mcp_servers.kb.url="${req.kbMcpUrl}"`)
    prompt = `${kbToolHint(req.kbMode ?? 'auto')}\n\n${prompt}`
  }

  // Панель веб-превью пользователя: действия выполняет браузер клиента, машина
  // и sandbox не при чём — подключается до ветвления plan/remote, как БЗ.
  if (req.previewMcpUrl) {
    args.push('-c', `mcp_servers.browser.url="${req.previewMcpUrl}"`)
    prompt = `${previewToolHint()}\n\n${prompt}`
  }

  // «Консоль с ассистентом»: живой PTY-терминал пользователя как MCP-инструменты.
  if (req.consoleMcpUrl) {
    args.push('-c', `mcp_servers.console.url="${req.consoleMcpUrl}"`)
    prompt =
      'Инструмент «Консоль»: справа открыт живой терминал пользователя, работай в нём. Смотри console_context и console_read, ' +
      'в обычном shell выполняй console_run, в полноэкранном TUI (altScreen) — console_keys/console_input. ' +
      'Все команды, которые пользователь просит выполнить на машине, выполняй в этой консоли (console_run) — он должен видеть их и их вывод. Инструменты машины в обход консоли (mcp__remote__bash и подобные) используй только когда пользователь явно попросил сделать что-то «в фоне»/«незаметно»/«не в консоли». ' +
      'Необратимые команды — только с согласия пользователя и confirm=true.\n\n' + prompt
  }

  // Make: файлы проекта разговора как MCP-инструменты.
  if (req.makeMcpUrl) {
    args.push('-c', `mcp_servers.make.url="${req.makeMcpUrl}"`)
    prompt = MAKE_ASSISTANT_HINT + '\n\n' + prompt
  }

  // Связанные с задачей Make-проекты: независимые read-only MCP-серверы.
  for (const source of req.makeSources ?? []) {
    args.push('-c', `mcp_servers.${source.name}.url="${source.mcpUrl}"`)
    const start = source.paths.includes('') ? 'проект целиком' : `стартовые пути: ${source.paths.join(', ')}`
    prompt = `Read-only Make-источник ${source.name} (${source.conversationId}), ${start}. Начни с указанных путей, но make_list_files/make_read_file читают весь проект. Ошибку связывай с ${source.name} и ${source.conversationId}; не проси id или index.html.\n\n${prompt}`
  }

  // Канбан: доска и проектное API разговора как MCP-инструменты.
  if (req.kanbanMcpUrl) {
    args.push('-c', `mcp_servers.kanban.url="${req.kanbanMcpUrl}"`)
    prompt = KANBAN_ASSISTANT_HINT + '\n\n' + prompt
  }

  if (req.remote && req.permissionMode !== 'plan') {
    // В режиме разработки пробрасываем команды на агента через MCP. Для remote
    // нужен bypass: иначе codex exec отменяет вызовы инструментов как user cancelled.
    args.push(
      '-c',
      `mcp_servers.remote.url="${req.remote.mcpUrl}"`,
      '--dangerously-bypass-approvals-and-sandbox'
    )
    prompt =
      `Локальный shell недоступен: команды — только MCP remote:bash на машине «${req.remote.agentName}»; ` +
      `для долгих команд передавай timeout_ms (120000 по умолчанию, максимум 300000). ` +
      `Файлы: remote:read, remote:grep, remote:edit; не используй bash для cat/sed/head/tail или heredoc. ` +
      `Мост отклонит файловое чтение bash и подскажет read; пайплайны, grep -r и подстановки разрешены. ` +
      `Изображения открывай через remote:image: относительное имя разрешается как вложение чата → cwd хода → директория проекта → абсолютный путь. ` +
      `Его типизированный image-блок можно визуально читать и напрямую передавать image-инструментам без повторного вложения. ` +
      `Не выводи base64 и не используй публичные файлообменники. Отличай «файл не найден» от «файл найден, но формат не поддерживается». ` +
      `Результат сохраняй отдельным файлом рядом с оригиналом или в .generated_images и показывай блоком image. ` +
      `Независимые чтения и поиски объединяй в один вызов, не перечитывай уже полученный файл.` +
      (req.readOnlyRemote
        ? `\nРежим «План»: только read/grep, ls и git log/diff/status; любые изменения запрещены.`
        : '') +
      (req.remote.projectMachines?.length
        ? `\nДоступны и другие машины проекта: ${req.remote.projectMachines.map((n) => `«${n}»`).join(', ')}. ` +
          `Список и онлайн-статус — инструмент remote:machines; чтобы выполнить команду или файловую операцию ` +
          `на другой машине, передай её имя параметром machine (без него операция идёт на выбранной машине).`
        : '') +
      (req.remote.policySummary ? `\n${req.remote.policySummary}` : '') +
      `\n\n${prompt}`
  } else {
    // План — жёстко read-only. Особенно важно не подключать remote MCP: его bash
    // выполняется вне локального sandbox и раньше позволял Codex менять файлы.
    args.push(...sandboxArgs(req.permissionMode))
    if (req.remote && req.permissionMode === 'plan') {
      prompt =
        `Режим «План»: только исследуй и составляй план. Не изменяй файлы и не выполняй ` +
        `команды на машине пользователя. Удалённые инструменты намеренно недоступны.\n\n${prompt}`
    }
  }

  // Prompt всегда читается из stdin (`-`), а не передаётся argv: полный контекст
  // Claude Code со схемами tools легко превышает системный ARG_MAX (spawn E2BIG).
  if (req.sessionId) args.push('resume', req.sessionId)
  args.push('-')
  return { args, prompt }
}

export class CodexCli implements LlmClient {
  constructor(private readonly opts: CodexCliOptions = {}) {}

  send(req: LlmRequest, handlers: LlmStreamHandlers): LlmHandle {
    const spawnFn = this.opts.spawn ?? (nodeSpawn as unknown as SpawnFn)

    const { args, prompt } = codexInvocation(req)

    let finished = false
    let stderr = ''
    let acc = '' // накопленный текст ответа (agent_message)
    let lastMeta: import('@voicechat/shared').TurnMeta | undefined

    const fail = (message: string): void => {
      if (finished) return
      finished = true
      handlers.onError(message)
    }
    const done = (text: string): void => {
      if (finished) return
      finished = true
      handlers.onDone(text, lastMeta)
    }

    let child: ChildProcess
    try {
      const home = req.userId ? this.opts.profileHome?.(req.userId) : undefined
      const spawnOptions =
        req.cwd || home
          ? { ...(req.cwd ? { cwd: req.cwd } : {}), ...(home ? { env: cliProfileEnv(home) } : {}) }
          : undefined
      child = spawnFn(this.opts.binPath ?? 'codex', args, spawnOptions)
    } catch (err) {
      fail(describeSpawnError(err))
      return { cancel: () => {} }
    }

    // Передаём потенциально многомегабайтный prompt через pipe без лимита argv.
    try {
      child.stdin?.end(prompt)
    } catch {
      /* stdin недоступен */
    }

    child.on('error', (err) => fail(describeSpawnError(err)))
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
    })

    if (child.stdout) {
      const rl = createInterface({ input: child.stdout })
      rl.on('line', (line) => {
        if (handlers.onActivity) {
          const entry = parseCodexActivity(line)
          if (entry) handlers.onActivity(entry)
        }
        const ev = parseCodexLine(line)
        if (!ev) return
        switch (ev.kind) {
          case 'session':
            handlers.onSession(ev.sessionId)
            break
          case 'delta':
            acc += ev.text
            if (!finished) handlers.onDelta(ev.text)
            break
          case 'message':
            // Полное сообщение агента: показываем как дельту и копим для финала.
            acc += ev.text
            if (!finished) handlers.onDelta(ev.text)
            break
          case 'result':
            lastMeta = ev.meta
            // `codex exec --json` сообщает точный usage в turn.completed. Он не
            // даёт промежуточных token-событий, но итог всё равно проводим через
            // общий live-канал до done, чтобы UI и TurnManager получили счётчики.
            if (!ev.isError && handlers.onUsage && Object.keys(ev.meta).length > 0) {
              handlers.onUsage(ev.meta)
            }
            if (ev.isError) fail('Codex вернул ошибку')
            else done(acc)
            break
          case 'error':
            fail(ev.message)
            break
          default:
            break
        }
      })
    }

    child.on('close', (code) => {
      if (finished) return
      if (code === 0) done(acc)
      else fail(describeExit(code, stderr))
    })

    return {
      cancel: () => {
        finished = true
        // SIGTERM, через 5с — SIGKILL: зависший CLI не должен переживать отмену.
        killCliChild(child)
      }
    }
  }
}

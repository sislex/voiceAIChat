// Реальный LLM-клиент через Claude Code CLI (Шаг 8).
// spawn('claude', ['-p', prompt, '--output-format', 'stream-json', ...]) + построчный
// разбор stream-json. spawn инжектируется для юнит-тестов.

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import {
  createUsageAccumulator,
  kbToolHint,
  parseStreamJsonActivity,
  parseStreamJsonLine,
  previewToolHint
} from '@voicechat/shared'
import type { LlmClient, LlmHandle, LlmRequest, LlmStreamHandlers } from '@voicechat/shared'
import { cliProfileEnv } from './cliProfiles.js'
import { killCliChild } from './childKill.js'

export type SpawnFn = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv }
) => ChildProcess

export interface ClaudeCliOptions {
  /** Инъекция spawn (для тестов). По умолчанию node:child_process.spawn. */
  spawn?: SpawnFn
  /** Имя/путь бинаря. По умолчанию 'claude' (ищется в PATH). */
  binPath?: string
  /** Возвращает изолированный HOME владельца запроса. */
  profileHome?: (userId: string) => string
}

function describeSpawnError(err: unknown): string {
  const code = (err as { code?: string })?.code
  if (code === 'ENOENT') {
    return 'Claude CLI не найден. Установите Claude Code и выполните `claude login`.'
  }
  return `Не удалось запустить Claude CLI: ${err instanceof Error ? err.message : String(err)}`
}

function describeExit(code: number | null, stderr: string): string {
  const s = stderr.trim()
  if (/log ?in|not logged|authenticat|unauthor|credential/i.test(s)) {
    return 'Похоже, вход в Claude не выполнен. Выполните `claude login` в терминале.'
  }
  return `Claude CLI завершился с кодом ${code}${s ? `: ${s}` : ''}`
}

/**
 * argv для `claude -p`: флаги хода, MCP-серверы, allow-list и добавки к
 * системному промпту. Отдельная функция, потому что её зовут двое: класс
 * `ClaudeCli` (разбор stream-json на месте) и сырой ран исполнителя
 * (`run/rawRun.ts`), который отдаёт строки stdout клиенту без разбора.
 */
export function claudeArgs(req: LlmRequest): string[] {
  const prompt = req.prompt
  const args = [
    '-p',
    prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--model',
    req.model
  ]
  if (req.permissionMode) args.push('--permission-mode', req.permissionMode)
  if (req.sessionId) args.push('--resume', req.sessionId)
  // MCP-серверы, allow-list и добавки к системному промпту собираются ВЫШЕ ветки
  // remote: база знаний подключается и в ходе без машины, а `--mcp-config` и
  // `--append-system-prompt` CLI принимает по одному разу — значит и склеивать
  // их надо в одном месте.
  const mcpServers: Record<string, { type: 'http'; url: string }> = {}
  const allowed: string[] = []
  // Единый список запрещённых инструментов: `--disallowedTools` CLI принимает один
  // раз, поэтому Bash и выключенные пользователем MCP-инструменты собираем сюда.
  const disallowed: string[] = []
  const systemHints: string[] = []
  if (req.executionDisabled) {
    disallowed.push('Bash')
    systemHints.push(
      'Для этого сообщения машина не выбрана. Не выполняй shell-команды и не пытайся запускать их каким-либо инструментом.'
    )
  }
  if (req.remote) {
    // Проброс Bash на машину пользователя: встроенный Bash выключаем, вместо него —
    // MCP-инструмент bash (сервер `remote`), который выполняет команду на агенте.
    // Опционально — сервер `ci`: именованные команды CI-справочника как инструмент.
    mcpServers.remote = { type: 'http', url: req.remote.mcpUrl }
    // Все инструменты сервера `remote`, а не только bash. В headless (`-p`)
    // `--allowedTools` — allow-list АВТООДОБРЕНИЯ: чего в нём нет, то не
    // отклоняется сервером, а просто не одобряется, и вызов не происходит.
    // Пока в списке был один bash, файловые инструменты (read/grep/edit) были
    // объявлены модели, но каждый их вызов упирался в неодобренное разрешение —
    // и модель возвращалась к `cat` внутри bash и правкам через heredoc, ради
    // отказа от которых их и делали.
    allowed.push('mcp__remote__bash', 'mcp__remote__read', 'mcp__remote__image', 'mcp__remote__grep', 'mcp__remote__edit')
    // Другие машины проекта: без упоминания в промпте модель знает только про
    // выбранную машину, а без allow-list вызов machines застрянет неодобренным.
    let machinesHint = ''
    if (req.remote.projectMachines?.length) {
      allowed.push('mcp__remote__machines')
      machinesHint =
        `\nДоступны и другие машины проекта: ${req.remote.projectMachines.map((n) => `«${n}»`).join(', ')}. ` +
        `Список и онлайн-статус — инструмент mcp__remote__machines; чтобы выполнить команду или файловую ` +
        `операцию на другой машине, передай её имя параметром machine (без него операция идёт на выбранной машине).`
    }
    let ciHint = ''
    if (req.remote.ciMcpUrl) {
      mcpServers.ci = { type: 'http', url: req.remote.ciMcpUrl }
      allowed.push('mcp__ci__run_command', 'mcp__ci__list_commands')
      ciHint =
        `\n\nДоступны именованные команды CI-справочника: инструмент mcp__ci__run_command ` +
        `(аргумент name), список — mcp__ci__list_commands.`
    }
    disallowed.push('Bash')
    systemHints.push(
      `Встроенный Bash отключён: команды выполняй только mcp__remote__bash на машине «${req.remote.agentName}». ` +
        `Для долгих команд передавай timeout_ms (120000 по умолчанию, максимум 300000). ` +
        `Файлы читай mcp__remote__read, ищи mcp__remote__grep, правь mcp__remote__edit; ` +
        `не используй bash для cat/sed или heredoc/python. мост отклонит файловое чтение bash ` +
        `и вернёт вызов mcp__remote__read. Пайплайны, grep -r и подстановки разрешены. ` +
        `Изображения открывай через mcp__remote__image: относительное имя разрешается как вложение чата → cwd хода → директория проекта → абсолютный путь. ` +
        `Его типизированный image-блок можно визуально читать и напрямую передавать image-инструментам без повторного вложения. ` +
        `Не выводи base64 и не используй публичные файлообменники. Отличай «файл не найден» от «файл найден, но формат не поддерживается». ` +
        `Результат сохраняй отдельным файлом рядом с оригиналом или в .generated_images и показывай блоком image. ` +
        `Независимые чтения и поиски объединяй в один вызов, не перечитывай уже полученный файл.` +
        (req.readOnlyRemote
          ? `\nРежим «План»: только чтение (read/grep, ls и git log/diff/status); правки, установки и сборки запрещены.`
          : '') +
        machinesHint +
        (req.remote.policySummary ? `\n${req.remote.policySummary}` : '') +
        ciHint
    )
  }
  if (req.kbMcpUrl) {
    mcpServers.kb = { type: 'http', url: req.kbMcpUrl }
    // РИСК: в headless (`-p`) `--allowedTools` работает как allow-list
    // автоодобрения. В ходе БЕЗ remote его сейчас не передают вовсе, и добавить
    // список ради одной БЗ нельзя: это выключило бы автоодобрение встроенных
    // Read/Grep. Поэтому там отдаём только `--mcp-config` и хинт. Деградация
    // безопасна: если вызов не одобрен, авто-инъекция в режиме auto продолжает
    // работать, а панель честно покажет 0 запросов модели.
    // Escape hatch на случай, если поведение CLI изменится: VC_KB_TOOL_ALLOWLIST=1.
    if (req.remote || process.env.VC_KB_TOOL_ALLOWLIST === '1') {
      allowed.push('mcp__kb__search', 'mcp__kb__document', 'mcp__kb__topics')
    }
    systemHints.push(kbToolHint(req.kbMode ?? 'auto'))
  }
  if (req.previewMcpUrl) {
    // Панель веб-превью пользователя: открыть URL, найти/кликнуть элемент,
    // ввести текст, прочитать DOM. Действия выполняет браузер клиента, поэтому
    // сервер `browser` подключается независимо от машины. Ограничение
    // allow-list — то же, что у БЗ выше: без remote флаг не передаётся вовсе.
    mcpServers.browser = { type: 'http', url: req.previewMcpUrl }
    if (req.remote || process.env.VC_KB_TOOL_ALLOWLIST === '1') {
      allowed.push('mcp__browser__open', 'mcp__browser__read', 'mcp__browser__find', 'mcp__browser__click', 'mcp__browser__type')
    }
    systemHints.push(previewToolHint())
  }
  // Выключенные пользователем MCP-инструменты: запрещаем и убираем из allow-list.
  if (req.disallowedTools?.length) disallowed.push(...req.disallowedTools)
  const finalAllowed = allowed.filter((tool) => !disallowed.includes(tool))
  if (Object.keys(mcpServers).length) args.push('--mcp-config', JSON.stringify({ mcpServers }))
  if (finalAllowed.length) args.push('--allowedTools', finalAllowed.join(','))
  if (disallowed.length) args.push('--disallowedTools', disallowed.join(','))
  if (systemHints.length) args.push('--append-system-prompt', systemHints.join('\n\n'))
  return args
}

export class ClaudeCli implements LlmClient {
  constructor(private readonly opts: ClaudeCliOptions = {}) {}

  send(req: LlmRequest, handlers: LlmStreamHandlers): LlmHandle {
    const spawnFn = this.opts.spawn ?? (nodeSpawn as unknown as SpawnFn)

    const args = claudeArgs(req)

    let finished = false
    let sawResult = false
    let stderr = ''
    // Живые счётчики токенов: суммируем usage-события, дубли не рассылаем.
    const usageAcc = createUsageAccumulator()
    let lastUsageJson = ''

    const fail = (message: string): void => {
      if (finished) return
      finished = true
      handlers.onError(message)
    }
    const done = (text: string, meta?: import('@voicechat/shared').TurnMeta): void => {
      if (finished) return
      finished = true
      handlers.onDone(text, meta)
    }

    let child: ChildProcess
    try {
      const home = req.userId ? this.opts.profileHome?.(req.userId) : undefined
      const spawnOptions =
        req.cwd || home
          ? { ...(req.cwd ? { cwd: req.cwd } : {}), ...(home ? { env: cliProfileEnv(home) } : {}) }
          : undefined
      child = spawnFn(this.opts.binPath ?? 'claude', args, spawnOptions)
    } catch (err) {
      fail(describeSpawnError(err))
      return { cancel: () => {} }
    }

    child.on('error', (err) => fail(describeSpawnError(err)))
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
    })

    if (child.stdout) {
      const rl = createInterface({ input: child.stdout })
      rl.on('line', (line) => {
        // Параллельно: активность для режима консоли (только если запрошена).
        if (handlers.onActivity) {
          const entry = parseStreamJsonActivity(line)
          if (entry) handlers.onActivity(entry)
        }
        const ev = parseStreamJsonLine(line)
        if (!ev) return
        switch (ev.kind) {
          case 'session':
            handlers.onSession(ev.sessionId)
            if (ev.init) handlers.onInit?.(ev.init)
            break
          case 'delta':
            if (!finished) handlers.onDelta(ev.text)
            break
          case 'usage': {
            if (finished || !handlers.onUsage) break
            const total = usageAcc.add(ev)
            const json = JSON.stringify(total)
            if (json !== lastUsageJson) {
              lastUsageJson = json
              handlers.onUsage(total)
            }
            break
          }
          case 'result':
            sawResult = true
            if (ev.sessionId) handlers.onSession(ev.sessionId)
            if (ev.isError) fail(ev.text || 'Claude вернул ошибку')
            else done(ev.text, ev.meta)
            break
          default:
            break
        }
      })
    }

    child.on('close', (code) => {
      if (finished) return
      if (code === 0) {
        // Чистое завершение без result-строки — отдаём пустой ответ.
        done('')
      } else {
        fail(describeExit(code, stderr))
      }
      void sawResult
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

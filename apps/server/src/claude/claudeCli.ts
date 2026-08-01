// Реальный LLM-клиент через Claude Code CLI (Шаг 8).
// spawn('claude', ['-p', prompt, '--output-format', 'stream-json', ...]); строки
// stdout уходят в общий приёмник (llm/sinks.ts), который их и разбирает — тот же
// приёмник обслуживает исполнителя по HTTP. spawn инжектируется для юнит-тестов.

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { LlmClient, LlmHandle, LlmRequest, LlmStreamHandlers } from './types'
import { cliProfileEnv } from '../users/cliProfiles.js'
import { killCliChild } from './childKill.js'
import { kbToolHint } from '../kb/kbMcp.js'
import { createClaudeSink } from '../llm/sinks.js'

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

export class ClaudeCli implements LlmClient {
  constructor(private readonly opts: ClaudeCliOptions = {}) {}

  send(req: LlmRequest, handlers: LlmStreamHandlers): LlmHandle {
    const spawnFn = this.opts.spawn ?? (nodeSpawn as unknown as SpawnFn)
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
    const systemHints: string[] = []
    if (req.executionDisabled) {
      args.push('--disallowedTools', 'Bash')
      systemHints.push(
        'Для этого сообщения машина не выбрана. Не выполняй shell-команды и не пытайся запускать их каким-либо инструментом.'
      )
    }
    if (req.remote) {
      // Проброс Bash на машину пользователя: встроенный Bash выключаем, вместо него —
      // MCP-инструмент bash (сервер `remote`), который выполняет команду на агенте.
      // Опционально — сервер `ci`: именованные команды CI-справочника как инструмент.
      mcpServers.remote = { type: 'http', url: req.remote.mcpUrl }
      allowed.push('mcp__remote__bash')
      let ciHint = ''
      if (req.remote.ciMcpUrl) {
        mcpServers.ci = { type: 'http', url: req.remote.ciMcpUrl }
        allowed.push('mcp__ci__run_command', 'mcp__ci__list_commands')
        ciHint =
          `\n\nДоступны именованные команды CI-справочника: инструмент mcp__ci__run_command ` +
          `(аргумент name), список — mcp__ci__list_commands.`
      }
      args.push('--disallowedTools', 'Bash')
      systemHints.push(
        `Встроенный инструмент Bash отключён. Все shell-команды выполняй инструментом ` +
          `mcp__remote__bash — они выполняются на машине пользователя «${req.remote.agentName}», ` +
          `а не на сервере. У инструмента есть аргумент timeout_ms (по умолчанию 120000, ` +
          `максимум 300000) — для долгих команд (тесты, сборка, установка зависимостей) ` +
          `передавай его явно, иначе получишь таймаут на середине.` +
          (req.readOnlyRemote
            ? `\n\nРежим «План»: только исследование. Читай файлы и историю (ls, cat, grep, ` +
              `git log/diff/status), но ничего не меняй — правки, установки и сборки будут отклонены.`
            : '') +
          (req.remote.policySummary ? `\n\n${req.remote.policySummary}` : '') +
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
    if (Object.keys(mcpServers).length) args.push('--mcp-config', JSON.stringify({ mcpServers }))
    if (allowed.length) args.push('--allowedTools', allowed.join(','))
    if (systemHints.length) args.push('--append-system-prompt', systemHints.join('\n\n'))

    // Разбор потока и тексты ошибок — в общем приёмнике (llm/sinks.ts): его же
    // использует RemoteLlmClient, поэтому события хода одинаковы для spawn и HTTP.
    const sink = createClaudeSink(handlers)

    let child: ChildProcess
    try {
      const home = req.userId ? this.opts.profileHome?.(req.userId) : undefined
      const spawnOptions =
        req.cwd || home
          ? { ...(req.cwd ? { cwd: req.cwd } : {}), ...(home ? { env: cliProfileEnv(home) } : {}) }
          : undefined
      child = spawnFn(this.opts.binPath ?? 'claude', args, spawnOptions)
    } catch (err) {
      sink.fail(describeSpawnError(err))
      return { cancel: () => {} }
    }

    child.on('error', (err) => sink.fail(describeSpawnError(err)))
    child.stderr?.on('data', (d: Buffer) => {
      sink.stderrChunk(d.toString())
    })

    if (child.stdout) {
      const rl = createInterface({ input: child.stdout })
      rl.on('line', (line) => sink.line(line))
    }

    child.on('close', (code) => sink.exit(code))

    return {
      cancel: () => {
        sink.detach()
        // SIGTERM, через 5с — SIGKILL: зависший CLI не должен переживать отмену.
        killCliChild(child)
      }
    }
  }
}

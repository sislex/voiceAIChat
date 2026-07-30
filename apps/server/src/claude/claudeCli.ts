// Реальный LLM-клиент через Claude Code CLI (Шаг 8).
// spawn('claude', ['-p', prompt, '--output-format', 'stream-json', ...]) + построчный
// разбор stream-json. spawn инжектируется для юнит-тестов.

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createUsageAccumulator, parseStreamJsonLine, parseStreamJsonActivity } from '@voicechat/shared'
import type { LlmClient, LlmHandle, LlmRequest, LlmStreamHandlers } from './types'
import { cliProfileEnv } from '../users/cliProfiles.js'

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
    if (req.executionDisabled) {
      args.push(
        '--disallowedTools',
        'Bash',
        '--append-system-prompt',
        'Для этого сообщения машина не выбрана. Не выполняй shell-команды и не пытайся запускать их каким-либо инструментом.'
      )
    }
    if (req.remote) {
      // Проброс Bash на машину пользователя: встроенный Bash выключаем, вместо него —
      // MCP-инструмент bash (сервер `remote`), который выполняет команду на агенте.
      // Опционально — сервер `ci`: именованные команды CI-справочника как инструмент.
      const mcpServers: Record<string, { type: 'http'; url: string }> = {
        remote: { type: 'http', url: req.remote.mcpUrl }
      }
      const allowed = ['mcp__remote__bash']
      let ciHint = ''
      if (req.remote.ciMcpUrl) {
        mcpServers.ci = { type: 'http', url: req.remote.ciMcpUrl }
        allowed.push('mcp__ci__run_command', 'mcp__ci__list_commands')
        ciHint =
          `\n\nДоступны именованные команды CI-справочника: инструмент mcp__ci__run_command ` +
          `(аргумент name), список — mcp__ci__list_commands.`
      }
      args.push(
        '--mcp-config',
        JSON.stringify({ mcpServers }),
        '--disallowedTools',
        'Bash',
        '--allowedTools',
        allowed.join(','),
        '--append-system-prompt',
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
        try {
          child.kill('SIGTERM')
        } catch {
          /* уже завершён */
        }
      }
    }
  }
}

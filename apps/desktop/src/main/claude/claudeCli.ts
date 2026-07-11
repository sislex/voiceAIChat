// Реальный LLM-клиент через Claude Code CLI (Шаг 8).
// spawn('claude', ['-p', prompt, '--output-format', 'stream-json', ...]) + построчный
// разбор stream-json. spawn инжектируется для юнит-тестов.

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { parseStreamJsonLine } from './streamJson'
import { parseStreamJsonActivity } from '@shared/streamJson'
import type { LlmClient, LlmHandle, LlmRequest, LlmStreamHandlers } from './types'

export type SpawnFn = (
  command: string,
  args: string[],
  options?: { cwd?: string }
) => ChildProcess

export interface ClaudeCliOptions {
  /** Инъекция spawn (для тестов). По умолчанию node:child_process.spawn. */
  spawn?: SpawnFn
  /** Имя/путь бинаря. По умолчанию 'claude' (ищется в PATH). */
  binPath?: string
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
    if (req.sessionId) args.push('--resume', req.sessionId)

    let finished = false
    let sawResult = false
    let stderr = ''

    const fail = (message: string): void => {
      if (finished) return
      finished = true
      handlers.onError(message)
    }
    const done = (text: string): void => {
      if (finished) return
      finished = true
      handlers.onDone(text)
    }

    let child: ChildProcess
    try {
      child = spawnFn(this.opts.binPath ?? 'claude', args)
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
            break
          case 'delta':
            if (!finished) handlers.onDelta(ev.text)
            break
          case 'result':
            sawResult = true
            if (ev.sessionId) handlers.onSession(ev.sessionId)
            if (ev.isError) fail(ev.text || 'Claude вернул ошибку')
            else done(ev.text)
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

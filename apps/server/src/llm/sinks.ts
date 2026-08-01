// Приёмник потока CLI: разбор stream-json/JSONL, накопление usage, session_id и
// человеческие тексты ошибок — отдельно от СПОСОБА получить поток. Локальный
// spawn (claude/claudeCli.ts, codex/codexCli.ts) и HTTP-исполнитель
// (llm/remoteClient.ts) кормят один и тот же приёмник строками stdout/stderr и
// кодом выхода, поэтому события хода не зависят от транспорта.

import {
  createUsageAccumulator,
  parseCodexActivity,
  parseCodexLine,
  parseStreamJsonActivity,
  parseStreamJsonLine,
  type TurnMeta
} from '@voicechat/shared'
import type { LlmStreamHandlers } from '../claude/types.js'

export interface LlmStreamSink {
  /** Строка stdout CLI (stream-json у claude, JSONL у codex). */
  line(line: string): void
  /** Фрагмент stderr: им объясняется ненулевой код выхода. */
  stderrChunk(chunk: string): void
  /** Процесс завершился; null — убит сигналом. */
  exit(code: number | null): void
  /** Ошибка запуска/транспорта — текст уже человеческий. */
  fail(message: string): void
  /** Ход отменён или брошен: дальнейшие события игнорируются. */
  detach(): void
}

/** Общее для обоих CLI: ровно один финал (onDone|onError) и накопление stderr. */
function sinkCore(handlers: LlmStreamHandlers): {
  finished(): boolean
  stderr(): string
  stderrChunk(chunk: string): void
  fail(message: string): void
  done(text: string, meta?: TurnMeta): void
  detach(): void
} {
  let finished = false
  let stderr = ''
  return {
    finished: () => finished,
    stderr: () => stderr,
    stderrChunk: (chunk) => {
      stderr += chunk
    },
    fail: (message) => {
      if (finished) return
      finished = true
      handlers.onError(message)
    },
    done: (text, meta) => {
      if (finished) return
      finished = true
      handlers.onDone(text, meta)
    },
    detach: () => {
      finished = true
    }
  }
}

/** Ненулевой код claude: пробуем распознать «не залогинен» по stderr. */
export function describeClaudeExit(code: number | null, stderr: string): string {
  const s = stderr.trim()
  if (/log ?in|not logged|authenticat|unauthor|credential/i.test(s)) {
    return 'Похоже, вход в Claude не выполнен. Выполните `claude login` в терминале.'
  }
  return `Claude CLI завершился с кодом ${code}${s ? `: ${s}` : ''}`
}

/** Ненулевой код codex — аналогично. */
export function describeCodexExit(code: number | null, stderr: string): string {
  const s = stderr.trim()
  if (/log ?in|not logged|authenticat|unauthor|credential/i.test(s)) {
    return 'Похоже, вход в Codex не выполнен. Выполните `codex login` в терминале.'
  }
  return `Codex CLI завершился с кодом ${code}${s ? `: ${s}` : ''}`
}

/** Приёмник потока `claude -p --output-format stream-json`. */
export function createClaudeSink(handlers: LlmStreamHandlers): LlmStreamSink {
  const core = sinkCore(handlers)
  // Живые счётчики токенов: суммируем usage-события, дубли не рассылаем.
  const usageAcc = createUsageAccumulator()
  let lastUsageJson = ''
  return {
    line: (line) => {
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
          if (!core.finished()) handlers.onDelta(ev.text)
          break
        case 'usage': {
          if (core.finished() || !handlers.onUsage) break
          const total = usageAcc.add(ev)
          const json = JSON.stringify(total)
          if (json !== lastUsageJson) {
            lastUsageJson = json
            handlers.onUsage(total)
          }
          break
        }
        case 'result':
          if (ev.sessionId) handlers.onSession(ev.sessionId)
          if (ev.isError) core.fail(ev.text || 'Claude вернул ошибку')
          else core.done(ev.text, ev.meta)
          break
        default:
          break
      }
    },
    stderrChunk: core.stderrChunk,
    exit: (code) => {
      if (core.finished()) return
      // Чистое завершение без result-строки — отдаём пустой ответ.
      if (code === 0) core.done('')
      else core.fail(describeClaudeExit(code, core.stderr()))
    },
    fail: core.fail,
    detach: core.detach
  }
}

/** Приёмник потока `codex exec --json`. */
export function createCodexSink(handlers: LlmStreamHandlers): LlmStreamSink {
  const core = sinkCore(handlers)
  let acc = '' // накопленный текст ответа (agent_message)
  let lastMeta: TurnMeta | undefined
  return {
    line: (line) => {
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
        // Полное сообщение агента: показываем как дельту и копим для финала.
        case 'message':
          acc += ev.text
          if (!core.finished()) handlers.onDelta(ev.text)
          break
        case 'result':
          lastMeta = ev.meta
          // `codex exec --json` сообщает точный usage в turn.completed. Он не
          // даёт промежуточных token-событий, но итог всё равно проводим через
          // общий live-канал до done, чтобы UI и TurnManager получили счётчики.
          if (!ev.isError && handlers.onUsage && Object.keys(ev.meta).length > 0) {
            handlers.onUsage(ev.meta)
          }
          if (ev.isError) core.fail('Codex вернул ошибку')
          else core.done(acc, lastMeta)
          break
        case 'error':
          core.fail(ev.message)
          break
        default:
          break
      }
    },
    stderrChunk: core.stderrChunk,
    exit: (code) => {
      if (core.finished()) return
      if (code === 0) core.done(acc, lastMeta)
      else core.fail(describeCodexExit(code, core.stderr()))
    },
    fail: core.fail,
    detach: core.detach
  }
}

/** Приёмник по виду CLI. */
export function createSink(kind: 'claude' | 'codex', handlers: LlmStreamHandlers): LlmStreamSink {
  return kind === 'codex' ? createCodexSink(handlers) : createClaudeSink(handlers)
}

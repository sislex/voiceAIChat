// Протокол контейнера-исполнителя LLM (v1). Сервер больше не делает spawn: он
// открывает ход по HTTP, а исполнитель отдаёт СЫРЫЕ строки stdout/stderr CLI —
// разбор stream-json/JSONL, usage и session_id остаются на сервере (см. sinks.ts).
// План целиком: docs/plans/llm-runners.md.
//
// Формат ответа POST /v1/run — NDJSON, по одному конверту в строке:
//   {"t":"out","s":"{\"type\":\"system\",...}"}   строка stdout CLI
//   {"t":"err","s":"..."}                          фрагмент stderr
//   {"t":"exit","code":0}                          процесс завершился (null — сигнал)

import type { LlmRequest } from '../claude/types.js'

/** Какой CLI просят запустить: от этого зависит парсер строк и тексты ошибок. */
export type RunnerKind = 'claude' | 'codex'

/** Тело POST /v1/run: id хода (его же ждёт DELETE) + сериализованный запрос. */
export interface RunnerRunBody {
  /** id рана генерирует СЕРВЕР — иначе отмена до первого байта была бы невозможна. */
  id: string
  kind: RunnerKind
  request: LlmRequest
}

/** Конверт строки NDJSON из потока /v1/run. */
export type RunnerStreamEvent =
  | { t: 'out'; s: string }
  | { t: 'err'; s: string }
  | { t: 'exit'; code: number | null }

export const RUNNER_RUN_PATH = '/v1/run'
export const RUNNER_HEALTH_PATH = '/v1/health'

/** База URL исполнителя без хвостового слэша ('' для пустой строки). */
export function runnerBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

/** URL запуска хода. */
export function runnerRunUrl(baseUrl: string): string {
  return `${runnerBase(baseUrl)}${RUNNER_RUN_PATH}`
}

/** URL отмены конкретного хода. */
export function runnerCancelUrl(baseUrl: string, id: string): string {
  return `${runnerRunUrl(baseUrl)}/${encodeURIComponent(id)}`
}

/**
 * Разбирает строку NDJSON исполнителя. Терпимо к мусору: пустые строки, битый
 * JSON и незнакомые конверты дают null — обрыв формата не должен ронять ход.
 */
export function parseRunnerLine(line: string): RunnerStreamEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  switch (obj.t) {
    case 'out':
    case 'err':
      return typeof obj.s === 'string' ? { t: obj.t, s: obj.s } : null
    case 'exit':
      return { t: 'exit', code: typeof obj.code === 'number' ? obj.code : null }
    default:
      return null
  }
}

// Протокол контейнера-исполнителя LLM (v1). Сервер больше не делает spawn: он
// открывает ход по HTTP, а исполнитель отдаёт СЫРЫЕ строки stdout/stderr CLI —
// разбор stream-json/JSONL, usage и session_id остаются на сервере (см. sinks.ts).
// План целиком: docs/plans/llm-runners.md.
//
// Формат ответа POST /v1/run — NDJSON, по одному конверту в строке:
//   {"t":"out","s":"{\"type\":\"system\",...}"}   строка stdout CLI
//   {"t":"err","s":"..."}                          фрагмент stderr
//   {"t":"exit","code":0}                          процесс завершился (null — сигнал)

import {
  LLM_RUNNER,
  parseLlmRunFrame,
  type LlmRunBody,
  type LlmRunFrame,
  type LlmRunKind
} from '@voicechat/shared'

/** Какой CLI просят запустить: от этого зависит парсер строк и тексты ошибок. */
export type RunnerKind = LlmRunKind

/**
 * Тело POST /v1/run. Форму диктует `packages/shared` и проверяет сам исполнитель:
 * поля запроса лежат ПЛОСКО (`prompt`, `model`, `sessionId`, …), рядом `kind` и
 * `runId`. Вложенный конверт `{ id, kind, request }` исполнитель отвергает с
 * `400 prompt обязателен` — поэтому тип здесь только псевдоним общего.
 */
export type RunnerRunBody = LlmRunBody

/** Конверт строки NDJSON из потока /v1/run. */
export type RunnerStreamEvent = LlmRunFrame

export const RUNNER_RUN_PATH = LLM_RUNNER.run
export const RUNNER_HEALTH_PATH = LLM_RUNNER.health

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
export const parseRunnerLine = parseLlmRunFrame

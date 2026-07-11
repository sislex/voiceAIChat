// Парсер потока stream-json от `claude -p --output-format stream-json` (Шаг 8).
// Чистая функция построчного разбора — тестируется на фикстурах строк.
//
// Формат (claude-code 2.x):
//   {"type":"system","subtype":"init","session_id":"...",...}
//   {"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}},...}
//   {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]},...}
//   {"type":"result","subtype":"success","is_error":false,"result":"...","session_id":"..."}

import type { TurnMeta } from '@shared/types'

export type ClaudeStreamEvent =
  | { kind: 'session'; sessionId: string }
  | { kind: 'delta'; text: string }
  | { kind: 'result'; text: string; sessionId?: string; isError: boolean; meta: TurnMeta }
  | { kind: 'ignore' }

/** Достаёт метаданные хода из result-объекта stream-json. */
function parseTurnMeta(obj: Record<string, unknown>): TurnMeta {
  const meta: TurnMeta = {}
  if (typeof obj.duration_ms === 'number') meta.durationMs = obj.duration_ms
  if (typeof obj.num_turns === 'number') meta.numTurns = obj.num_turns
  if (typeof obj.total_cost_usd === 'number') meta.costUsd = obj.total_cost_usd
  const usage = obj.usage as { input_tokens?: unknown; output_tokens?: unknown } | undefined
  if (usage && typeof usage.input_tokens === 'number') meta.inputTokens = usage.input_tokens
  if (usage && typeof usage.output_tokens === 'number') meta.outputTokens = usage.output_tokens
  return meta
}

/**
 * Разбирает одну строку NDJSON. Возвращает событие или null для мусора/пустых
 * строк (невалидный JSON не должен ронять парсинг потока).
 */
export function parseStreamJsonLine(line: string): ClaudeStreamEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(trimmed)
  } catch {
    return null
  }

  switch (obj.type) {
    case 'system': {
      if (obj.subtype === 'init' && typeof obj.session_id === 'string') {
        return { kind: 'session', sessionId: obj.session_id }
      }
      return { kind: 'ignore' }
    }
    case 'stream_event': {
      const event = obj.event as { type?: string; delta?: { type?: string; text?: string } } | undefined
      if (
        event?.type === 'content_block_delta' &&
        event.delta?.type === 'text_delta' &&
        typeof event.delta.text === 'string'
      ) {
        return { kind: 'delta', text: event.delta.text }
      }
      return { kind: 'ignore' }
    }
    case 'result': {
      return {
        kind: 'result',
        text: typeof obj.result === 'string' ? obj.result : '',
        sessionId: typeof obj.session_id === 'string' ? obj.session_id : undefined,
        isError: obj.is_error === true || obj.subtype === 'error_during_execution',
        meta: parseTurnMeta(obj)
      }
    }
    default:
      return { kind: 'ignore' }
  }
}

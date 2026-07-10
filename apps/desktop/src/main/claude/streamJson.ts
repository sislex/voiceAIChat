// Парсер потока stream-json от `claude -p --output-format stream-json` (Шаг 8).
// Чистая функция построчного разбора — тестируется на фикстурах строк.
//
// Формат (claude-code 2.x):
//   {"type":"system","subtype":"init","session_id":"...",...}
//   {"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}},...}
//   {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]},...}
//   {"type":"result","subtype":"success","is_error":false,"result":"...","session_id":"..."}

export type ClaudeStreamEvent =
  | { kind: 'session'; sessionId: string }
  | { kind: 'delta'; text: string }
  | { kind: 'result'; text: string; sessionId?: string; isError: boolean }
  | { kind: 'ignore' }

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
        isError: obj.is_error === true || obj.subtype === 'error_during_execution'
      }
    }
    default:
      return { kind: 'ignore' }
  }
}

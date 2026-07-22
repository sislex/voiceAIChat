// Парсер JSONL-потока от `codex exec --json`. Чистые функции построчного
// разбора — тестируются на фикстурах строк. Аналог streamJson.ts для Claude.
//
// Формат (codex-cli 0.x):
//   {"type":"thread.started","thread_id":"..."}
//   {"type":"turn.started"}
//   {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"..."}}
//   {"type":"turn.completed","usage":{"input_tokens":..,"output_tokens":..}}
//   (ошибки: {"type":"error","message":".."} / {"type":"turn.failed","error":{"message":".."}})

import type { ClaudeLogEntry, TurnMeta } from './types'

export type CodexStreamEvent =
  | { kind: 'session'; sessionId: string }
  | { kind: 'delta'; text: string } // потоковые токены, если codex их шлёт
  | { kind: 'message'; text: string } // завершённое сообщение агента (полный текст)
  | { kind: 'result'; meta: TurnMeta; isError: boolean }
  | { kind: 'error'; message: string }
  | { kind: 'ignore' }

function usageMeta(usage: unknown): TurnMeta {
  const meta: TurnMeta = {}
  const u = (usage ?? {}) as Record<string, unknown>
  if (typeof u.input_tokens === 'number') meta.inputTokens = u.input_tokens
  if (typeof u.output_tokens === 'number') meta.outputTokens = u.output_tokens
  return meta
}

/** Разбирает одну строку JSONL; null/ignore для мусора и незначимых событий. */
export function parseCodexLine(line: string): CodexStreamEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(trimmed)
  } catch {
    return null
  }

  switch (obj.type) {
    case 'thread.started':
      return typeof obj.thread_id === 'string'
        ? { kind: 'session', sessionId: obj.thread_id }
        : { kind: 'ignore' }
    case 'item.completed': {
      const item = (obj.item ?? {}) as Record<string, unknown>
      if (item.type === 'agent_message' && typeof item.text === 'string') {
        return { kind: 'message', text: item.text }
      }
      return { kind: 'ignore' }
    }
    case 'item.updated': {
      // Потоковые обновления сообщения (если появятся в будущих версиях).
      const item = (obj.item ?? {}) as Record<string, unknown>
      if (item.type === 'agent_message' && typeof item.delta === 'string') {
        return { kind: 'delta', text: item.delta }
      }
      return { kind: 'ignore' }
    }
    case 'turn.completed':
      return { kind: 'result', meta: usageMeta(obj.usage), isError: false }
    case 'turn.failed':
    case 'error': {
      const err = (obj.error ?? {}) as Record<string, unknown>
      const message =
        (typeof obj.message === 'string' && obj.message) ||
        (typeof err.message === 'string' && err.message) ||
        'Codex вернул ошибку'
      return { kind: 'error', message }
    }
    default:
      return { kind: 'ignore' }
  }
}

// --- Активность (режим консоли) ------------------------------------------

function truncate(s: string, n = 160): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/**
 * Разбирает строку в запись активности агента (панель консоли) или null для
 * незначимых строк. Терпит неизвестные типы item → 'other'.
 */
export function parseCodexActivity(line: string): ClaudeLogEntry | null {
  const raw = line.trim()
  if (!raw) return null
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(raw)
  } catch {
    return null
  }

  switch (obj.type) {
    case 'thread.started':
      return { kind: 'system', summary: 'Codex: сессия начата', raw }
    case 'turn.started':
    case 'turn.completed':
      return obj.type === 'turn.completed' ? { kind: 'result', summary: 'Готово', raw } : null
    case 'item.completed': {
      const item = (obj.item ?? {}) as Record<string, unknown>
      const t = item.type
      if (t === 'agent_message') return null // сам ответ — в консоли не дублируем
      if (t === 'reasoning' && typeof item.text === 'string') {
        return { kind: 'thinking', summary: `💭 ${truncate(item.text)}`, detail: item.text, raw }
      }
      if (t === 'command_execution') {
        const cmd = typeof item.command === 'string' ? item.command : safeJson(item)
        const out = typeof item.aggregated_output === 'string' ? item.aggregated_output : undefined
        return { kind: 'tool_use', summary: `$ ${truncate(cmd)}`, detail: out, raw }
      }
      if (t === 'mcp_tool_call') {
        const name = [item.server, item.tool].filter(Boolean).join(':') || 'mcp'
        return { kind: 'tool_use', summary: `${name}: ${truncate(safeJson(item.arguments ?? {}))}`, raw }
      }
      if (t === 'file_change' || t === 'patch') {
        return { kind: 'tool_use', summary: `Правка файлов: ${truncate(safeJson(item))}`, raw }
      }
      if (t === 'error') {
        const m = typeof item.message === 'string' ? item.message : safeJson(item)
        return { kind: 'tool_result', summary: `✗ ошибка: ${truncate(m)}`, detail: m, raw }
      }
      return { kind: 'other', summary: typeof t === 'string' ? t : 'событие', raw }
    }
    case 'error':
    case 'turn.failed':
      return { kind: 'result', summary: 'Ошибка', raw }
    default:
      return null
  }
}

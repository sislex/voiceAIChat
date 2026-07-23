// Парсер потока stream-json от `claude -p --output-format stream-json` (Шаг 8).
// Чистая функция построчного разбора — тестируется на фикстурах строк.
//
// Формат (claude-code 2.x):
//   {"type":"system","subtype":"init","session_id":"...",...}
//   {"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}},...}
//   {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]},...}
//   {"type":"result","subtype":"success","is_error":false,"result":"...","session_id":"..."}

import type { ClaudeInitInfo, ClaudeLogEntry, TurnMeta } from './types'

export type ClaudeStreamEvent =
  | { kind: 'session'; sessionId: string; init?: ClaudeInitInfo }
  | { kind: 'delta'; text: string }
  | { kind: 'result'; text: string; sessionId?: string; isError: boolean; meta: TurnMeta }
  | { kind: 'ignore' }

/** Массив строк из произвольного значения (для tools/slash_commands). */
function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const arr = value.filter((v): v is string => typeof v === 'string')
  return arr.length ? arr : undefined
}

/** Достаёт окружение хода из system/init-события. */
function parseInitInfo(obj: Record<string, unknown>): ClaudeInitInfo {
  const info: ClaudeInitInfo = {}
  const tools = stringArray(obj.tools)
  if (tools) info.tools = tools
  const slash = stringArray(obj.slash_commands)
  if (slash) info.slashCommands = slash
  // mcp_servers — массив объектов {name,...} либо строк.
  if (Array.isArray(obj.mcp_servers)) {
    const names = obj.mcp_servers
      .map((s) => (typeof s === 'string' ? s : (s as { name?: unknown })?.name))
      .filter((n): n is string => typeof n === 'string')
    if (names.length) info.mcpServers = names
  }
  if (typeof obj.model === 'string') info.model = obj.model
  if (typeof obj.cwd === 'string') info.cwd = obj.cwd
  if (typeof obj.permissionMode === 'string') info.permissionMode = obj.permissionMode
  return info
}

/** Достаёт метаданные хода из result-объекта stream-json. */
function parseTurnMeta(obj: Record<string, unknown>): TurnMeta {
  const meta: TurnMeta = {}
  if (typeof obj.duration_ms === 'number') meta.durationMs = obj.duration_ms
  if (typeof obj.num_turns === 'number') meta.numTurns = obj.num_turns
  if (typeof obj.total_cost_usd === 'number') meta.costUsd = obj.total_cost_usd
  const usage = obj.usage as { input_tokens?: unknown; output_tokens?: unknown } | undefined
  if (usage && typeof usage.input_tokens === 'number') meta.inputTokens = usage.input_tokens
  if (usage && typeof usage.output_tokens === 'number') meta.outputTokens = usage.output_tokens
  const u = usage as { cache_read_input_tokens?: unknown; cache_creation_input_tokens?: unknown } | undefined
  if (u && typeof u.cache_read_input_tokens === 'number') meta.cacheReadTokens = u.cache_read_input_tokens
  if (u && typeof u.cache_creation_input_tokens === 'number') {
    meta.cacheCreationTokens = u.cache_creation_input_tokens
  }
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
        return { kind: 'session', sessionId: obj.session_id, init: parseInitInfo(obj) }
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

// --- Разбор активности (режим консоли) -----------------------------------
// Параллельный разбор той же строки stream-json в читаемую запись активности.
// Не влияет на поток токенов выше; используется только когда включён verbose.

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

/** mcp__server__tool → server:tool (короткое имя MCP-инструмента для панели). */
function displayToolName(name: string): string {
  return name.replace(/^mcp__(.+?)__/, '$1:')
}

/** Краткое описание ввода инструмента (команда/путь/паттерн/url или сжатый JSON). */
function summarizeToolInput(input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  if (typeof i.command === 'string') return i.command
  if (typeof i.file_path === 'string') return i.file_path
  if (typeof i.path === 'string') return i.path
  if (typeof i.pattern === 'string') return i.pattern
  if (typeof i.url === 'string') return i.url
  if (typeof i.query === 'string') return i.query
  const keys = Object.keys(i)
  return keys.length ? truncate(safeJson(i)) : ''
}

/** Текст результата инструмента (строка либо массив блоков {type:'text',text}). */
function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string'
        ? (b as { text: string }).text
        : ''))
      .join('')
  }
  return content == null ? '' : safeJson(content)
}

/**
 * Разбирает строку stream-json в запись активности агента (для панели консоли) или
 * null для шумных/незначимых строк (партиалы-токены, пустые/битые). Каждая запись
 * несёт `raw` — исходную строку для раскрытия «как в консоли».
 */
export function parseStreamJsonActivity(line: string): ClaudeLogEntry | null {
  const raw = line.trim()
  if (!raw) return null

  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(raw)
  } catch {
    return null
  }

  switch (obj.type) {
    case 'system': {
      if (obj.subtype !== 'init') return null
      const model = typeof obj.model === 'string' ? obj.model : '?'
      const parts = [`модель ${model}`]
      if (typeof obj.permissionMode === 'string') parts.push(`режим ${obj.permissionMode}`)
      if (Array.isArray(obj.tools)) parts.push(`инструментов ${obj.tools.length}`)
      const detail = typeof obj.cwd === 'string' ? `cwd: ${obj.cwd}` : undefined
      return { kind: 'system', summary: `Сессия: ${parts.join(' · ')}`, detail, raw }
    }
    case 'assistant': {
      const content = (obj.message as { content?: unknown } | undefined)?.content
      if (!Array.isArray(content)) return null
      for (const block of content as Array<Record<string, unknown>>) {
        if (block.type === 'tool_use' && typeof block.name === 'string') {
          const summary = `${displayToolName(block.name)}: ${truncate(summarizeToolInput(block.input))}`
          return { kind: 'tool_use', summary, detail: safeJson(block.input), raw }
        }
        if (block.type === 'thinking' && typeof block.thinking === 'string') {
          return { kind: 'thinking', summary: `💭 ${truncate(block.thinking)}`, detail: block.thinking, raw }
        }
      }
      return null // текстовые блоки — это сам ответ, в консоли не дублируем
    }
    case 'user': {
      const content = (obj.message as { content?: unknown } | undefined)?.content
      if (!Array.isArray(content)) return null
      for (const block of content as Array<Record<string, unknown>>) {
        if (block.type === 'tool_result') {
          const isError = block.is_error === true
          const text = toolResultText(block.content)
          const mark = isError ? '✗ ошибка' : '✓ результат'
          return { kind: 'tool_result', summary: `${mark}: ${truncate(text)}`, detail: text, raw }
        }
      }
      return null
    }
    case 'result': {
      const isError = obj.is_error === true || obj.subtype === 'error_during_execution'
      const dur = typeof obj.duration_ms === 'number' ? ` · ${Math.round(obj.duration_ms / 1000)}с` : ''
      const turns = typeof obj.num_turns === 'number' ? ` · ходов ${obj.num_turns}` : ''
      return { kind: 'result', summary: `${isError ? 'Ошибка' : 'Готово'}${dur}${turns}`, raw }
    }
    case 'stream_event':
      return null // партиалы-токены — шум для консоли
    default:
      return { kind: 'other', summary: typeof obj.type === 'string' ? obj.type : 'событие', raw }
  }
}

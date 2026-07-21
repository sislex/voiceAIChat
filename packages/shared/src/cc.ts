// Проводник Claude Code: типы и парсер persisted-транскриптов сессий.
// Источник — ~/.claude/projects/<слаг>/<session-id>.jsonl (по строке-событию).
// Чистые функции — тестируются на фикстурах строк.

import type { MessageRole } from './types'

/** Проект Claude Code (папка в ~/.claude/projects). */
export interface CcProject {
  /** Имя папки (слаг закодированного пути). */
  slug: string
  /** Реальный рабочий каталог (из поля cwd событий). */
  path: string
  /** Короткое имя (basename пути). */
  name: string
  /** Число сессий (jsonl-файлов). */
  sessionCount: number
  /** Время последней активности (mtime новейшей сессии, мс). */
  lastActivity: number
}

/** Сессия (один разговор Claude Code). */
export interface CcSession {
  /** session-id (имя файла без .jsonl). */
  id: string
  /** Заголовок — первая реплика пользователя (обрезанная). */
  title: string
  /** Время изменения (mtime, мс). */
  updatedAt: number
  /** Размер файла в байтах. */
  sizeBytes: number
}

export type CcItemKind = 'user' | 'assistant' | 'thinking' | 'tool_use' | 'tool_result' | 'other'

/** Одна запись транскрипта (плоско: по блоку контента). */
export interface CcItem {
  kind: CcItemKind
  /** Читаемый текст записи. */
  text: string
  /** Момент времени (мс), если известен. */
  ts?: number
  /** Признак ошибки (для tool_result). */
  isError?: boolean
}

function truncate(s: string, n = 4000): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

/** Краткий ввод инструмента (как в панели консоли). */
function toolInputBrief(name: string, input: unknown): string {
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>
    if (name === 'Bash' && typeof o.command === 'string') return o.command
    for (const k of ['file_path', 'path', 'pattern', 'url', 'query', 'prompt']) {
      if (typeof o[k] === 'string') return o[k] as string
    }
    try {
      return truncate(JSON.stringify(o), 200)
    } catch {
      return ''
    }
  }
  return input == null ? '' : String(input)
}

/** Текст из tool_result.content (строка или массив блоков {type:'text',text}). */
function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : ''))
      .join('')
  }
  return content == null ? '' : JSON.stringify(content)
}

/** Разбирает одну строку транскрипта в записи (0..N — assistant может дать несколько блоков). */
export function parseCcLine(line: string): CcItem[] {
  const trimmed = line.trim()
  if (!trimmed) return []
  let o: Record<string, unknown>
  try {
    o = JSON.parse(trimmed)
  } catch {
    return []
  }
  const ts = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) || undefined : undefined
  const msg = (o.message && typeof o.message === 'object' ? o.message : {}) as Record<string, unknown>
  const content = msg.content

  if (o.type === 'user') {
    if (typeof content === 'string') {
      const t = content.trim()
      return t ? [{ kind: 'user', text: t, ts }] : []
    }
    if (Array.isArray(content)) {
      const items: CcItem[] = []
      for (const b of content) {
        if (!b || typeof b !== 'object') continue
        const block = b as Record<string, unknown>
        if (block.type === 'tool_result') {
          items.push({
            kind: 'tool_result',
            text: truncate(toolResultText(block.content).trim()),
            ts,
            isError: block.is_error === true
          })
        } else if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          items.push({ kind: 'user', text: block.text.trim(), ts })
        }
      }
      return items
    }
    return []
  }

  if (o.type === 'assistant' && Array.isArray(content)) {
    const items: CcItem[] = []
    for (const b of content) {
      if (!b || typeof b !== 'object') continue
      const block = b as Record<string, unknown>
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        items.push({ kind: 'assistant', text: block.text.trim(), ts })
      } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
        items.push({ kind: 'thinking', text: truncate(block.thinking.trim()), ts })
      } else if (block.type === 'tool_use' && typeof block.name === 'string') {
        items.push({ kind: 'tool_use', text: `${block.name}: ${toolInputBrief(block.name, block.input)}`.trim(), ts })
      }
    }
    return items
  }

  // queue-operation / attachment / last-prompt / summary / system — пропускаем.
  return []
}

/** Разбирает весь транскрипт (jsonl-текст) в плоский список записей. */
export function parseCcTranscript(text: string): CcItem[] {
  const out: CcItem[] = []
  for (const line of text.split(/\r?\n/)) {
    for (const item of parseCcLine(line)) out.push(item)
  }
  return out
}

/** Первая реплика пользователя из «головы» транскрипта — как заголовок сессии. */
export function ccSessionTitle(headText: string, max = 80): string {
  for (const line of headText.split(/\r?\n/)) {
    const items = parseCcLine(line)
    const user = items.find((i) => i.kind === 'user')
    if (user) {
      const t = user.text.replace(/\s+/g, ' ').trim()
      return t.length > max ? `${t.slice(0, max)}…` : t
    }
  }
  return 'Без названия'
}

// --- Продолжение сессии в приложении -------------------------------------
// Импорт видимой истории сессии CC в ленту разговора приложения + привязка к
// session-id (дальше ход идёт через `claude --resume <session-id>`).

/** Одна реплика для импорта в разговор приложения. */
export interface CcResumeMessage {
  role: MessageRole
  text: string
  /** Момент времени исходной записи (мс), если известен. */
  ts?: number
}

/** Отбирает из транскрипта видимые реплики (user/assistant) для ленты чата. */
export function ccResumeMessages(items: CcItem[]): CcResumeMessage[] {
  const out: CcResumeMessage[] = []
  for (const i of items) {
    if (i.kind === 'user') out.push({ role: 'u1', text: i.text, ts: i.ts })
    else if (i.kind === 'assistant') out.push({ role: 'ai', text: i.text, ts: i.ts })
  }
  return out
}

/** Заголовок разговора-продолжения — первая реплика пользователя из транскрипта. */
export function ccResumeTitle(items: CcItem[], max = 80): string {
  const user = items.find((i) => i.kind === 'user')
  if (!user) return 'Продолжение сессии'
  const t = user.text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** Метка времени HH:MM из ts записи (или из fallback-времени). */
export function ccTimeLabel(ts: number | undefined, fallbackNow: number): string {
  const d = new Date(ts ?? fallbackNow)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** cwd из «головы» транскрипта (первое непустое поле cwd). */
export function ccCwdFromHead(headText: string): string | null {
  for (const line of headText.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    try {
      const o = JSON.parse(t) as { cwd?: unknown }
      if (typeof o.cwd === 'string' && o.cwd) return o.cwd
    } catch {
      /* пропуск */
    }
  }
  return null
}

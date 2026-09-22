// Core observer DTOs and conversation-resume mapping. Persisted CLI parsing belongs to LLM Runner.

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

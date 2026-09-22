// Core observer DTOs and conversation-resume mapping. Persisted CLI parsing belongs to LLM Runner.

import type { MessageRole } from './types'

/** «Проект» Codex — рабочий каталог (cwd), под которым сгруппированы сессии. */
export interface CxProject {
  /** Рабочий каталог (cwd из session_meta) — он же идентификатор проекта. */
  cwd: string
  /** Короткое имя (basename пути). */
  name: string
  /** Число сессий (rollout-файлов) с этим cwd. */
  sessionCount: number
  /** Время последней активности (mtime новейшей сессии, мс). */
  lastActivity: number
}

/** Сессия Codex (один rollout-файл). */
export interface CxSession {
  /** session_id (== uuid в имени файла). */
  id: string
  /** Заголовок — первая реплика пользователя (обрезанная). */
  title: string
  /** Время изменения (mtime, мс). */
  updatedAt: number
  /** Размер файла в байтах. */
  sizeBytes: number
}

export type CxItemKind = 'user' | 'assistant' | 'thinking' | 'tool_use' | 'tool_result' | 'other'

/** Одна запись транскрипта Codex. */
export interface CxItem {
  kind: CxItemKind
  /** Читаемый текст записи. */
  text: string
  /** Момент времени (мс), если известен. */
  ts?: number
  /** Признак ошибки (для tool_result). */
  isError?: boolean
}

export interface CxResumeMessage {
  role: MessageRole
  text: string
  ts?: number
}

/** Видимые реплики (user/assistant) для ленты чата. */
export function cxResumeMessages(items: CxItem[]): CxResumeMessage[] {
  const out: CxResumeMessage[] = []
  for (const i of items) {
    if (i.kind === 'user') out.push({ role: 'u1', text: i.text, ts: i.ts })
    else if (i.kind === 'assistant') out.push({ role: 'ai', text: i.text, ts: i.ts })
  }
  return out
}

/** Заголовок разговора-продолжения — первая реплика пользователя. */
export function cxResumeTitle(items: CxItem[], max = 80): string {
  const user = items.find((i) => i.kind === 'user')
  if (!user) return 'Продолжение сессии Codex'
  const t = user.text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** Метка времени HH:MM из ts записи (или из fallback-времени). */
export function cxTimeLabel(ts: number | undefined, fallbackNow: number): string {
  const d = new Date(ts ?? fallbackNow)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Проводник Codex: типы и парсер persisted-сессий Codex CLI.
// Источник — ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl (по строке-событию).
// Чистые функции — тестируются на фикстурах строк. Формат rollout отличается от
// Claude Code: чистый диалог лежит в записях {type:'event_msg',payload:{type,...}}.

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

function truncate(s: string, n = 4000): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

/** Краткое представление аргументов инструмента. */
function argsBrief(input: unknown): string {
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>
    if (typeof o.command === 'string') return o.command
    for (const k of ['file_path', 'path', 'pattern', 'url', 'query', 'prompt', 'cmd']) {
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

/** Команда exec: `command` бывает массивом (["/bin/zsh","-lc","<cmd>"]). */
function execCommandText(command: unknown): string {
  if (Array.isArray(command)) {
    const last = command[command.length - 1]
    return typeof last === 'string' ? last : command.map(String).join(' ')
  }
  return typeof command === 'string' ? command : ''
}

/** Текст из result MCP-инструмента ({Ok|Err:{content:[{type:'text',text}]}}). */
function mcpResultText(result: unknown): { text: string; isError: boolean } {
  if (!result || typeof result !== 'object') return { text: '', isError: false }
  const r = result as Record<string, unknown>
  const box = (r.Ok ?? r.Err) as Record<string, unknown> | undefined
  const isError = 'Err' in r || (box?.isError === true)
  const content = box?.content
  let text = ''
  if (Array.isArray(content)) {
    text = content
      .map((b) =>
        b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string'
          ? (b as { text: string }).text
          : ''
      )
      .join('')
  } else if (typeof box?.output === 'string') {
    text = box.output
  }
  return { text: text.trim(), isError }
}

/**
 * Разбирает одну строку rollout в записи транскрипта. Источник — только
 * записи `event_msg` (чистый диалог без дублей); `response_item`/`session_meta`/
 * `turn_context`/служебное — пропускаем.
 */
export function parseCxLine(line: string): CxItem[] {
  const trimmed = line.trim()
  if (!trimmed) return []
  let o: Record<string, unknown>
  try {
    o = JSON.parse(trimmed)
  } catch {
    return []
  }
  if (o.type !== 'event_msg' || !o.payload || typeof o.payload !== 'object') return []
  const ts = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) || undefined : undefined
  const p = o.payload as Record<string, unknown>

  switch (p.type) {
    case 'user_message': {
      const t = typeof p.message === 'string' ? p.message.trim() : ''
      return t ? [{ kind: 'user', text: t, ts }] : []
    }
    case 'agent_message': {
      const t = typeof p.message === 'string' ? p.message.trim() : ''
      if (!t) return []
      // final_answer — ответ (пузырь чата); commentary — промежуточная реплика.
      const kind: CxItemKind = p.phase === 'commentary' ? 'other' : 'assistant'
      return [{ kind, text: t, ts }]
    }
    case 'agent_reasoning': {
      const t = typeof p.text === 'string' ? p.text.trim() : ''
      return t ? [{ kind: 'thinking', text: truncate(t), ts }] : []
    }
    case 'exec_command_end': {
      const cmd = execCommandText(p.command)
      const items: CxItem[] = []
      if (cmd) items.push({ kind: 'tool_use', text: `$ ${cmd}`, ts })
      const out = typeof p.aggregated_output === 'string' ? p.aggregated_output.trim() : ''
      if (out) {
        items.push({ kind: 'tool_result', text: truncate(out), ts, isError: p.exit_code !== 0 })
      }
      return items
    }
    case 'patch_apply_end': {
      const changes = p.changes && typeof p.changes === 'object' ? Object.keys(p.changes) : []
      const items: CxItem[] = [
        { kind: 'tool_use', text: `apply_patch: ${changes.join(', ') || '(изменения)'}`, ts }
      ]
      const out = typeof p.stdout === 'string' && p.stdout.trim() ? p.stdout.trim() : ''
      const err = typeof p.stderr === 'string' && p.stderr.trim() ? p.stderr.trim() : ''
      const body = err || out
      if (body || p.success === false) {
        items.push({ kind: 'tool_result', text: truncate(body), ts, isError: p.success === false })
      }
      return items
    }
    case 'mcp_tool_call_end': {
      const inv = (p.invocation && typeof p.invocation === 'object' ? p.invocation : {}) as Record<
        string,
        unknown
      >
      const label = `${inv.server ?? 'mcp'}.${inv.tool ?? '?'}: ${argsBrief(inv.arguments)}`.trim()
      const res = mcpResultText(p.result)
      const items: CxItem[] = [{ kind: 'tool_use', text: label, ts }]
      if (res.text || res.isError) {
        items.push({ kind: 'tool_result', text: truncate(res.text), ts, isError: res.isError })
      }
      return items
    }
    default:
      // token_count / task_started / task_complete / turn_aborted /
      // context_compacted / thread_* — служебное, пропускаем.
      return []
  }
}

/** Разбирает весь rollout (jsonl-текст) в плоский список записей. */
export function parseCxTranscript(text: string): CxItem[] {
  const out: CxItem[] = []
  for (const line of text.split(/\r?\n/)) {
    for (const item of parseCxLine(line)) out.push(item)
  }
  return out
}

/** Метаданные сессии из «головы» rollout (запись session_meta). */
export function cxMetaFromHead(
  headText: string
): { cwd: string; id?: string; ts?: number } | null {
  for (const line of headText.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    try {
      const o = JSON.parse(t) as { type?: string; payload?: Record<string, unknown> }
      if (o.type === 'session_meta' && o.payload && typeof o.payload.cwd === 'string') {
        const ts =
          typeof o.payload.timestamp === 'string'
            ? Date.parse(o.payload.timestamp) || undefined
            : undefined
        const rawId = o.payload.session_id ?? o.payload.id
        const id = typeof rawId === 'string' ? rawId : undefined
        return { cwd: o.payload.cwd, id, ts }
      }
    } catch {
      /* пропуск */
    }
  }
  return null
}

/** Первая реплика пользователя из «головы» rollout — как заголовок сессии. */
export function cxSessionTitle(headText: string, max = 80): string {
  for (const line of headText.split(/\r?\n/)) {
    const user = parseCxLine(line).find((i) => i.kind === 'user')
    if (user) {
      const t = user.text.replace(/\s+/g, ' ').trim()
      return t.length > max ? `${t.slice(0, max)}…` : t
    }
  }
  return 'Без названия'
}

// --- Продолжение сессии в приложении -------------------------------------

/** Одна реплика для импорта в разговор приложения. */
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

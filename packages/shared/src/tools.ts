// Встраивание машинных утилит (консоль/проводник) в сообщение чата.
//
// Договорённость: ai-сообщение может нести в конце fenced-блок ```tool с JSON
// {kind, agentId?}. Клиент вырезает блок и рендерит рабочий виджет. Блок
// добавляет либо само приложение (распознав команду пользователя), либо модель
// (по инструкции TOOL_HINT). Чистые функции — без DOM и сети.

import type { AgentInfo } from './agentProtocol'

/** Какую утилиту открыть в сообщении и на какой машине. */
export interface ToolSpec {
  kind: 'console' | 'explorer'
  /** id машины-агента; если не задан — UI выберет доступную. */
  agentId?: string
  /** Файл для выделения в проводнике или начальный cwd терминала. */
  path?: string
  /** path — это папка: проводник открывается ВНУТРИ неё (а не в родителе). */
  dir?: boolean
  /** Контекст проекта обязателен для делегированной машины. */
  projectId?: string
}

/** Результат разбора текста ответа с tool-блоком. */
export interface ParsedTool {
  /** Текст без tool-блока (для обычного рендера). */
  body: string
  tool: ToolSpec
}

export const TOOL_FENCE = 'tool'
const FENCE_RE = /```tool[^\S\n]*\n([\s\S]*?)```[^\S\n]*/

/**
 * Инструкция модели о формате открытия утилиты для заданного набора видов.
 * Виды приходят из настроек «Инструкции чата»: выключенный вид в текст не попадает,
 * и модель не знает, как его открыть. Пустой набор → пустая строка.
 */
export function toolHint(kinds: readonly ToolSpec['kind'][]): string {
  const allowed = TOOL_KINDS.filter((kind) => kinds.includes(kind))
  if (allowed.length === 0) return ''
  const names = allowed.map((kind) => TOOL_KIND_TITLES[kind])
  const list = names.length === 2 ? `${names[0]} или ${names[1]}` : names[0]
  const legend = allowed.map((kind) => `"kind": "${kind}" — ${TOOL_KIND_TITLES[kind]}`).join(', ')
  return [
    `Если пользователь просит открыть ${list} на его машине,`,
    'добавь в самом конце ответа блок с JSON:',
    '```tool',
    `{"kind":"${allowed[0]}"}`,
    '```',
    `${legend}. Можно указать`,
    '"agentId" конкретной машины. Не описывай этот блок словами; если открывать',
    'ничего не нужно — не добавляй блок.'
  ].join('\n')
}

/** Порядок видов в подсказке; названия — как их произносит пользователь. */
export const TOOL_KINDS: readonly ToolSpec['kind'][] = ['console', 'explorer']
const TOOL_KIND_TITLES: Record<ToolSpec['kind'], string> = { console: 'терминал', explorer: 'файловый проводник' }

/** Инструкция модели о формате открытия утилиты (оба вида; добавляется к промпту). */
export const TOOL_HINT = toolHint(TOOL_KINDS)

/** Дописывает к промпту инструкцию про tool-блок (пустой промпт не трогает). */
export function appendToolHint(prompt: string): string {
  if (!prompt.trim()) return prompt
  return `${prompt}\n\n${TOOL_HINT}`
}

/** Разбирает tool-блок из текста ответа; null — если блока нет или JSON битый. */
export function parseToolBlock(text: string): ParsedTool | null {
  const m = FENCE_RE.exec(text)
  if (!m) return null
  let raw: unknown
  try {
    raw = JSON.parse(m[1])
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const o = raw as { kind?: unknown; agentId?: unknown; path?: unknown }
  if (o.kind !== 'console' && o.kind !== 'explorer') return null
  const body = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim()
  return {
    body,
    tool: {
      kind: o.kind,
      ...(typeof o.agentId === 'string' ? { agentId: o.agentId } : {}),
      ...(typeof o.path === 'string' ? { path: o.path } : {})
    }
  }
}

/** Сериализует tool-блок для вставки в текст сообщения. */
export function toolBlock(tool: ToolSpec): string {
  return '```tool\n' + JSON.stringify(tool) + '\n```'
}

/**
 * Распознаёт команду «открой консоль/проводник [на <машина>]» (rus/eng).
 * Возвращает ToolSpec (с agentId, если машина названа и найдена) или null.
 */
export function detectOpenUtility(text: string, agents: AgentInfo[] = []): ToolSpec | null {
  const t = text.trim().toLowerCase()
  const m = /^(?:открой|открыть|запусти|open)\s+(консоль|терминал|console|terminal|проводник|файлы|explorer|files)(?:\s+(.*))?$/.exec(
    t
  )
  if (!m) return null
  const kind: ToolSpec['kind'] = /(консоль|терминал|console|terminal)/.test(m[1])
    ? 'console'
    : 'explorer'
  // Машина по имени после команды (сопоставляем по вхождению имени).
  const rest = m[2] ?? ''
  const named = agents.find((a) => rest.includes(a.name.toLowerCase()))
  return { kind, ...(named ? { agentId: named.id } : {}) }
}

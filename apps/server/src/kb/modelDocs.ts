// Статьи базы знаний, которые вернула модель: разбор ответа и капы объёма.
// Общий слой для «Исследовать проект» (kb/research.ts) и для шага CI-рана
// «Актуализировать базу знаний» (kb/codeUpdate.ts): формат ответа у них один,
// а записывает статьи в обоих случаях сервер, а не модель.

import type { KbDocumentKind } from '@voicechat/shared'

/** Сколько статей принимаем за один прогон и какой длины (защита от «простыни»). */
export const MAX_DOCUMENTS = 12
export const MAX_BODY_CHARS = 24_000

const KINDS = new Set<KbDocumentKind>(['feature', 'subsystem', 'protocol', 'decision', 'convention', 'runbook', 'package'])

/** Статья, которую вернула модель (после разбора и обрезки). */
export interface ResearchDocument {
  id?: string
  title: string
  kind?: KbDocumentKind
  tags?: string[]
  areas?: string[]
  body: string
}

/**
 * Разбор ответа модели: терпим к ```json-обёртке и тексту вокруг (как
 * parseVariants в помощнике промптов). Мусорные записи молча отбрасываем —
 * половина хорошего результата лучше, чем ошибка на всём прогоне.
 */
export function parseModelDocuments(raw: string, maxDocuments = MAX_DOCUMENTS): { root: Record<string, unknown>; note: string; documents: ResearchDocument[] } {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('Модель вернула неразборчивый ответ')
    parsed = JSON.parse(match[0])
  }
  const root = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
  const list = Array.isArray(root.documents) ? root.documents : []
  const documents: ResearchDocument[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const title = typeof raw.title === 'string' ? raw.title.trim() : ''
    const body = typeof raw.body === 'string' ? raw.body.trim() : ''
    if (!title || !body) continue
    const kind = typeof raw.kind === 'string' && KINDS.has(raw.kind as KbDocumentKind) ? (raw.kind as KbDocumentKind) : 'subsystem'
    documents.push({
      ...(typeof raw.id === 'string' && raw.id.trim() ? { id: raw.id.trim() } : {}),
      title,
      kind,
      tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : [],
      areas: Array.isArray(raw.areas) ? raw.areas.filter((t): t is string => typeof t === 'string') : [],
      body: body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}\n\n[…текст обрезан сервером]` : body
    })
    if (documents.length >= maxDocuments) break
  }
  return { root, note: typeof root.note === 'string' ? root.note.trim() : '', documents }
}

/** Совместимая обёртка для «Исследовать проект». */
export function parseResearchOutput(raw: string): { note: string; documents: ResearchDocument[] } {
  const { note, documents } = parseModelDocuments(raw)
  return { note, documents }
}

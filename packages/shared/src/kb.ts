/** Контракт read-only базы знаний проекта voiceAIChat. */
import type { KbContextMode } from './types'

export type KbDocumentKind = 'feature' | 'subsystem' | 'protocol' | 'decision' | 'convention' | 'runbook' | 'package'
export type KbFreshness = 'current' | 'stale' | 'unknown'
export type KbMatchType = 'symbol' | 'alias' | 'path' | 'protocol' | 'lexical' | 'semantic'

export interface KbStatus {
  available: boolean
  mode: 'source' | 'generated' | 'disabled'
  searchMode: 'lexical' | 'hybrid'
  version: string
  createdAt: string
  documents: number
  chunks: number
  staleDocuments: number
  error?: string
}
export interface KbDocumentSummary {
  id: string; title: string; kind: KbDocumentKind; tags: string[]; packages: string[]
  freshness: KbFreshness; sourcePath: string
}
export interface KbDocument extends KbDocumentSummary {
  updated?: string; body: string; symbols: string[]; protocols: string[]; areas: string[]; related: string[]
  headings: Array<{ title: string; anchor: string; level: number }>
}
export interface KbSearchResult {
  documentId: string; chunkId: string; title: string; heading: string; excerpt: string; score: number
  matchTypes: KbMatchType[]; explanation: string; freshness: KbFreshness; sourcePath: string; anchor: string
  symbols: string[]; relatedFiles: string[]
}
export interface KbSearchRequest { query: string; kinds?: KbDocumentKind[]; tags?: string[]; limit?: number }
export interface KbContextBundle {
  query: string; confidence: 'high' | 'medium' | 'low'; autoInjectAllowed: boolean
  sections: KbSearchResult[]; relatedFiles: string[]; relatedDocuments: string[]
  staleWarnings: string[]; estimatedTokens: number
}

// --- Телеметрия использования базы знаний моделью ------------------------
//
// Считаем ТОЛЬКО то, что видела модель: авто-инъекцию контекста сервером и
// вызовы MCP-инструментов БЗ. Ручной поиск человека по странице «База знаний»
// сюда не попадает — иначе метрика «сколько раз модель обращалась» врёт.

/** Кто обратился к БЗ: сервер (авто-инъекция) или модель через mcp__kb__*. */
export type KbUsageSource = 'auto' | 'tool_search' | 'tool_document' | 'tool_topics'
/** Итог обращения. `pending` живёт только в WS-кадре, в БД его нет. */
export type KbUsageStatus = 'pending' | 'delivered' | 'empty' | 'error'

/**
 * Оценка токенов по символам. Разложить `usage.inputTokens` хода на «сколько от
 * БЗ» нельзя — CLI отдаёт суммарный вход промпта, поэтому в панели показываются
 * точные СИМВОЛЫ и эта оценка, а не биллинговые токены. Одна функция на сервер и
 * UI, чтобы числа в них не разъехались.
 */
export function estimateKbTokens(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 4)
}

/** Раздел, реально отданный модели в одном обращении. */
export interface KbUsageSectionRef {
  documentId: string
  title: string
  heading: string
  anchor: string
  sourcePath: string
  /** Символы именно этого раздела в отданном тексте. */
  chars: number
  estimatedTokens: number
  score: number | null
  matchTypes: KbMatchType[]
  freshness: KbFreshness
}

/** Одно обращение к БЗ (авто-инъекция хода либо вызов инструмента моделью). */
export interface KbUsageQuery {
  id: string
  /** Монотонный курсор внутри разговора: клиент отбрасывает кадры с seq ≤ lastSeq. */
  seq: number
  conversationId: string
  /** Проект НА МОМЕНТ обращения (чат может сменить проект позже). */
  projectId: string | null
  turnId: string | null
  messageId: string | null
  source: KbUsageSource
  status: KbUsageStatus
  query: string
  confidence: 'high' | 'medium' | 'low' | null
  /** Текст реально дописан в промпт (авто-инъекция) либо возвращён инструменту. */
  injected: boolean
  sectionsCount: number
  /** Точная длина текста, пришедшего модели. */
  chars: number
  estimatedTokens: number
  /** Оценка бандла от самой БЗ (`KbContextBundle.estimatedTokens`). */
  bundleTokens: number | null
  /** Размер всего промпта хода — для доли «сколько из него от БЗ». */
  promptChars: number | null
  /** Суммарный вход хода (input + cacheRead + cacheCreation) — для контекста. */
  turnInputTokens: number | null
  durationMs: number | null
  error: string | null
  createdAt: number
  sections: KbUsageSectionRef[]
}

/** Раздел в агрегате: сколько раз запрашивался и сколько дал модели. */
export interface KbUsageSectionAggregate {
  documentId: string
  title: string
  heading: string
  anchor: string
  sourcePath: string
  freshness: KbFreshness
  times: number
  /** Из них авто-инъекцией сервера (остальное — запросы модели инструментом). */
  autoTimes: number
  chars: number
  estimatedTokens: number
  lastAt: number
  /** Сколько разных чатов запрашивали раздел (только в проектном отчёте). */
  conversations?: number
}

export interface KbUsageTotals {
  queries: number
  delivered: number
  empty: number
  errors: number
  /** Обращений от модели через mcp__kb__* (остальное — авто-инъекция). */
  toolQueries: number
  /** Сумма отданных разделов (с повторами). */
  sections: number
  /** Уникальных документов. */
  documents: number
  chars: number
  estimatedTokens: number
  /** Сумма promptChars ходов с обращением — база для доли БЗ в промпте. */
  promptChars: number
  lastAt: number | null
}

/** Отчёт по одному чату (снапшот REST; инкременты приходят кадром kb.usage). */
export interface KbUsageReport {
  conversationId: string
  projectId: string | null
  kbContextMode: KbContextMode
  /** MCP-инструмент БЗ включён на сервере (VC_KB_TOOL) и индекс доступен. */
  toolEnabled: boolean
  /** Индекс БЗ доступен (иначе панель объясняет пустоту конфигурацией). */
  available: boolean
  /** Последний seq в отчёте: отсечка для инкрементальных кадров. */
  lastSeq: number
  totals: KbUsageTotals
  sections: KbUsageSectionAggregate[]
  recent: KbUsageQuery[]
}

/** Агрегат по всем чатам проекта. */
export interface KbProjectUsageReport {
  projectId: string
  toolEnabled: boolean
  available: boolean
  totals: KbUsageTotals
  sections: KbUsageSectionAggregate[]
  /** Последние обращения по всем чатам проекта (новые сверху). */
  recent: KbUsageQuery[]
  conversations: Array<{
    conversationId: string
    title: string
    queries: number
    chars: number
    estimatedTokens: number
    lastAt: number
  }>
}

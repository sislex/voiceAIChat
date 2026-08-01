// Чистая логика панели «Использование БЗ»: агрегация обращений, приём живых
// кадров и фолбэк по истории сообщений.
//
// Зачем фолбэк. Обращения к БЗ считаются с этой фичи, а `meta.request.kbContext`
// сохранённых ходов лежит в БД давно. Без фолбэка панель в старом чате была бы
// пустой, хотя контекст модели туда подмешивался. Событие, собранное из истории,
// производное — поэтому склейка с серверным отчётом обязана отбрасывать ход,
// который сервер уже посчитал (ключ — messageId). Правило живёт в чистой функции
// и покрыто тестом: иначе двойной счёт гарантирован.

import { estimateKbTokens, type KbProjectUsageReport, type KbUsageQuery, type KbUsageReport, type KbUsageSectionAggregate, type KbUsageSectionRef, type KbUsageTotals } from '@shared/kb'
import type { KbContextMode, Message } from '@shared/types'

/** Сколько обращений держим в ленте панели (сервер отдаёт столько же). */
export const KB_USAGE_FEED_LIMIT = 40

/** Кэш телеметрии одного чата (или проекта) в сторе. */
export interface KbUsageCache {
  report: KbUsageReport | null
  /**
   * id обращений, уже учтённых в totals/sections. Живой кадр складывается в
   * итоги ровно один раз: `pending` не считается вовсе, а терминальный кадр —
   * только если этого id ещё не было (иначе повторная доставка удвоит числа).
   */
  counted: string[]
  loading?: boolean
  error?: string | null
  /**
   * Чаты проекта с их итогами (только проектный отчёт): в `KbUsageReport` их нет,
   * а вкладке «По проекту» нужны и число чатов, и названия для ленты.
   */
  conversations?: KbProjectUsageReport['conversations']
}

const EMPTY_TOTALS: KbUsageTotals = {
  queries: 0, delivered: 0, empty: 0, errors: 0, toolQueries: 0, sections: 0, documents: 0,
  chars: 0, estimatedTokens: 0, promptChars: 0, lastAt: null
}

function sectionKey(section: { documentId: string; anchor: string }): string {
  return `${section.documentId}#${section.anchor}`
}

/** Итоги и разделы по набору обращений (для фолбэка и для проверок в тестах). */
export function aggregateKbUsage(queries: KbUsageQuery[]): { totals: KbUsageTotals; sections: KbUsageSectionAggregate[] } {
  const totals: KbUsageTotals = { ...EMPTY_TOTALS }
  const sections = new Map<string, KbUsageSectionAggregate>()
  const documents = new Set<string>()
  // Промпт хода общий для всех его обращений — считаем его один раз на ход.
  const prompts = new Map<string, number>()
  for (const query of queries) {
    if (query.status === 'pending') continue
    totals.queries += 1
    if (query.status === 'delivered') totals.delivered += 1
    if (query.status === 'empty') totals.empty += 1
    if (query.status === 'error') totals.errors += 1
    if (query.source !== 'auto') totals.toolQueries += 1
    totals.sections += query.sectionsCount
    totals.chars += query.chars
    totals.estimatedTokens += query.estimatedTokens
    totals.lastAt = Math.max(totals.lastAt ?? 0, query.createdAt)
    if (query.promptChars) prompts.set(query.turnId ?? query.id, query.promptChars)
    for (const section of query.sections) {
      documents.add(section.documentId)
      const key = sectionKey(section)
      const prev = sections.get(key)
      sections.set(key, {
        documentId: section.documentId,
        title: section.title,
        heading: section.heading,
        anchor: section.anchor,
        sourcePath: section.sourcePath,
        freshness: section.freshness,
        times: (prev?.times ?? 0) + 1,
        autoTimes: (prev?.autoTimes ?? 0) + (query.source === 'auto' ? 1 : 0),
        chars: (prev?.chars ?? 0) + section.chars,
        estimatedTokens: (prev?.estimatedTokens ?? 0) + section.estimatedTokens,
        lastAt: Math.max(prev?.lastAt ?? 0, query.createdAt),
        ...(prev?.conversations ? { conversations: prev.conversations } : {})
      })
    }
  }
  totals.documents = documents.size
  totals.promptChars = [...prompts.values()].reduce((sum, value) => sum + value, 0)
  return {
    totals,
    sections: [...sections.values()].sort((a, b) => b.times - a.times || b.chars - a.chars)
  }
}

export interface KbUsageFallbackOptions {
  conversationId: string
  projectId?: string | null
  kbContextMode?: KbContextMode
  toolEnabled?: boolean
  available?: boolean
}

/**
 * Отчёт из истории сообщений: каждый сохранённый ход с `meta.request.kbContext`
 * — одно авто-обращение. Символы берём из секций, если ход их записал; у старых
 * ходов их нет, и тогда числа честно нулевые (раздел показан, объём неизвестен).
 */
export function buildKbUsageFromMessages(messages: Message[], opts: KbUsageFallbackOptions): KbUsageReport {
  const queries: KbUsageQuery[] = []
  for (const message of messages) {
    const request = message.meta?.request
    const kbContext = request?.kbContext
    if (message.role !== 'ai' || !kbContext || !kbContext.sections.length) continue
    const sections: KbUsageSectionRef[] = kbContext.sections.map((section) => ({
      documentId: section.documentId,
      title: section.title,
      heading: section.heading,
      anchor: section.anchor,
      sourcePath: section.sourcePath,
      chars: section.chars ?? 0,
      estimatedTokens: section.estimatedTokens ?? estimateKbTokens(section.chars ?? 0),
      score: null,
      matchTypes: [],
      freshness: section.freshness ?? 'unknown'
    }))
    const chars = sections.reduce((sum, section) => sum + section.chars, 0)
    const meta = message.meta
    const turnInput = (meta?.inputTokens ?? 0) + (meta?.cacheReadTokens ?? 0) + (meta?.cacheCreationTokens ?? 0)
    queries.push({
      // Стабильный id: повторная сборка того же сообщения не создаёт нового события.
      id: `history:${message.id}`,
      seq: 0,
      conversationId: opts.conversationId,
      projectId: opts.projectId ?? null,
      turnId: null,
      messageId: message.id,
      // Фолбэк собирается из истории чата — ранов CI в ней нет по определению.
      ciRunId: null,
      ciStepId: null,
      source: 'auto',
      status: 'delivered',
      query: '',
      confidence: kbContext.confidence,
      injected: true,
      sectionsCount: sections.length,
      chars,
      estimatedTokens: estimateKbTokens(chars),
      bundleTokens: null,
      promptChars: request?.promptChars ?? null,
      turnInputTokens: turnInput > 0 ? turnInput : null,
      durationMs: null,
      error: null,
      createdAt: message.createdAt,
      sections
    })
  }
  const recent = [...queries].sort((a, b) => b.createdAt - a.createdAt).slice(0, KB_USAGE_FEED_LIMIT)
  const { totals, sections } = aggregateKbUsage(queries)
  return {
    conversationId: opts.conversationId,
    projectId: opts.projectId ?? null,
    kbContextMode: opts.kbContextMode ?? 'auto',
    toolEnabled: opts.toolEnabled ?? false,
    available: opts.available ?? true,
    lastSeq: 0,
    totals,
    sections,
    recent
  }
}

/**
 * Склейка серверного отчёта с производным из истории.
 *
 * Правила ровно два, и оба — против двойного счёта:
 * 1) ход, который сервер уже записал (совпал messageId), из истории отбрасываем;
 * 2) если серверная лента урезана лимитом (обращений больше, чем событий в
 *    ленте), историю не подмешиваем вовсе — сверить её с невидимыми записями
 *    нечем, а серверные данные и так полные.
 */
export function mergeKbUsage(server: KbUsageReport | null, fallback: KbUsageReport): KbUsageReport {
  if (!server) return fallback
  if (server.recent.length < server.totals.queries) return server
  const known = new Set(server.recent.map((query) => query.messageId).filter((id): id is string => Boolean(id)))
  const extra = fallback.recent.filter((query) => query.messageId && !known.has(query.messageId))
  if (!extra.length) return server
  const merged = aggregateKbUsage([...server.recent, ...extra])
  return {
    ...server,
    totals: merged.totals,
    sections: merged.sections,
    recent: [...server.recent, ...extra].sort((a, b) => b.createdAt - a.createdAt).slice(0, KB_USAGE_FEED_LIMIT)
  }
}

/** Пустой кэш: сервер ещё не ответил (или моста нет вовсе). */
export function emptyKbUsageCache(): KbUsageCache {
  return { report: null, counted: [] }
}

/** Кэш из свежего снапшота: всё, что в ленте, уже посчитано сервером. */
export function kbUsageSnapshot(report: KbUsageReport): KbUsageCache {
  return { report, counted: report.recent.map((query) => query.id), loading: false, error: null }
}

/**
 * Приём живого кадра: upsert по id, отсечка по seq и однократный учёт в итогах.
 * Устаревший кадр (seq ≤ lastSeq и id незнаком) — это ответ на гонку «REST-снапшот
 * пришёл позже инкремента»: он уже учтён в снапшоте, и применять его нельзя.
 */
export function applyKbUsageFrame(cache: KbUsageCache, query: KbUsageQuery): KbUsageCache {
  const report = cache.report
  if (!report) return cache
  const known = report.recent.some((item) => item.id === query.id)
  if (!known && query.seq !== 0 && query.seq <= report.lastSeq) return cache
  const recent = known
    ? report.recent.map((item) => (item.id === query.id ? query : item))
    : [query, ...report.recent].slice(0, KB_USAGE_FEED_LIMIT)
  const counted = new Set(cache.counted)
  let totals = report.totals
  let sections = report.sections
  // В итоги складываем только терминальные обращения и только один раз.
  if (query.status !== 'pending' && !counted.has(query.id)) {
    counted.add(query.id)
    const folded = aggregateKbUsage([query])
    totals = {
      queries: totals.queries + folded.totals.queries,
      delivered: totals.delivered + folded.totals.delivered,
      empty: totals.empty + folded.totals.empty,
      errors: totals.errors + folded.totals.errors,
      toolQueries: totals.toolQueries + folded.totals.toolQueries,
      sections: totals.sections + folded.totals.sections,
      documents: new Set([...report.sections.map((s) => s.documentId), ...query.sections.map((s) => s.documentId)]).size,
      chars: totals.chars + folded.totals.chars,
      estimatedTokens: totals.estimatedTokens + folded.totals.estimatedTokens,
      promptChars: totals.promptChars + folded.totals.promptChars,
      lastAt: Math.max(totals.lastAt ?? 0, query.createdAt)
    }
    const byKey = new Map(sections.map((item) => [sectionKey(item), item]))
    for (const item of folded.sections) {
      const prev = byKey.get(sectionKey(item))
      byKey.set(sectionKey(item), prev
        ? { ...prev, times: prev.times + item.times, autoTimes: prev.autoTimes + item.autoTimes, chars: prev.chars + item.chars, estimatedTokens: prev.estimatedTokens + item.estimatedTokens, lastAt: Math.max(prev.lastAt, item.lastAt) }
        : item)
    }
    sections = [...byKey.values()].sort((a, b) => b.times - a.times || b.chars - a.chars)
  }
  return {
    ...cache,
    counted: [...counted],
    report: { ...report, lastSeq: Math.max(report.lastSeq, query.seq), totals, sections, recent }
  }
}

/** Доля БЗ в промптах ходов, 0–100 (null — промпты неизвестны). */
export function kbUsageShare(totals: KbUsageTotals): number | null {
  if (!totals.promptChars) return null
  return Math.min(100, Math.round((totals.chars / totals.promptChars) * 100))
}

/** Идёт ли обращение прямо сейчас (в ленте есть pending) — для индикатора кнопки. */
export function hasPendingKbUsage(report: KbUsageReport | null): boolean {
  return Boolean(report?.recent.some((query) => query.status === 'pending'))
}

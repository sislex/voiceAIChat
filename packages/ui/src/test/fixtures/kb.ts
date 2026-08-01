// Фикстуры телеметрии базы знаний: обращения (авто-контекст и запросы модели),
// отчёты по чату и по проекту, готовые состояния кэша панели. Время фиксировано —
// иначе «последнее обращение» в сториз плыло бы от прогона к прогону.

import { estimateKbTokens, type KbProjectUsageReport, type KbStatus, type KbUsageQuery, type KbUsageReport, type KbUsageSectionRef } from '@shared/kb'
import { aggregateKbUsage, kbUsageSnapshot, type KbUsageCache } from '../../lib/kbUsage'

/** База времени обращений: 2026-07-31 12:00 локального времени. */
export const KB_T0 = new Date(2026, 6, 31, 12, 0, 0).getTime()

export function makeKbSection(over: Partial<KbUsageSectionRef> = {}): KbUsageSectionRef {
  const chars = over.chars ?? 620
  return {
    documentId: 'protocol',
    title: 'Протокол клиент↔сервер',
    heading: 'WebSocket',
    anchor: 'websocket',
    sourcePath: 'docs/kb/protocol.md',
    relatedFiles: over.relatedFiles ?? [],
    chars,
    estimatedTokens: estimateKbTokens(chars),
    score: 12.5,
    matchTypes: ['symbol'],
    freshness: 'current',
    ...over,
    ...(over.chars !== undefined ? { chars: over.chars, estimatedTokens: over.estimatedTokens ?? estimateKbTokens(over.chars) } : {})
  }
}

export function makeKbQuery(over: Partial<KbUsageQuery> = {}): KbUsageQuery {
  const sections = over.sections ?? [makeKbSection()]
  const chars = over.chars ?? sections.reduce((sum, section) => sum + section.chars, 0)
  return {
    id: 'kbu-1',
    seq: 1,
    conversationId: 'c1',
    projectId: 'p1',
    turnId: 'turn-1',
    messageId: 'm1',
    ciRunId: null,
    ciStepId: null,
    source: 'auto',
    status: 'delivered',
    query: 'как устроены ходы модели',
    confidence: 'high',
    injected: true,
    sectionsCount: sections.length,
    chars,
    estimatedTokens: estimateKbTokens(chars),
    bundleTokens: 180,
    promptChars: 5200,
    turnInputTokens: 4300,
    durationMs: 140,
    error: null,
    createdAt: KB_T0,
    ...over,
    sections
  }
}

/** Три обращения: авто-контекст, поиск модели и раздел по её запросу. */
export function makeKbQueries(): KbUsageQuery[] {
  return [
    makeKbQuery({ id: 'kbu-3', seq: 3, source: 'tool_document', query: 'llm#hody', createdAt: KB_T0 + 120_000, chars: 3100, sections: [makeKbSection({ documentId: 'llm', title: 'Ходы модели', heading: 'Жизненный цикл', anchor: 'zhiznennyy-cikl', sourcePath: 'docs/kb/llm.md', chars: 3100, freshness: 'stale' })] }),
    makeKbQuery({ id: 'kbu-2', seq: 2, source: 'tool_search', query: 'сохранение ответа после обрыва ws', createdAt: KB_T0 + 60_000, chars: 940, sections: [makeKbSection({ chars: 470 }), makeKbSection({ documentId: 'llm', title: 'Ходы модели', heading: 'Жизненный цикл', anchor: 'zhiznennyy-cikl', sourcePath: 'docs/kb/llm.md', chars: 470 })] }),
    makeKbQuery()
  ]
}

export function makeKbUsageReport(over: Partial<KbUsageReport> = {}): KbUsageReport {
  const recent = over.recent ?? makeKbQueries()
  const { totals, sections } = aggregateKbUsage(recent)
  return {
    conversationId: 'c1',
    projectId: 'p1',
    kbContextMode: 'auto',
    toolEnabled: true,
    available: true,
    lastSeq: Math.max(0, ...recent.map((query) => query.seq)),
    totals,
    sections,
    recent,
    ...over
  }
}

export function makeKbProjectUsageReport(over: Partial<KbProjectUsageReport> = {}): KbProjectUsageReport {
  const recent = over.recent ?? makeKbQueries().map((query, index) => ({ ...query, conversationId: index === 0 ? 'c2' : 'c1' }))
  const { totals, sections } = aggregateKbUsage(recent)
  return {
    projectId: 'p1',
    toolEnabled: true,
    available: true,
    totals,
    sections: sections.map((section) => ({ ...section, conversations: 2 })),
    recent,
    conversations: [
      { conversationId: 'c1', title: 'Ходы модели', queries: 2, chars: 1560, estimatedTokens: estimateKbTokens(1560), lastAt: KB_T0 + 60_000 },
      { conversationId: 'c2', title: 'Панель БЗ', queries: 1, chars: 3100, estimatedTokens: estimateKbTokens(3100), lastAt: KB_T0 + 120_000 }
    ],
    ...over
  }
}

/** Кэш панели по чату (готовый снапшот). */
export function makeKbUsageCache(over: Partial<KbUsageReport> = {}): KbUsageCache {
  return kbUsageSnapshot(makeKbUsageReport(over))
}

/** Кэш вкладки «По проекту» (тот же формат + список чатов). */
export function makeKbProjectCache(over: Partial<KbProjectUsageReport> = {}): KbUsageCache {
  const report = makeKbProjectUsageReport(over)
  return {
    ...kbUsageSnapshot({
      conversationId: '',
      projectId: report.projectId,
      kbContextMode: 'auto',
      toolEnabled: report.toolEnabled,
      available: report.available,
      lastSeq: 0,
      totals: report.totals,
      sections: report.sections,
      recent: report.recent
    }),
    conversations: report.conversations
  }
}

export function makeKbStatus(over: Partial<KbStatus> = {}): KbStatus {
  return {
    available: true,
    mode: 'source',
    searchMode: 'hybrid',
    version: 'abc123',
    createdAt: new Date(KB_T0).toISOString(),
    documents: 18,
    chunks: 214,
    staleDocuments: 2,
    ...over
  }
}

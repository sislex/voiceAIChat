// Чистая логика панели «Использование БЗ». Файл `kbUsage.ts` заявлял в шапке, что
// правило против двойного счёта «покрыто тестом», — теста не было; здесь он есть.
//
// Проверяем ровно те инварианты, которые обещаны комментариями в самом модуле:
// pending не попадает в итоги, промпт хода считается один раз, разделы
// склеиваются по documentId#anchor, история не удваивает то, что уже посчитал
// сервер, и живой кадр складывается в итоги однократно.

import { describe, expect, it } from 'vitest'
import type { KbUsageQuery, KbUsageReport, KbUsageSectionRef } from '@shared/kb'
import type { Message } from '@shared/types'
import {
  KB_USAGE_FEED_LIMIT,
  aggregateKbUsage,
  applyKbUsageFrame,
  buildKbUsageFromMessages,
  emptyKbUsageCache,
  hasPendingKbUsage,
  kbUsageShare,
  kbUsageSnapshot,
  mergeKbUsage
} from './kbUsage'

function section(overrides: Partial<KbUsageSectionRef> = {}): KbUsageSectionRef {
  return {
    documentId: 'doc-1',
    title: 'Тестирование',
    heading: 'Гейт',
    anchor: 'gate',
    sourcePath: 'docs/kb/testing-operations.md',
    relatedFiles: [],
    chars: 400,
    estimatedTokens: 100,
    score: null,
    matchTypes: [],
    freshness: 'current',
    ...overrides
  }
}

function query(overrides: Partial<KbUsageQuery> = {}): KbUsageQuery {
  const sections = overrides.sections ?? [section()]
  return {
    id: 'q-1',
    seq: 1,
    conversationId: 'conv-1',
    projectId: null,
    turnId: 'turn-1',
    messageId: 'msg-1',
    ciRunId: null,
    ciStepId: null,
    source: 'auto',
    status: 'delivered',
    query: '',
    confidence: 'high',
    injected: true,
    sectionsCount: sections.length,
    chars: sections.reduce((sum, item) => sum + item.chars, 0),
    estimatedTokens: sections.reduce((sum, item) => sum + item.estimatedTokens, 0),
    bundleTokens: null,
    promptChars: null,
    turnInputTokens: null,
    durationMs: null,
    error: null,
    createdAt: 1_000,
    ...overrides,
    sections
  }
}

function report(overrides: Partial<KbUsageReport> = {}): KbUsageReport {
  const recent = overrides.recent ?? []
  const folded = aggregateKbUsage(recent)
  return {
    conversationId: 'conv-1',
    projectId: null,
    kbContextMode: 'auto',
    toolEnabled: false,
    available: true,
    lastSeq: recent.reduce((max, item) => Math.max(max, item.seq), 0),
    unreadCount: 0,
    totals: folded.totals,
    sections: folded.sections,
    ...overrides,
    recent
  }
}

function aiMessage(id: string, createdAt: number, sections: Array<{ chars?: number; anchor?: string }>): Message {
  return {
    id,
    conversationId: 'conv-1',
    role: 'ai',
    text: 'ответ',
    time: '12:00',
    createdAt,
    meta: {
      request: {
        resumed: false,
        kbContext: {
          confidence: 'high',
          sections: sections.map((item, index) => ({
            documentId: 'doc-1',
            title: 'Тестирование',
            heading: 'Гейт',
            sourcePath: 'docs/kb/testing-operations.md',
            anchor: item.anchor ?? `a-${index}`,
            ...(item.chars === undefined ? {} : { chars: item.chars })
          }))
        }
      }
    }
  } as unknown as Message
}

describe('aggregateKbUsage', () => {
  it('pending не попадает в итоги: обращение считается только терминальным', () => {
    const { totals } = aggregateKbUsage([
      query({ id: 'a', status: 'pending' }),
      query({ id: 'b', status: 'delivered' })
    ])
    expect(totals.queries).toBe(1)
    expect(totals.delivered).toBe(1)
  })

  it('разводит статусы и считает обращения инструмента отдельно от авто-инъекций', () => {
    const { totals } = aggregateKbUsage([
      query({ id: 'a', status: 'delivered', source: 'auto' }),
      query({ id: 'b', status: 'empty', source: 'tool_search' }),
      query({ id: 'c', status: 'error', source: 'tool_search' })
    ])
    expect(totals).toMatchObject({ queries: 3, delivered: 1, empty: 1, errors: 1, toolQueries: 2 })
  })

  it('промпт хода считается один раз, сколько бы обращений ход ни сделал', () => {
    const { totals } = aggregateKbUsage([
      query({ id: 'a', turnId: 'turn-1', promptChars: 5_000 }),
      query({ id: 'b', turnId: 'turn-1', promptChars: 5_000 }),
      query({ id: 'c', turnId: 'turn-2', promptChars: 2_000 })
    ])
    expect(totals.promptChars).toBe(7_000)
  })

  it('без turnId промпт относится к самому обращению — ходы не сливаются', () => {
    const { totals } = aggregateKbUsage([
      query({ id: 'a', turnId: null, promptChars: 1_000 }),
      query({ id: 'b', turnId: null, promptChars: 3_000 })
    ])
    expect(totals.promptChars).toBe(4_000)
  })

  it('один раздел, выданный дважды, склеивается по documentId#anchor и суммирует объём', () => {
    const { totals, sections } = aggregateKbUsage([
      query({ id: 'a', sections: [section({ chars: 400, estimatedTokens: 100 })] }),
      query({ id: 'b', source: 'tool_search', sections: [section({ chars: 600, estimatedTokens: 150 })] })
    ])
    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject({ times: 2, autoTimes: 1, chars: 1_000, estimatedTokens: 250 })
    // documents считает уникальные документы, а не разделы.
    expect(totals.documents).toBe(1)
    expect(totals.sections).toBe(2)
  })

  it('разные документы считаются по отдельности, а лента сортируется по частоте', () => {
    const { totals, sections } = aggregateKbUsage([
      query({ id: 'a', sections: [section({ documentId: 'doc-1', anchor: 'x' })] }),
      query({ id: 'b', sections: [section({ documentId: 'doc-2', anchor: 'y' })] }),
      query({ id: 'c', sections: [section({ documentId: 'doc-2', anchor: 'y' })] })
    ])
    expect(totals.documents).toBe(2)
    expect(sections.map((item) => item.documentId)).toEqual(['doc-2', 'doc-1'])
  })

  it('lastAt — самое позднее обращение, а не последнее в массиве', () => {
    const { totals } = aggregateKbUsage([
      query({ id: 'a', createdAt: 5_000 }),
      query({ id: 'b', createdAt: 1_000 })
    ])
    expect(totals.lastAt).toBe(5_000)
  })

  it('пустой набор даёт нулевые итоги без lastAt', () => {
    const { totals, sections } = aggregateKbUsage([])
    expect(sections).toEqual([])
    expect(totals).toMatchObject({ queries: 0, documents: 0, chars: 0, promptChars: 0, lastAt: null })
  })
})

describe('buildKbUsageFromMessages', () => {
  const opts = { conversationId: 'conv-1' }

  it('берёт только ходы модели с непустым kbContext', () => {
    const messages = [
      aiMessage('m-1', 1_000, [{ chars: 400 }]),
      { ...aiMessage('m-2', 2_000, [{ chars: 400 }]), role: 'u1' } as Message,
      aiMessage('m-3', 3_000, [])
    ]
    const built = buildKbUsageFromMessages(messages, opts)
    expect(built.recent.map((item) => item.messageId)).toEqual(['m-1'])
  })

  it('id обращения стабилен: повторная сборка того же сообщения не плодит события', () => {
    const messages = [aiMessage('m-1', 1_000, [{ chars: 400 }])]
    expect(buildKbUsageFromMessages(messages, opts).recent[0].id).toBe('history:m-1')
    expect(buildKbUsageFromMessages(messages, opts).recent[0].id).toBe('history:m-1')
  })

  it('у старого хода без chars числа честно нулевые, а раздел всё равно показан', () => {
    const built = buildKbUsageFromMessages([aiMessage('m-1', 1_000, [{}])], opts)
    expect(built.totals.chars).toBe(0)
    expect(built.totals.estimatedTokens).toBe(0)
    expect(built.sections).toHaveLength(1)
  })

  it('estimatedTokens считается от символов раздела (ceil(chars/4))', () => {
    const built = buildKbUsageFromMessages([aiMessage('m-1', 1_000, [{ chars: 401 }])], opts)
    expect(built.recent[0].estimatedTokens).toBe(101)
  })

  it('лента урезана лимитом и отсортирована новыми вперёд', () => {
    const messages = Array.from({ length: KB_USAGE_FEED_LIMIT + 5 }, (_, index) =>
      aiMessage(`m-${index}`, index * 1_000, [{ chars: 100 }]))
    const built = buildKbUsageFromMessages(messages, opts)
    expect(built.recent).toHaveLength(KB_USAGE_FEED_LIMIT)
    expect(built.recent[0].messageId).toBe(`m-${KB_USAGE_FEED_LIMIT + 4}`)
    // Итоги считаются по всем ходам, а не только по попавшим в ленту.
    expect(built.totals.queries).toBe(KB_USAGE_FEED_LIMIT + 5)
  })

  it('фолбэк — авто-обращения текущего чата, счётчик непрочитанных равен числу ходов', () => {
    const built = buildKbUsageFromMessages([aiMessage('m-1', 1_000, [{ chars: 400 }])], { conversationId: 'conv-1', projectId: 'p-1' })
    expect(built.recent[0]).toMatchObject({ source: 'auto', status: 'delivered', projectId: 'p-1', ciRunId: null, seq: 0 })
    expect(built.unreadCount).toBe(1)
  })
})

describe('mergeKbUsage — обе защиты от двойного счёта', () => {
  it('без серверного отчёта остаётся фолбэк', () => {
    const fallback = buildKbUsageFromMessages([aiMessage('m-1', 1_000, [{ chars: 400 }])], { conversationId: 'conv-1' })
    expect(mergeKbUsage(null, fallback)).toBe(fallback)
  })

  it('ход, уже посчитанный сервером, из истории отбрасывается', () => {
    const server = report({ recent: [query({ id: 'srv-1', messageId: 'm-1' })] })
    const fallback = buildKbUsageFromMessages([aiMessage('m-1', 1_000, [{ chars: 400 }])], { conversationId: 'conv-1' })
    const merged = mergeKbUsage(server, fallback)
    expect(merged).toBe(server)
    expect(merged.totals.queries).toBe(1)
  })

  it('урезанная лимитом серверная лента не подмешивает историю вовсе', () => {
    // Обращений больше, чем событий в ленте: сверять историю нечем.
    const server = report({ recent: [query({ id: 'srv-1', messageId: 'm-9' })] })
    server.totals.queries = 50
    const fallback = buildKbUsageFromMessages([aiMessage('m-1', 1_000, [{ chars: 400 }])], { conversationId: 'conv-1' })
    expect(mergeKbUsage(server, fallback)).toBe(server)
  })

  it('ход, которого у сервера нет, подмешивается и пересчитывает итоги', () => {
    const server = report({ recent: [query({ id: 'srv-1', messageId: 'm-1', createdAt: 5_000 })] })
    const fallback = buildKbUsageFromMessages([aiMessage('m-2', 9_000, [{ chars: 800 }])], { conversationId: 'conv-1' })
    const merged = mergeKbUsage(server, fallback)
    expect(merged.totals.queries).toBe(2)
    // Лента остаётся отсортированной новыми вперёд.
    expect(merged.recent.map((item) => item.messageId)).toEqual(['m-2', 'm-1'])
  })
})

describe('applyKbUsageFrame', () => {
  it('без отчёта кадр применять некуда — кэш не меняется', () => {
    const cache = emptyKbUsageCache()
    expect(applyKbUsageFrame(cache, query())).toBe(cache)
  })

  it('устаревший кадр с незнакомым id игнорируется (снапшот пришёл позже инкремента)', () => {
    const cache = kbUsageSnapshot(report({ recent: [query({ id: 'a', seq: 7 })], lastSeq: 7 }))
    expect(applyKbUsageFrame(cache, query({ id: 'later', seq: 5 }))).toBe(cache)
  })

  it('pending кадр попадает в ленту, но не в итоги', () => {
    const cache = kbUsageSnapshot(report({ recent: [], lastSeq: 0 }))
    const next = applyKbUsageFrame(cache, query({ id: 'p', seq: 1, status: 'pending' }))
    expect(next.report!.recent.map((item) => item.id)).toEqual(['p'])
    expect(next.report!.totals.queries).toBe(0)
    expect(next.counted).toEqual([])
  })

  it('терминальный кадр учитывается один раз: повторная доставка не удваивает итоги', () => {
    const cache = kbUsageSnapshot(report({ recent: [], lastSeq: 0 }))
    const first = applyKbUsageFrame(cache, query({ id: 'a', seq: 1, chars: 400 }))
    const again = applyKbUsageFrame(first, query({ id: 'a', seq: 1, chars: 400 }))
    expect(first.report!.totals.queries).toBe(1)
    expect(again.report!.totals.queries).toBe(1)
    expect(again.report!.recent).toHaveLength(1)
    expect(again.counted).toEqual(['a'])
  })

  it('pending, ставший delivered, считается ровно один раз и обновляет запись на месте', () => {
    const cache = kbUsageSnapshot(report({ recent: [], lastSeq: 0 }))
    const pending = applyKbUsageFrame(cache, query({ id: 'a', seq: 1, status: 'pending' }))
    const done = applyKbUsageFrame(pending, query({ id: 'a', seq: 2, status: 'delivered', chars: 400 }))
    expect(done.report!.recent).toHaveLength(1)
    expect(done.report!.recent[0].status).toBe('delivered')
    expect(done.report!.totals.queries).toBe(1)
    expect(done.report!.lastSeq).toBe(2)
  })

  it('снапшот считает свою ленту уже учтённой — повторный кадр из неё итоги не двигает', () => {
    const existing = query({ id: 'a', seq: 3, chars: 400 })
    const cache = kbUsageSnapshot(report({ recent: [existing], lastSeq: 3 }))
    expect(cache.counted).toEqual(['a'])
    const next = applyKbUsageFrame(cache, existing)
    expect(next.report!.totals).toEqual(cache.report!.totals)
  })

  it('лента кадров урезана лимитом', () => {
    const seed = Array.from({ length: KB_USAGE_FEED_LIMIT }, (_, index) => query({ id: `s-${index}`, seq: index + 1 }))
    const cache = kbUsageSnapshot(report({ recent: seed, lastSeq: KB_USAGE_FEED_LIMIT }))
    const next = applyKbUsageFrame(cache, query({ id: 'fresh', seq: KB_USAGE_FEED_LIMIT + 1 }))
    expect(next.report!.recent).toHaveLength(KB_USAGE_FEED_LIMIT)
    expect(next.report!.recent[0].id).toBe('fresh')
  })
})

describe('kbUsageShare и hasPendingKbUsage', () => {
  it('доля неизвестна, пока не известен размер промптов', () => {
    expect(kbUsageShare(aggregateKbUsage([query({ promptChars: null })]).totals)).toBeNull()
  })

  it('доля считается от символов промпта и округляется', () => {
    const totals = aggregateKbUsage([query({ chars: 400, promptChars: 1_600, sections: [section({ chars: 400 })] })]).totals
    expect(kbUsageShare(totals)).toBe(25)
  })

  it('доля не выходит за 100, даже если БЗ длиннее учтённого промпта', () => {
    const totals = aggregateKbUsage([query({ promptChars: 100, sections: [section({ chars: 5_000 })] })]).totals
    expect(kbUsageShare(totals)).toBe(100)
  })

  it('индикатор кнопки зажигается только на живом pending', () => {
    expect(hasPendingKbUsage(null)).toBe(false)
    expect(hasPendingKbUsage(report({ recent: [query({ status: 'delivered' })] }))).toBe(false)
    expect(hasPendingKbUsage(report({ recent: [query({ status: 'pending' })] }))).toBe(true)
  })
})

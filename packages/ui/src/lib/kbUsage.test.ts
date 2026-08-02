import { describe, it, expect } from 'vitest'
import type { Message } from '@shared/types'
import { estimateKbTokens } from '@shared/kb'
import { applyKbUsageFrame, aggregateKbUsage, buildKbUsageFromMessages, kbUsageShare, kbUsageSnapshot, mergeKbUsage } from './kbUsage'
import { KB_T0, makeKbQueries, makeKbQuery, makeKbSection, makeKbUsageReport } from '../test/fixtures'

/** Ответ модели с сохранённым авто-контекстом БЗ в meta.request. */
function aiWithKb(id: string, over: { chars?: number; createdAt?: number; promptChars?: number } = {}): Message {
  const chars = over.chars ?? 500
  return {
    id,
    conversationId: 'c1',
    role: 'ai',
    text: 'Ответ',
    time: '12:00',
    createdAt: over.createdAt ?? KB_T0,
    meta: {
      inputTokens: 1000,
      cacheReadTokens: 200,
      request: {
        provider: 'claude',
        model: 'sonnet',
        prompt: 'p',
        promptChars: over.promptChars ?? 4000,
        resumed: false,
        kbContext: {
          confidence: 'high',
          sections: [
            { documentId: 'protocol', title: 'Протокол', heading: 'WebSocket', sourcePath: 'docs/kb/protocol.md', anchor: 'websocket', chars, estimatedTokens: estimateKbTokens(chars), freshness: 'current' }
          ]
        }
      }
    }
  }
}

describe('aggregateKbUsage', () => {
  it('складывает обращения, разделы и документы без двойного счёта промпта', () => {
    const queries = [
      makeKbQuery({ id: 'a', turnId: 'turn-1', promptChars: 5000, chars: 600, sections: [makeKbSection({ chars: 600 })] }),
      makeKbQuery({ id: 'b', turnId: 'turn-1', source: 'tool_search', promptChars: 5000, chars: 400, sections: [makeKbSection({ chars: 400 })] })
    ]
    const { totals, sections } = aggregateKbUsage(queries)
    expect(totals).toMatchObject({ queries: 2, delivered: 2, toolQueries: 1, chars: 1000, documents: 1 })
    // Промпт хода один — считаем его один раз, иначе доля БЗ вдвое ниже правды.
    expect(totals.promptChars).toBe(5000)
    expect(sections[0]).toMatchObject({ times: 2, autoTimes: 1, chars: 1000 })
    expect(kbUsageShare(totals)).toBe(20)
  })

  it('pending не считается: обращение ещё идёт', () => {
    const { totals } = aggregateKbUsage([makeKbQuery({ status: 'pending', chars: 0, sections: [] })])
    expect(totals.queries).toBe(0)
  })
})

describe('buildKbUsageFromMessages', () => {
  it('собирает отчёт из истории ходов (чаты до появления телеметрии)', () => {
    const report = buildKbUsageFromMessages(
      [
        { id: 'u1', conversationId: 'c1', role: 'u1', text: 'вопрос', time: '12:00', createdAt: KB_T0 - 1000 },
        aiWithKb('m1', { chars: 400 }),
        aiWithKb('m2', { chars: 600, createdAt: KB_T0 + 1000 })
      ],
      { conversationId: 'c1', projectId: 'p1', kbContextMode: 'auto' }
    )
    expect(report.totals).toMatchObject({ queries: 2, delivered: 2, chars: 1000, documents: 1 })
    expect(report.recent.map((query) => query.messageId)).toEqual(['m2', 'm1']) // новые сверху
    expect(report.recent.every((query) => query.source === 'auto')).toBe(true)
    expect(report.sections[0]).toMatchObject({ documentId: 'protocol', times: 2, autoTimes: 2 })
  })

  it('ходы без kbContext и реплики пользователя пропускаются', () => {
    const plain: Message = { id: 'm9', conversationId: 'c1', role: 'ai', text: 'без БЗ', time: '12:00', createdAt: KB_T0 }
    const report = buildKbUsageFromMessages([plain], { conversationId: 'c1' })
    expect(report.totals.queries).toBe(0)
    expect(report.recent).toEqual([])
  })

  it('id события стабилен — повторная сборка не удваивает обращения', () => {
    const messages = [aiWithKb('m1')]
    const first = buildKbUsageFromMessages(messages, { conversationId: 'c1' })
    const second = buildKbUsageFromMessages(messages, { conversationId: 'c1' })
    expect(first.recent[0].id).toBe(second.recent[0].id)
  })
})

describe('mergeKbUsage', () => {
  it('без серверного отчёта отдаёт производный из истории', () => {
    const fallback = buildKbUsageFromMessages([aiWithKb('m1')], { conversationId: 'c1' })
    expect(mergeKbUsage(null, fallback)).toBe(fallback)
  })

  it('АНТИ-РЕГРЕСС: ход, уже посчитанный сервером, из истории не добавляется', () => {
    const server = makeKbUsageReport({ recent: [makeKbQuery({ id: 'kbu-1', messageId: 'm1', chars: 500, sections: [makeKbSection({ chars: 500 })] })] })
    const fallback = buildKbUsageFromMessages([aiWithKb('m1', { chars: 500 })], { conversationId: 'c1' })
    const merged = mergeKbUsage(server, fallback)
    expect(merged.totals.queries).toBe(1)
    expect(merged.totals.chars).toBe(500)
    expect(merged.recent).toHaveLength(1)
  })

  it('неизвестный серверу ход из истории добавляется в ленту и итоги', () => {
    const server = makeKbUsageReport({ recent: [makeKbQuery({ id: 'kbu-1', messageId: 'm1', chars: 500, sections: [makeKbSection({ chars: 500 })] })] })
    const fallback = buildKbUsageFromMessages([aiWithKb('m1', { chars: 500 }), aiWithKb('m2', { chars: 300, createdAt: KB_T0 - 5000 })], { conversationId: 'c1' })
    const merged = mergeKbUsage(server, fallback)
    expect(merged.totals.queries).toBe(2)
    expect(merged.totals.chars).toBe(800)
    expect(merged.recent.map((query) => query.messageId)).toEqual(['m1', 'm2'])
  })

  it('урезанная лимитом серверная лента отключает подмешивание истории', () => {
    const server = makeKbUsageReport({
      recent: [makeKbQuery({ id: 'kbu-1', messageId: 'm1' })],
      totals: { ...makeKbUsageReport().totals, queries: 50 }
    })
    const fallback = buildKbUsageFromMessages([aiWithKb('m2')], { conversationId: 'c1' })
    expect(mergeKbUsage(server, fallback)).toBe(server)
  })
})

describe('applyKbUsageFrame', () => {
  it('pending попадает в ленту, но не в итоги', () => {
    const cache = kbUsageSnapshot(makeKbUsageReport({ recent: [] }))
    const pending = makeKbQuery({ id: 'new', seq: 9, status: 'pending', chars: 0, sections: [] })
    const next = applyKbUsageFrame(cache, pending)
    expect(next.report!.recent[0].status).toBe('pending')
    expect(next.report!.totals.queries).toBe(0)
    expect(next.report!.lastSeq).toBe(9)
  })

  it('терминальный кадр заменяет pending по id и считается один раз', () => {
    const cache = kbUsageSnapshot(makeKbUsageReport({ recent: [] }))
    const pending = makeKbQuery({ id: 'new', seq: 9, status: 'pending', chars: 0, sections: [] })
    const done = makeKbQuery({ id: 'new', seq: 9, chars: 800, sections: [makeKbSection({ chars: 800 })] })
    let next = applyKbUsageFrame(cache, pending)
    next = applyKbUsageFrame(next, done)
    expect(next.report!.recent).toHaveLength(1)
    expect(next.report!.totals).toMatchObject({ queries: 1, chars: 800, documents: 1 })
    // Повторная доставка того же кадра ничего не удваивает (идемпотентность).
    next = applyKbUsageFrame(next, done)
    expect(next.report!.totals).toMatchObject({ queries: 1, chars: 800 })
    expect(next.report!.recent).toHaveLength(1)
    expect(next.report!.sections[0].times).toBe(1)
  })

  it('устаревший кадр (seq ≤ lastSeq) отбрасывается — снапшот уже его учёл', () => {
    const cache = kbUsageSnapshot(makeKbUsageReport())
    const stale = makeKbQuery({ id: 'unknown', seq: 1, chars: 999 })
    expect(applyKbUsageFrame(cache, stale)).toBe(cache)
  })

  it('без загруженного отчёта кадр не применяется', () => {
    const empty = { report: null, counted: [] }
    expect(applyKbUsageFrame(empty, makeKbQuery())).toBe(empty)
  })

  it('свежий кадр добавляет новый раздел в агрегат', () => {
    const cache = kbUsageSnapshot(makeKbUsageReport({ recent: makeKbQueries() }))
    const before = cache.report!.sections.length
    const fresh = makeKbQuery({
      id: 'kbu-9', seq: 9, source: 'tool_document', chars: 700,
      sections: [makeKbSection({ documentId: 'ui', title: 'UI', heading: 'Панели', anchor: 'paneli', sourcePath: 'docs/kb/ui.md', chars: 700 })]
    })
    const next = applyKbUsageFrame(cache, fresh)
    expect(next.report!.sections).toHaveLength(before + 1)
    expect(next.report!.totals.documents).toBeGreaterThan(cache.report!.totals.documents)
  })
})

describe('kbUsageShare', () => {
  it('без известных промптов доли нет (null, а не 0%)', () => {
    const { totals } = aggregateKbUsage([makeKbQuery({ promptChars: null })])
    expect(kbUsageShare(totals)).toBeNull()
  })
})

import type { KbContextBundle } from '@voicechat/shared'
import { describe, expect, it } from 'vitest'
import { buildKbAutoContext, KB_AUTO_CONTEXT_BUDGET } from './autoContext.js'
import type { KnowledgeBaseService } from './types.js'

function section(index: number, text: string) {
  return {
    documentId: `doc-${index}`, chunkId: `doc-${index}#section-${index}`,
    title: `Документ ${index}`, heading: `Раздел ${index}`,
    excerpt: text.slice(0, 10), text, score: 12 - index,
    matchTypes: ['symbol' as const], explanation: 'Точное совпадение символа',
    freshness: 'current' as const, sourcePath: `docs/kb/doc-${index}.md`,
    anchor: `section-${index}`, symbols: [], relatedFiles: []
  }
}

function kb(bundle: KbContextBundle): KnowledgeBaseService {
  return {
    status: () => ({ available: true, mode: 'source', searchMode: 'lexical', version: 'x', createdAt: 'now', documents: 1, chunks: 1, staleDocuments: 0 }),
    topics: () => [],
    document: () => null,
    search: async () => [],
    context: async () => structuredClone(bundle)
  }
}

describe('buildKbAutoContext', () => {
  it('кладёт полные тела первых двух разделов, а остальные — ссылками в пределах бюджета', async () => {
    const body1 = 'Полное тело первого раздела, включая важную концовку.'
    const body2 = 'Полное тело второго раздела, тоже без excerpt-обрезки.'
    const bundle: KbContextBundle = {
      query: 'q', confidence: 'high', autoInjectAllowed: true,
      sections: [section(1, body1), section(2, body2), section(3, 'третье тело'), section(4, 'четвёртое тело')],
      relatedFiles: [], relatedDocuments: [], staleWarnings: [], estimatedTokens: 0
    }
    const result = await buildKbAutoContext(kb(bundle), 'q', { userId: 'u', projectIds: [] })
    expect(result.text).toContain(body1)
    expect(result.text).toContain(body2)
    expect(result.text).not.toContain('третье тело')
    expect(result.text).toContain('Документ 3 / Раздел 3 · `doc-3#section-3`')
    expect(result.text.length).toBeLessThanOrEqual(KB_AUTO_CONTEXT_BUDGET)
    expect(result.bundle.estimatedTokens).toBe(Math.ceil(result.text.length / 4))
    expect(result.sections.map((item) => item.chars)).toEqual(
      result.contextSections.map((item) => item.chars)
    )
  })

  it.each(['medium', 'low'] as const)('%s confidence не инъектируется', async (confidence) => {
    const bundle: KbContextBundle = {
      query: 'q', confidence, autoInjectAllowed: false, sections: [section(1, 'тело')],
      relatedFiles: [], relatedDocuments: [], staleWarnings: [], estimatedTokens: 0
    }
    const result = await buildKbAutoContext(kb(bundle), 'q', { userId: 'u', projectIds: [] })
    expect(result.text).toBe('')
    expect(result.sections).toEqual([])
  })

  it('на остатке бюджета отдаёт ссылки вместо тел и обрывается, когда не влезает и ссылка', async () => {
    const first = section(1, 'x'.repeat(300))
    const second = section(2, 'y'.repeat(300))
    const bundle: KbContextBundle = {
      query: 'q', confidence: 'high', autoInjectAllowed: true, sections: [first, second, section(3, 'z')],
      relatedFiles: [], relatedDocuments: [], staleWarnings: [], estimatedTokens: 0
    }
    const one = await buildKbAutoContext(kb(bundle), 'q', { userId: 'u', projectIds: [] }, 520)
    expect(one.contextSections.map((item) => item.documentId)).toEqual(['doc-1', 'doc-2'])
    // Тело второго не влезло — ушла ссылка; третий не влез даже ссылкой.
    expect(one.text).toContain('Документ 2 / Раздел 2 · `doc-2#section-2`')
    expect(one.text).not.toContain('y'.repeat(300))
    expect(one.text).not.toContain('doc-3')
    expect(one.text.length).toBeLessThanOrEqual(520)
  })

  it('раздел длиннее бюджета уходит обрезанным со ссылкой, а не пропадает', async () => {
    // Регрессия CHAT-68: первый же раздел не влезал целиком, цикл прерывался на
    // нулевом блоке, и high-confidence выдача превращалась в пустую инъекцию.
    const bundle: KbContextBundle = {
      query: 'q', confidence: 'high', autoInjectAllowed: true,
      sections: [section(1, 'ы'.repeat(7500)), section(2, 'второе тело')],
      relatedFiles: [], relatedDocuments: [], staleWarnings: [], estimatedTokens: 0
    }
    const result = await buildKbAutoContext(kb(bundle), 'запрос про раздел', { userId: 'u', projectIds: [] })
    expect(result.emptyReason).toBeNull()
    expect(result.text).toContain('раздел обрезан')
    expect(result.text).toContain('doc-1#section-1')
    expect(result.text.length).toBeLessThanOrEqual(KB_AUTO_CONTEXT_BUDGET)
    expect(result.contextSections.map((item) => item.documentId)).toEqual(['doc-1'])
  })

  it('второй раздел не обрезается ради бюджета, а уходит ссылкой', async () => {
    const bundle: KbContextBundle = {
      query: 'q', confidence: 'high', autoInjectAllowed: true,
      sections: [section(1, 'a'.repeat(1500)), section(2, 'b'.repeat(3000)), section(3, 'третье')],
      relatedFiles: [], relatedDocuments: [], staleWarnings: [], estimatedTokens: 0
    }
    const result = await buildKbAutoContext(kb(bundle), 'запрос', { userId: 'u', projectIds: [] })
    expect(result.text).toContain('a'.repeat(1500))
    expect(result.text).not.toContain('раздел обрезан')
    expect(result.text).toContain('Документ 2 / Раздел 2 · `doc-2#section-2`')
    expect(result.text).toContain('Документ 3 / Раздел 3 · `doc-3#section-3`')
  })

  it('лексическая дорожка пуста — разделы берутся по путям задачи', async () => {
    const lexical: KbContextBundle = {
      query: 'q', confidence: 'low', autoInjectAllowed: false, sections: [],
      relatedFiles: [], relatedDocuments: [], staleWarnings: [], estimatedTokens: 0
    }
    const byPath: KbContextBundle = {
      ...lexical, confidence: 'medium',
      sections: [
        { ...section(9, 'тело раздела про CI-раннер'), matchTypes: ['lexical'], relatedFiles: ['apps/server/src/ci'] },
        { ...section(8, 'мимо'), matchTypes: ['lexical'], relatedFiles: ['packages/ui/src/components/kanban'] }
      ]
    }
    const asked: string[] = []
    const service = kb(lexical)
    service.context = async (query: string) => {
      asked.push(query)
      return structuredClone(asked.length === 1 ? lexical : byPath)
    }
    const result = await buildKbAutoContext(
      service,
      { text: 'ничего не находящая проза', paths: ['apps/server/src/ci/kbHit.ts'], symbols: ['calculateKbHit'] },
      { userId: 'u', projectIds: [] }
    )
    expect(asked[1]).toBe('apps/server/src/ci/kbHit.ts calculateKbHit')
    expect(result.lane).toBe('code')
    expect(result.text).toContain('тело раздела про CI-раннер')
    // Раздел, не привязанный к упомянутым путям, в инъекцию не попадает.
    expect(result.text).not.toContain('мимо')
    expect(result.emptyReason).toBeNull()
  })

  it('пустая выдача называет причину: слабые совпадения и полное отсутствие', async () => {
    const weak: KbContextBundle = {
      query: 'q', confidence: 'medium', autoInjectAllowed: false, sections: [section(1, 'тело')],
      relatedFiles: [], relatedDocuments: [], staleWarnings: [], estimatedTokens: 0
    }
    const weakResult = await buildKbAutoContext(kb(weak), 'проза без кода', { userId: 'u', projectIds: [] })
    expect(weakResult).toMatchObject({ emptyReason: 'low-confidence', lane: null, text: '' })
    expect(weakResult.bundle.confidence).toBe('medium')

    const none: KbContextBundle = { ...weak, confidence: 'low', sections: [] }
    const noneResult = await buildKbAutoContext(kb(none), 'проза без кода', { userId: 'u', projectIds: [] })
    expect(noneResult.emptyReason).toBe('no-match')
  })

  it('бюджет меньше минимального блока даёт причину budget, а не молчание', async () => {
    const bundle: KbContextBundle = {
      query: 'q', confidence: 'high', autoInjectAllowed: true, sections: [section(1, 'т'.repeat(900))],
      relatedFiles: [], relatedDocuments: [], staleWarnings: [], estimatedTokens: 0
    }
    const result = await buildKbAutoContext(kb(bundle), 'запрос', { userId: 'u', projectIds: [] }, 120)
    expect(result).toMatchObject({ text: '', emptyReason: 'budget' })
  })
})

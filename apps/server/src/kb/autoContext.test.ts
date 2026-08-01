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

  it('останавливается после первого полного раздела, когда остатка бюджета не хватает', async () => {
    const first = section(1, 'x'.repeat(300))
    const second = section(2, 'y'.repeat(300))
    const bundle: KbContextBundle = {
      query: 'q', confidence: 'high', autoInjectAllowed: true, sections: [first, second, section(3, 'z')],
      relatedFiles: [], relatedDocuments: [], staleWarnings: [], estimatedTokens: 0
    }
    const one = await buildKbAutoContext(kb(bundle), 'q', { userId: 'u', projectIds: [] }, 520)
    expect(one.contextSections.map((item) => item.documentId)).toEqual(['doc-1'])
    expect(one.text.length).toBeLessThanOrEqual(520)
  })
})

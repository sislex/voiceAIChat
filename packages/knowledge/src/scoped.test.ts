import { describe, expect, it } from 'vitest'
import type { KbSearchResult } from '@voicechat/shared'
import { ScopedKnowledgeBase } from './scoped.js'
import type { KbScopedStore, KbStoredDocument } from './ports.js'
import type { KnowledgeBaseService } from './types.js'

const usageHit: KbSearchResult = {
  documentId: 'usage',
  chunkId: 'a-usage',
  title: 'Usage',
  heading: 'Usage',
  excerpt: 'needle',
  score: .01,
  matchTypes: ['semantic'],
  explanation: 'подтверждено',
  freshness: 'unknown',
  sourcePath: 'docs/kb/usage.md',
  anchor: 'usage',
  symbols: [],
  relatedFiles: [],
  scope: 'usage',
  projectId: null
}

const stored: KbStoredDocument = {
  id: 'z-personal',
  scope: 'user',
  ownerId: 'u',
  projectId: null,
  title: 'Personal',
  kind: 'feature',
  tags: [],
  areas: [],
  body: '# Personal\n\nneedle needle needle',
  checkedOn: null,
  createdBy: 'u',
  createdAt: 1,
  updatedAt: 1
}

describe('ScopedKnowledgeBase search', () => {
  it('объединяет разные корпуса по рангу, а не по несопоставимому BM25 score', async () => {
    const base: KnowledgeBaseService = {
      status: async () => ({ available: true, mode: 'source', searchMode: 'lexical', version: 'v', createdAt: 'now', documents: 1, chunks: 1, staleDocuments: 0 }),
      topics: async () => [],
      document: async () => null,
      search: async () => [usageHit],
      context: async () => ({ query: '', confidence: 'low', autoInjectAllowed: false, sections: [], relatedFiles: [], relatedDocuments: [], staleWarnings: [], estimatedTokens: 0 })
    }
    const store: KbScopedStore = {
      version: async () => '1',
      documents: async () => [stored],
      projectRepository: async () => null
    }
    const service = new ScopedKnowledgeBase(base, store)
    const results = await service.search(
      { query: 'needle', limit: 2 },
      { userId: 'u', projectIds: [] }
    )
    expect(results).toHaveLength(2)
    expect(results[0].chunkId).toBe('a-usage')
    expect(results[1].score).toBeGreaterThan(results[0].score)
  })

  it('calls the shared reranker once and only when stored articles join the usage corpus', async () => {
    const base: KnowledgeBaseService = {
      status: async () => ({ available: true, mode: 'source', searchMode: 'hybrid', version: 'v', createdAt: 'now', documents: 1, chunks: 1, staleDocuments: 0 }),
      topics: async () => [],
      document: async () => null,
      search: async () => [usageHit, { ...usageHit, chunkId: 'b-usage' }],
      context: async () => ({ query: '', confidence: 'low', autoInjectAllowed: false, sections: [], relatedFiles: [], relatedDocuments: [], staleWarnings: [], estimatedTokens: 0 })
    }
    const calls: string[][] = []
    const reranker = { rerank: async (_query: string, candidates: Array<{ chunkId: string }>) => {
      calls.push(candidates.map((item) => item.chunkId))
      return candidates.map((item) => item.chunkId).reverse()
    } }
    const withStored = (documents: KbStoredDocument[]): KbScopedStore => ({
      version: async () => String(documents.length),
      documents: async () => documents,
      projectRepository: async () => null
    })
    const usageOnly = new ScopedKnowledgeBase(base, withStored([]), reranker)
    expect((await usageOnly.search({ query: 'needle', limit: 5 }, { userId: 'u', projectIds: [] })).map((item) => item.chunkId))
      .toEqual(['a-usage', 'b-usage'])
    expect(calls).toEqual([])
    const mixed = new ScopedKnowledgeBase(base, withStored([stored]), reranker)
    await mixed.search({ query: 'needle', limit: 5 }, { userId: 'u', projectIds: [] })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('z-personal#personal')
  })
})

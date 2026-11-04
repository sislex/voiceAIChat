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
})

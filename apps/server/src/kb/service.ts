// Файловый источник базы знаний: темы docs/kb/*.md. Это раздел «Использование» —
// он одинаков для всех пользователей и правится коммитами в репозиторий (см.
// docs/kb/kb-workflow.md). Персональные и проектные знания живут в БД и
// приезжают через ScopedKnowledgeBase (scoped.ts), который надстроен над этим.

import { createHash } from 'node:crypto'
import type { KbContextBundle, KbDocument, KbDocumentSummary, KbSearchRequest, KbSearchResult, KbStatus } from '@voicechat/shared'
import { buildContext, listMarkdown, loadDocument, searchDocuments, summaryOf, type IndexedDocument } from './engine.js'
import type { KbSemanticReranker, KnowledgeBaseService } from './types.js'

/** Прочитать и проиндексировать все темы каталога (раздел «Использование»). */
export function loadFileDocuments(root: string): IndexedDocument[] {
  return listMarkdown(root).map((path) => loadDocument(root, path))
}

export class FileKnowledgeBaseService implements KnowledgeBaseService {
  private readonly documents: IndexedDocument[]
  private readonly byId: Map<string, IndexedDocument>
  private readonly createdAt = new Date().toISOString()
  private readonly version: string
  constructor(root: string, private readonly reranker?: KbSemanticReranker) {
    this.documents = loadFileDocuments(root)
    this.byId = new Map(this.documents.map((item) => [item.document.id, item]))
    this.version = createHash('sha256').update(this.documents.map((item) => `${item.document.sourcePath}\0${item.document.body}`).join('\0')).digest('hex').slice(0, 12)
  }
  /** Документы источника — их читает ScopedKnowledgeBase, добавляя к ним статьи из БД. */
  indexed(): IndexedDocument[] { return this.documents }
  status(): KbStatus { return { available: this.documents.length > 0, mode:'source', searchMode: this.reranker ? 'hybrid':'lexical', version:this.version, createdAt:this.createdAt, documents:this.documents.length, chunks:this.documents.reduce((n,item)=>n+item.chunks.length,0), staleDocuments:this.documents.filter((item)=>item.document.freshness==='stale').length } }
  topics(): KbDocumentSummary[] { return this.documents.map(({ document }) => summaryOf(document)) }
  document(id: string): KbDocument | null { return this.byId.get(id)?.document ?? null }
  async search(request: KbSearchRequest): Promise<KbSearchResult[]> { return searchDocuments(this.documents, request, this.reranker) }
  async context(query: string, budget = 3500): Promise<KbContextBundle> {
    void budget
    const texts = new Map(this.documents.flatMap((item) => item.chunks.map((chunk) => [chunk.id, chunk.text] as const)))
    return buildContext(query, await this.search({ query, limit: 8 }), (result) => texts.get(result.chunkId))
  }
}

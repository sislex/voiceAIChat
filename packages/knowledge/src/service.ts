import type { KbFiles } from './ports.js'
// Файловый источник базы знаний: темы docs/kb/*.md. Это раздел «Использование» —
// он одинаков для всех пользователей и правится коммитами в репозиторий (см.
// docs/kb/kb-workflow.md). Персональные и проектные знания живут в БД и
// приезжают через ScopedKnowledgeBase (scoped.ts), который надстроен над этим.

import { createHash } from 'node:crypto'
import type { KbContextBundle, KbDocument, KbDocumentSummary, KbSearchRequest, KbSearchResult, KbStatus } from '@voicechat/shared'
import { buildContext, loadDocument, searchDocuments, summaryOf, type IndexedDocument } from './engine.js'
import type { KbSemanticReranker, KbView, KnowledgeBaseService } from './types.js'

/** Прочитать и проиндексировать все темы каталога (раздел «Использование»). */
export function loadFileDocuments(root: string, module = 'core', sourceRoot: string, files: KbFiles): IndexedDocument[] {
  return files.listMarkdown(root).map((path) => loadDocument(root, path, module, sourceRoot, files))
}

export class FileKnowledgeBaseService implements KnowledgeBaseService {
  protected documents: IndexedDocument[]
  protected byId: Map<string, IndexedDocument>
  private readonly createdAt = new Date().toISOString()
  private get version(): string {
    return createHash('sha256').update(this.documents.map((item) => `${item.document.id}\0${item.document.body}`).join('\0')).digest('hex').slice(0, 12)
  }
  constructor(root: string, private readonly reranker: KbSemanticReranker | undefined, files: KbFiles) {
    this.documents = loadFileDocuments(root, 'core', 'docs/kb', files)
    this.byId = new Map(this.documents.map((item) => [item.document.id, item]))
  }
  /** Документы источника — их читает ScopedKnowledgeBase, добавляя к ним статьи из БД. */
  indexed(): IndexedDocument[] { return this.documents }
  async status(): Promise<KbStatus> { return { available: this.documents.length > 0, mode:'source', searchMode: this.reranker ? 'hybrid':'lexical', version:this.version, createdAt:this.createdAt, documents:this.documents.length, chunks:this.documents.reduce((n,item)=>n+item.chunks.length,0), staleDocuments:this.documents.filter((item)=>item.document.freshness==='stale').length } }
  async topics(view?: KbView): Promise<KbDocumentSummary[]> { return this.documents.filter(item => !view?.module || item.document.module === view.module).map(({ document }) => summaryOf(document)) }
  async document(id: string): Promise<KbDocument | null> {
    const separator = id.indexOf(':')
    const module = separator < 0 ? 'core' : id.slice(0, separator)
    const path = separator < 0 ? id : id.slice(separator + 1)
    return this.byId.get(`${module}:${path}`)?.document
      ?? this.documents.find(item => item.document.module === module && item.aliases.includes(path))?.document ?? null
  }
  async search(request: KbSearchRequest): Promise<KbSearchResult[]> { return searchDocuments(this.documents, request, this.reranker) }
  async context(query: string, budget = 3500, view?: KbView): Promise<KbContextBundle> {
    void budget
    const texts = new Map(this.documents.flatMap((item) => item.chunks.map((chunk) => [chunk.id, chunk.text] as const)))
    return buildContext(query, await this.search({ query, limit: 8, module: view?.module }), async (result) => texts.get(result.chunkId))
  }
}

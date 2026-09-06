// База знаний с разделами и контролем доступа.
//
// Источников два: файлы репозитория (раздел «Использование» — общий для всех,
// приходит из FileKnowledgeBaseService) и статьи из БД (разделы «Настройки
// пользователя» и «Разработка проекта»). Этот класс — единственное место, где
// решается, что пользователю видно: статью проекта отдаём, только если проект
// есть в `view.projectIds` (их собирает вызывающий через db.projects.getProject/
// listProjects), персональную — только владельцу.
//
// Фильтры `scope`/`projectId` в запросе СУЖАЮТ выдачу и никогда её не расширяют:
// проверка доступа идёт после них и по тем же полям вида.

import type { KbContextBundle, KbDocument, KbDocumentSummary, KbSearchRequest, KbSearchResult, KbStatus } from '@voicechat/shared'
import type { KbStoredDocument, VoiceChatDb } from '../db/database.js'
import { buildContext, documentChunkText, indexBody, searchDocuments, summaryOf, type IndexedDocument } from './engine.js'
import { PUBLIC_KB_VIEW, type KbSemanticReranker, type KbView, type KnowledgeBaseService } from './types.js'

/** Строка БД → документ индекса. sourcePath синтетический: файла у статьи нет. */
export function indexStored(row: KbStoredDocument): IndexedDocument {
  const sourcePath = row.scope === 'project' ? `проект/${row.projectId ?? ''}/${row.id}` : row.scope === 'user' ? `мои знания/${row.id}` : `использование/${row.id}`
  return indexBody({
    id: row.id,
    title: row.title,
    kind: row.kind,
    scope: row.scope,
    projectId: row.projectId,
    sourcePath,
    tags: row.tags,
    areas: row.areas,
    editable: true,
    ...(row.checkedOn ? { updated: row.checkedOn } : {})
  }, row.body)
}

/** Видна ли статья из БД этому виду (доступ, а не фильтр). */
export function canSee(row: { scope: string; ownerId: string | null; projectId: string | null }, view: KbView): boolean {
  if (row.scope === 'usage') return true
  if (row.scope === 'user') return view.userId !== null && row.ownerId === view.userId
  return row.projectId !== null && view.projectIds.includes(row.projectId)
}

export class ScopedKnowledgeBase implements KnowledgeBaseService {
  /** Кэш индекса статей БД: пересобирается, когда меняется версия набора. */
  private cache: { version: string; rows: KbStoredDocument[]; indexed: Map<string, IndexedDocument> } | null = null

  constructor(
    private readonly base: KnowledgeBaseService,
    private readonly db: VoiceChatDb,
    private readonly reranker?: KbSemanticReranker
  ) {}

  private stored(): { rows: KbStoredDocument[]; indexed: Map<string, IndexedDocument> } {
    const version = this.db.kb.kbDocumentsVersion()
    if (!this.cache || this.cache.version !== version) {
      const rows = this.db.kb.kbDocuments()
      this.cache = { version, rows, indexed: new Map(rows.map((row) => [row.id, indexStored(row)])) }
    }
    return this.cache
  }

  /** Статьи БД, видимые виду и прошедшие его фильтры. */
  private visibleStored(view: KbView): Array<{ row: KbStoredDocument; indexed: IndexedDocument }> {
    const { rows, indexed } = this.stored()
    return rows
      .filter((row) => canSee(row, view))
      .filter((row) => (view.scope ? row.scope === view.scope : true))
      // Фильтр проекта режет только проектные статьи: в ходе модели он сужает
      // «Разработку» до проекта чата, но не прячет общее и персональное.
      .filter((row) => (view.projectId && row.scope === 'project' ? row.projectId === view.projectId : true))
      .map((row) => ({ row, indexed: indexed.get(row.id) as IndexedDocument }))
  }

  /** Раздел «Использование» участвует, пока вкладка не сузила выдачу до другого раздела. */
  private usageIncluded(view: KbView): boolean {
    return !view.scope || view.scope === 'usage'
  }

  status(): KbStatus {
    const base = this.base.status()
    const stored = this.stored().rows.length
    return { ...base, available: base.available || stored > 0, documents: base.documents + stored }
  }

  topics(view: KbView = PUBLIC_KB_VIEW): KbDocumentSummary[] {
    const usage = this.usageIncluded(view) ? this.base.topics().map((topic) => ({ ...topic, scope: topic.scope ?? 'usage' })) : []
    return [...usage, ...this.visibleStored(view).map(({ indexed }) => summaryOf(indexed.document))]
  }

  document(id: string, view: KbView = PUBLIC_KB_VIEW): KbDocument | null {
    const { rows, indexed } = this.stored()
    const row = rows.find((item) => item.id === id)
    // Чужая статья — как отсутствующая: наличие id тоже не должно утекать.
    if (row) return canSee(row, view) ? indexed.get(row.id)?.document ?? null : null
    return this.base.document(id)
  }

  async search(request: KbSearchRequest, view: KbView = PUBLIC_KB_VIEW): Promise<KbSearchResult[]> {
    const scope = request.scope ?? view.scope
    const projectId = request.projectId ?? view.projectId ?? null
    // Проект не свой — выдача пустая (гейт маршрута отвечает 403 раньше, но
    // сервис не должен зависеть от того, что кто-то проверил доступ за него).
    if (projectId && !view.projectIds.includes(projectId)) return []
    const effective: KbView = { ...view, ...(scope ? { scope } : {}), projectId }
    const limit = Math.min(Math.max(request.limit ?? 20, 1), 50)
    const stored = this.visibleStored(effective)
    const [usage, own] = await Promise.all([
      this.usageIncluded(effective) ? this.base.search({ ...request, limit }) : Promise.resolve([]),
      stored.length ? searchDocuments(stored.map((item) => item.indexed), { ...request, limit }, this.reranker) : Promise.resolve([])
    ])
    // Оценки из двух индексов сравниваем напрямую: BM25 в них считается по одной
    // формуле, а разница в df на десятках статей меньше разрыва между попаданием
    // в символ/путь и обычным лексическим совпадением.
    return [...usage.map((item) => ({ ...item, scope: item.scope ?? ('usage' as const) })), ...own]
      .sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId))
      .slice(0, limit)
  }

  async context(query: string, budget = 3500, view: KbView = PUBLIC_KB_VIEW): Promise<KbContextBundle> {
    void budget
    const stored = this.visibleStored(view)
    const texts = new Map(stored.flatMap((item) => item.indexed.chunks.map((chunk) => [chunk.id, chunk.text] as const)))
    return buildContext(query, await this.search({ query, limit: 8 }, view), (result) => {
      const storedText = texts.get(result.chunkId)
      if (storedText !== undefined) return storedText
      const document = this.base.document(result.documentId)
      // Старые/внешние реализации KnowledgeBaseService могли не отдавать документ:
      // не роняем ход, но реальные File/Scoped-сервисы всегда проходят ветку выше.
      return document ? documentChunkText(document, result.chunkId) : result.excerpt
    })
  }
}

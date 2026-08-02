import type { KbContextBundle, KbDocument, KbDocumentSummary, KbScope, KbSearchRequest, KbSearchResult, KbStatus } from '@voicechat/shared'

/**
 * Кто и на что смотрит. Видимость считается ТОЛЬКО по этим полям, а не по
 * фильтрам запроса: `scope`/`projectId` в запросе сужают выдачу, но не расширяют
 * доступ. `userId: null` — системный вызов без пользователя: видна лишь
 * «Использование».
 */
export interface KbView {
  userId: string | null
  /** Проекты, в которых пользователь состоит (заполняет вызывающий из БД). */
  projectIds: string[]
  /** Фильтр раздела (вкладка UI); пусто — все доступные разделы. */
  scope?: KbScope
  /** Фильтр проекта; должен быть среди projectIds, иначе выдача пустая. */
  projectId?: string | null
}

/** Вид по умолчанию: только общий раздел «Использование». */
export const PUBLIC_KB_VIEW: KbView = { userId: null, projectIds: [] }

export interface KnowledgeBaseService {
  status(): KbStatus
  topics(view?: KbView): KbDocumentSummary[]
  document(id: string, view?: KbView): KbDocument | null
  search(request: KbSearchRequest, view?: KbView): Promise<KbSearchResult[]>
  context(query: string, budget?: number, view?: KbView): Promise<KbContextBundle>
}
export interface KbRerankCandidate { chunkId: string; title: string; heading: string; excerpt: string }
export interface KbSemanticReranker { rerank(query: string, candidates: KbRerankCandidate[], limit: number): Promise<string[]> }

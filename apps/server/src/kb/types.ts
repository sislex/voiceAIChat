import type { KbContextBundle, KbDocument, KbDocumentSummary, KbSearchRequest, KbSearchResult, KbStatus } from '@voicechat/shared'
export interface KnowledgeBaseService {
  status(): KbStatus
  topics(): KbDocumentSummary[]
  document(id: string): KbDocument | null
  search(request: KbSearchRequest): Promise<KbSearchResult[]>
  context(query: string, budget?: number): Promise<KbContextBundle>
}
export interface KbRerankCandidate { chunkId: string; title: string; heading: string; excerpt: string }
export interface KbSemanticReranker { rerank(query: string, candidates: KbRerankCandidate[], limit: number): Promise<string[]> }

/** Контракт read-only базы знаний проекта voiceAIChat. */
export type KbDocumentKind = 'feature' | 'subsystem' | 'protocol' | 'decision' | 'convention' | 'runbook' | 'package'
export type KbFreshness = 'current' | 'stale' | 'unknown'
export type KbMatchType = 'symbol' | 'alias' | 'path' | 'protocol' | 'lexical' | 'semantic'

export interface KbStatus {
  available: boolean
  mode: 'source' | 'generated' | 'disabled'
  searchMode: 'lexical' | 'hybrid'
  version: string
  createdAt: string
  documents: number
  chunks: number
  staleDocuments: number
  error?: string
}
export interface KbDocumentSummary {
  id: string; title: string; kind: KbDocumentKind; tags: string[]; packages: string[]
  freshness: KbFreshness; sourcePath: string
}
export interface KbDocument extends KbDocumentSummary {
  updated?: string; body: string; symbols: string[]; protocols: string[]; areas: string[]; related: string[]
  headings: Array<{ title: string; anchor: string; level: number }>
}
export interface KbSearchResult {
  documentId: string; chunkId: string; title: string; heading: string; excerpt: string; score: number
  matchTypes: KbMatchType[]; explanation: string; freshness: KbFreshness; sourcePath: string; anchor: string
  symbols: string[]; relatedFiles: string[]
}
export interface KbSearchRequest { query: string; kinds?: KbDocumentKind[]; tags?: string[]; limit?: number }
export interface KbContextBundle {
  query: string; confidence: 'high' | 'medium' | 'low'; autoInjectAllowed: boolean
  sections: KbSearchResult[]; relatedFiles: string[]; relatedDocuments: string[]
  staleWarnings: string[]; estimatedTokens: number
}

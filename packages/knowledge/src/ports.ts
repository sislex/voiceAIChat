import type { KbDocumentKind, KbScope } from '@voicechat/shared'
import type { KbSource } from './sources.js'

export interface KbFiles {
  exists(path: string): boolean
  read(path: string): string
  listMarkdown(root: string): string[]
}
export interface KbStoredDocument {
  id: string
  scope: KbScope
  ownerId: string | null
  projectId: string | null
  title: string
  kind: KbDocumentKind
  tags: string[]
  areas: string[]
  body: string
  checkedOn: string | null
  createdBy: string
  createdAt: number
  updatedAt: number
}
export interface KbScopedStore {
  version(): Promise<string>
  documents(): Promise<KbStoredDocument[]>
  projectRepository(userId: string, projectId: string): Promise<string | null | undefined>
}
/** Git and credentials remain entirely in the host. */
export interface KbGit {
  checkout(source: KbSource & { repository: string }, previousSha: string | null): Promise<{ root: string; sha: string }>
}

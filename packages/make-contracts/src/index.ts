export * from './core.js'
export * from './service.js'
export * from './internal.js'
export * from './hub.js'
export * from './taskScope.js'
export * from './httpCore.js'
export const MAKE_MCP_PATH = '/mcp/make'

/** Private fields are added only to authenticated owner responses, never project events. */
export interface MakeOwnerCommentFields {
  canReply?: true
  ownerReply?: string
}
export interface MakeOwnerReplyPatch {
  ownerReply?: string
}

/** Optional extensions carried by the existing Make renderer ports. */
export interface MakeWriteOptions {
  kind?: 'file' | 'directory'
  createOnly?: boolean
}
export interface MakeReplaceOptions {
  regex?: boolean
  matchCase?: boolean
  dryRun?: boolean
  previewToken?: string
  path?: string
  matchIndex?: number
}
export interface MakeSnapshotComparison {
  snapshotId: string
  compareSnapshotId?: string
}

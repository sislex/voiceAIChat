// File storage service contract: pooled storage nodes, per-user quotas from
// Identity, spaces (personal / chat / Make project) and Google-Docs-like shares.
// The service library lives in packages/file-storage; Core exposes the REST
// surface below and talks to nodes through FILE_STORAGE_NODE_PATHS.

/** Default per-user quota when Identity has no explicit `storageQuotaBytes`. */
export const DEFAULT_STORAGE_QUOTA_BYTES = 100 * 1024 * 1024
/** Largest single file accepted through the Core REST surface. */
export const MAX_STORAGE_FILE_BYTES = 64 * 1024 * 1024
export const MAX_STORAGE_PATH_LENGTH = 1024

export type StorageSpaceKind = 'personal' | 'chat' | 'make-project'

/** `read` lists and downloads; `write` also adds, changes, moves and deletes files. */
export type StoragePermission = 'read' | 'write'
/** Effective access of the caller to a space. */
export type StorageAccess = StoragePermission | 'owner'

export type StorageErrorCode =
  | 'storage_disabled'
  | 'invalid_path'
  | 'not_found'
  | 'forbidden'
  | 'quota_exceeded'
  | 'storage_full'
  | 'file_too_large'
  | 'revision_conflict'
  | 'node_unavailable'

export const STORAGE_ERROR_STATUS: Record<StorageErrorCode, number> = {
  storage_disabled: 503,
  invalid_path: 400,
  not_found: 404,
  forbidden: 403,
  quota_exceeded: 413,
  storage_full: 507,
  file_too_large: 413,
  revision_conflict: 409,
  node_unavailable: 503,
}

export interface StorageError {
  error: StorageErrorCode
  message: string
}

/** One running storage container. Capacity is what the container was given, not the host disk. */
export interface StorageNodeInfo {
  id: string
  capacityBytes: number
  usedBytes: number
  online: boolean
  lastSeenAt: number | null
}

/** Sum over all nodes: 10 GB + 60 GB nodes give 70 GB. */
export interface StorageClusterInfo {
  nodes: StorageNodeInfo[]
  capacityBytes: number
  usedBytes: number
  freeBytes: number
}

/** Usage of the caller; files in spaces the user owns count against the owner's quota. */
export interface StorageUsage {
  userId: string
  usedBytes: number
  quotaBytes: number
  fileCount: number
}

export interface StorageSpace {
  id: string
  kind: StorageSpaceKind
  ownerId: string
  title: string
  /** conversationId for `chat` and `make-project`, null for `personal`. */
  ref: string | null
  usedBytes: number
  fileCount: number
  access: StorageAccess
  createdAt: number
  updatedAt: number
}

export interface StorageEntry {
  path: string
  size: number
  mimeType: string
  /** Increments on every content change; send it as `If-Match` to avoid lost updates. */
  revision: number
  updatedAt: number
  updatedBy: string
}

export type StorageShareAudience =
  | { kind: 'user'; userId: string }
  /** Anyone signed in who opens the link gets the permission. */
  | { kind: 'link'; token: string }

export interface StorageShare {
  id: string
  spaceId: string
  permission: StoragePermission
  audience: StorageShareAudience
  createdAt: number
  createdBy: string
}

/** POST fileUrl; write reservations remain invisible until POST fileCommit. */
export type StorageFileUrlRequest =
  | { operation: 'read'; path: string }
  | { operation: 'write'; path: string; size: number; mimeType: string; ifMatch?: number; createOnly?: boolean }

export interface StorageDirectUrl {
  url: string
  method: 'GET' | 'PUT'
  headers?: Record<string, string>
  /** Unix milliseconds; direct capabilities last at most five minutes. */
  expiresAt: number
  /** Present for direct writes. Submit after PUT succeeds; fallback PUT commits itself. */
  reservationId?: string
}
export interface StorageFileCommitRequest { reservationId: string }
export const STORAGE_DIRECT_TTL_MS = 5 * 60 * 1000

/** Reference stored in chat history and Make metadata instead of a machine path. */
export interface StorageFileRef {
  spaceId: string
  path: string
}

export interface CreateStorageSpaceRequest {
  kind: StorageSpaceKind
  title: string
  ref?: string | null
}

/** PATCH STORAGE_REST.space returns StorageSpace; owner only, trimmed title of 1..200 characters. */
export interface UpdateStorageSpaceRequest {
  title: string
}

/** POST STORAGE_REST.mergeDuplicates; owner only. Preview before applying its token. */
export interface MergeStorageSpacesRequest {
  /** Defaults to preview without a token, apply with a token; true always previews. */
  dryRun?: boolean
  previewToken?: string
}
export interface MergeStorageSpacesResult {
  dryRun: boolean
  keepSpaceId: string
  deleteSpaceIds: string[]
  moves: Array<{ fromSpaceId: string; path: string; toPath?: string }>
  /** Older conflicting entries are preserved at toPath in the kept space. */
  conflicts: Array<{ fromSpaceId: string; path: string; toPath?: string }>
  /** Deleted spaces' shares are revoked, never widened to the survivor. */
  revokedShareIds: string[]
  previewToken: string
}

export interface ListStorageEntriesResponse {
  space: StorageSpace
  entries: StorageEntry[]
}

export interface MoveStorageEntryRequest {
  from: string
  to: string
}

export interface CreateStorageShareRequest {
  permission: StoragePermission
  /** A user id shares with that user; omitted creates a link share. */
  userId?: string
}

export interface StorageLinkInfo {
  space: Pick<StorageSpace, 'id' | 'kind' | 'title' | 'ownerId'>
  permission: StoragePermission
}

/**
 * Core REST surface. File bodies are raw bytes (`Content-Type` = file mime type);
 * `PUT .../file` accepts `If-Match: <revision>` and `If-None-Match: *` (create only).
 */
export const STORAGE_REST = {
  usage: '/api/storage/usage',
  cluster: '/api/storage/cluster',
  spaces: '/api/storage/spaces',
  space: (spaceId: string) => `/api/storage/spaces/${encodeURIComponent(spaceId)}`,
  mergeDuplicates: (spaceId: string) => `/api/storage/spaces/${encodeURIComponent(spaceId)}/merge-duplicates`,
  files: (spaceId: string) => `/api/storage/spaces/${encodeURIComponent(spaceId)}/files`,
  file: (spaceId: string) => `/api/storage/spaces/${encodeURIComponent(spaceId)}/file`,
  fileUrl: (spaceId: string) => `/api/storage/spaces/${encodeURIComponent(spaceId)}/file/url`,
  fileCommit: (spaceId: string) => `/api/storage/spaces/${encodeURIComponent(spaceId)}/file/commit`,
  move: (spaceId: string) => `/api/storage/spaces/${encodeURIComponent(spaceId)}/move`,
  shares: (spaceId: string) => `/api/storage/spaces/${encodeURIComponent(spaceId)}/shares`,
  share: (spaceId: string, shareId: string) =>
    `/api/storage/spaces/${encodeURIComponent(spaceId)}/shares/${encodeURIComponent(shareId)}`,
  /** GET describes the link; POST accepts it and adds the space to the caller's list. */
  link: (token: string) => `/api/storage/links/${encodeURIComponent(token)}`,
} as const

/** Storage node API. Health/blobs require Core bearer auth; direct uses a scoped HMAC capability. */
export const FILE_STORAGE_NODE_PATHS = {
  direct: (blobId: string) => `/v1/direct/${encodeURIComponent(blobId)}`,
  health: '/v1/health',
  blob: (blobId: string) => `/v1/blobs/${encodeURIComponent(blobId)}`,
} as const

export interface StorageNodeHealth {
  nodeId: string
  capacityBytes: number
  usedBytes: number
  freeBytes: number
}

export const STORAGE_NODE_SCOPE = 'file-storage.blobs'

const BLOB_ID = /^[A-Za-z0-9_-]{8,128}$/

export function isStorageBlobId(value: string): boolean {
  return BLOB_ID.test(value)
}

/**
 * Normalizes a space-relative path: forward slashes, no leading slash, no empty,
 * `.` or `..` segments, no control characters. Returns null when invalid.
 */
export function normalizeStoragePath(input: string): string | null {
  if (typeof input !== 'string') return null
  const parts = input.replace(/\\/g, '/').split('/').filter((part) => part !== '')
  if (parts.length === 0) return null
  for (const part of parts) {
    if (part === '.' || part === '..') return null
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(part)) return null
  }
  const path = parts.join('/')
  return path.length > MAX_STORAGE_PATH_LENGTH ? null : path
}

/** Normalizes a directory prefix for listing; empty means the space root. */
export function normalizeStoragePrefix(input: string | undefined | null): string | null {
  if (input == null || input.replace(/[\\/]/g, '') === '') return ''
  const path = normalizeStoragePath(input)
  return path == null ? null : `${path}/`
}

export function storageAllows(access: StorageAccess | null, needed: StoragePermission): boolean {
  if (access == null) return false
  if (access === 'owner' || access === 'write') return true
  return needed === 'read'
}

/** Strongest of several grants (ownership, direct shares, accepted links). */
export function strongestStorageAccess(grants: Array<StorageAccess | null | undefined>): StorageAccess | null {
  if (grants.includes('owner')) return 'owner'
  if (grants.includes('write')) return 'write'
  if (grants.includes('read')) return 'read'
  return null
}

export function storageQuotaBytes(identityQuota: number | null | undefined, fallback = DEFAULT_STORAGE_QUOTA_BYTES): number {
  return typeof identityQuota === 'number' && Number.isFinite(identityQuota) && identityQuota >= 0
    ? Math.floor(identityQuota)
    : fallback
}

/** Whether writing `newBytes` in place of `replacedBytes` keeps the owner within quota. */
export function fitsStorageQuota(usage: Pick<StorageUsage, 'usedBytes' | 'quotaBytes'>, newBytes: number, replacedBytes = 0): boolean {
  return usage.usedBytes - replacedBytes + newBytes <= usage.quotaBytes
}

export function summarizeStorageCluster(nodes: StorageNodeInfo[]): StorageClusterInfo {
  const online = nodes.filter((node) => node.online)
  const capacityBytes = online.reduce((sum, node) => sum + node.capacityBytes, 0)
  const usedBytes = online.reduce((sum, node) => sum + node.usedBytes, 0)
  return { nodes, capacityBytes, usedBytes, freeBytes: Math.max(0, capacityBytes - usedBytes) }
}

/** Picks the online node with the most free space that can hold `size` bytes. */
export function pickStorageNode(nodes: StorageNodeInfo[], size: number): StorageNodeInfo | null {
  let best: StorageNodeInfo | null = null
  let bestFree = -1
  for (const node of nodes) {
    if (!node.online) continue
    const free = node.capacityBytes - node.usedBytes
    if (free >= size && free > bestFree) {
      best = node
      bestFree = free
    }
  }
  return best
}

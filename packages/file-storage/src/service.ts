import { createHash } from 'node:crypto'
import type { MergeStorageSpacesRequest, MergeStorageSpacesResult } from '@voicechat/shared/fileStorage'
import {
  MAX_STORAGE_FILE_BYTES, fitsStorageQuota, normalizeStoragePath, normalizeStoragePrefix,
  pickStorageNode, storageAllows, strongestStorageAccess, summarizeStorageCluster,
  type CreateStorageSpaceRequest, type UpdateStorageSpaceRequest, type CreateStorageShareRequest, type StorageAccess,
  type StorageEntry, type StorageNodeInfo, type StoragePermission, type StorageShare,
  type StorageSpace, type StorageUsage, type StorageLinkInfo,
} from '@voicechat/shared/fileStorage'
import { signDirectUrl, type StorageNodeClient } from './client.js'
import { STORAGE_REST, STORAGE_DIRECT_TTL_MS, type StorageFileUrlRequest, type StorageDirectUrl } from '@voicechat/shared/fileStorage'
import type { StorageMetadataStore, StorageMetadataTransaction, StoredEntry, StoredSpace } from './metadata.js'
import { StorageServiceError } from './errors.js'

export interface FileStoragePorts {
  directNode?(nodeId: string): { publicUrl: string; secret: string } | undefined
  metadata: StorageMetadataStore
  nodes(): StorageNodeClient[]
  /** Host-owned health cache. Coordinator never mutates these objects. */
  nodeInfo(): StorageNodeInfo[]
  quota(userId: string): Promise<number>
  now(): number
  /** Unique, unpredictable IDs valid as blob IDs (for example randomUUID). */
  newId(): string
  /** Failed post-commit cleanup leaves an unreferenced blob; host can enqueue GC. */
  onCleanupError?(entry: StoredEntry, error: unknown): void
}
export interface WriteStorageFileOptions {
  mimeType?: string
  ifMatch?: number
  createOnly?: boolean
}
export function createFileStorageService(ports: FileStoragePorts) {
  const fail = (code: ConstructorParameters<typeof StorageServiceError>[0]): never => { throw new StorageServiceError(code) }
  function signedIn(userId: string) { if (typeof userId !== 'string' || !userId.trim()) fail('forbidden') }
  function path(input: string) { return normalizeStoragePath(input) ?? fail('invalid_path') }
  const entryView = ({ spaceId: _space, blobId: _blob, nodeId: _node, ...entry }: StoredEntry): StorageEntry => entry
  async function access(tx: StorageMetadataTransaction, userId: string, space: StoredSpace): Promise<StorageAccess | null> {
    const accepted = new Set((await tx.listAcceptances(userId)).map(a => a.shareId))
    const shares = await tx.listShares(space.id)
    return strongestStorageAccess([
      space.ownerId === userId ? 'owner' : null,
      ...shares.filter(s => s.audience.kind === 'user' ? s.audience.userId === userId : accepted.has(s.id)).map(s => s.permission),
    ])
  }
  async function requireSpace(tx: StorageMetadataTransaction, userId: string, id: string, needed: StoragePermission, owner = false) {
    signedIn(userId)
    const space = await tx.getSpace(id) ?? fail('not_found')
    const grant = await access(tx, userId, space)
    if (!storageAllows(grant, needed) || (owner && grant !== 'owner')) fail('forbidden')
    return space
  }
  async function view(tx: StorageMetadataTransaction, userId: string, space: StoredSpace): Promise<StorageSpace> {
    const entries = await tx.listEntries(space.id)
    return { ...space, usedBytes: entries.reduce((n, e) => n + e.size, 0), fileCount: entries.length,
      access: await access(tx, userId, space) ?? fail('forbidden') }
  }
  function client(nodeId: string) {
    if (!ports.nodeInfo().some(n => n.id === nodeId && n.online)) fail('node_unavailable')
    return ports.nodes().find(n => n.id === nodeId) ?? fail('node_unavailable')
  }
  async function nodeCall<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn() } catch (error) {
      if (error instanceof StorageServiceError) throw error
      return fail('node_unavailable')
    }
  }
  async function cleanup(entries: StoredEntry[]) {
    for (const entry of entries) {
      try { await nodeCall(() => client(entry.nodeId).delete(entry.blobId)) }
      catch (error) {
        // A cleanup failure must not turn a committed write into a reported failure.
        try { ports.onCleanupError?.(entry, error) } catch { /* Host diagnostics cannot undo a commit. */ }
      }
    }
  }
  async function touch(tx: StorageMetadataTransaction, space: StoredSpace) {
    await tx.putSpace({ ...space, updatedAt: ports.now() })
  }
  async function link(tx: StorageMetadataTransaction, userId: string, token: string) {
    signedIn(userId)
    const share = await tx.getLink(token) ?? fail('not_found')
    if (!storageAllows(share.permission, 'read')) fail('forbidden')
    const space = await tx.getSpace(share.spaceId) ?? fail('not_found')
    return { share, space }
  }
  async function prepareWrite(tx: StorageMetadataTransaction, userId: string, spaceId: string, input: string, size: number, options: WriteStorageFileOptions) {
    const space = await requireSpace(tx, userId, spaceId, 'write')
    const normalized = path(input)
    if (!Number.isSafeInteger(size) || size < 0) fail('invalid_path')
    if (size > MAX_STORAGE_FILE_BYTES) fail('file_too_large')
    if (options.ifMatch !== undefined && (!Number.isSafeInteger(options.ifMatch) || options.ifMatch < 1)) fail('revision_conflict')
    if (options.createOnly !== undefined && typeof options.createOnly !== 'boolean') fail('invalid_path')
    const mimeType = options.mimeType ?? 'application/octet-stream'
    if (typeof mimeType !== 'string' || !mimeType || mimeType.length > 256 || /[\r\n]/.test(mimeType)) fail('invalid_path')
    const previous = await tx.getEntry(spaceId, normalized)
    if ((options.createOnly && previous) || (options.ifMatch !== undefined && previous?.revision !== options.ifMatch)) fail('revision_conflict')
    const pending = (await tx.listReservations()).filter(r => r.expiresAt > ports.now())
    if (pending.some(r => r.entry.spaceId === spaceId && r.entry.path === normalized)) fail('revision_conflict')
    const usage = await tx.ownerUsage(space.ownerId)
    usage.usedBytes += pending.filter(r => r.ownerId === space.ownerId).reduce((n, r) => n + r.chargedBytes, 0)
    const quotaBytes = await ports.quota(space.ownerId)
    if (!Number.isFinite(quotaBytes) || quotaBytes < 0 ||
        !fitsStorageQuota({ ...usage, quotaBytes }, size, previous?.size ?? 0)) fail('quota_exceeded')
    const nodes = ports.nodeInfo().map(n => ({ ...n,
      usedBytes: n.usedBytes + pending.filter(r => r.entry.nodeId === n.id).reduce((sum, r) => sum + r.entry.size, 0) }))
    if (!ports.nodes().length) fail('storage_disabled')
    if (!nodes.some(n => n.online)) fail('node_unavailable')
    const node = pickStorageNode(nodes, size) ?? fail('storage_full')
    const entry: StoredEntry = { spaceId, path: normalized, size, mimeType,
      revision: (previous?.revision ?? 0) + 1, updatedAt: ports.now(), updatedBy: userId, blobId: ports.newId(), nodeId: node.id }
    return { space, previous, entry }
  }
  return {
    async fileUrl(userId: string, spaceId: string, request: StorageFileUrlRequest): Promise<StorageDirectUrl> {
      return ports.metadata.transaction(async tx => {
        if (!request || !['read', 'write'].includes(request.operation)) fail('invalid_path')
        const expiresAt = ports.now() + STORAGE_DIRECT_TTL_MS
        if (request.operation === 'read') {
          await requireSpace(tx, userId, spaceId, 'read')
          const entry = await tx.getEntry(spaceId, path(request.path)) ?? fail('not_found')
          client(entry.nodeId)
          const direct = ports.directNode?.(entry.nodeId)
          return { method: 'GET', expiresAt, url: direct
            ? signDirectUrl(direct.publicUrl, direct.secret, { blobId: entry.blobId, size: entry.size, mimeType: entry.mimeType, method: 'GET', expiresAt })
            : STORAGE_REST.file(spaceId) + '?path=' + encodeURIComponent(entry.path) }
        }
        if (typeof request.mimeType !== 'string') fail('invalid_path')
        const { space, previous, entry } = await prepareWrite(tx, userId, spaceId, request.path, request.size, request)
        const direct = ports.directNode?.(entry.nodeId)
        const headers: Record<string, string> = { 'content-type': entry.mimeType }
        if (!direct) {
          if (request.ifMatch !== undefined) headers['if-match'] = String(request.ifMatch)
          if (request.createOnly) headers['if-none-match'] = '*'
          return { url: STORAGE_REST.file(spaceId) + '?path=' + encodeURIComponent(entry.path), method: 'PUT', headers, expiresAt }
        }
        if (!client(entry.nodeId).stat) fail('node_unavailable')
        await tx.putReservation({ id: entry.blobId, entry, ownerId: space.ownerId,
          previousBlobId: previous?.blobId ?? null, chargedBytes: Math.max(0, entry.size - (previous?.size ?? 0)), expiresAt })
        return { url: signDirectUrl(direct.publicUrl, direct.secret, { blobId: entry.blobId, size: entry.size,
          mimeType: entry.mimeType, method: 'PUT', expiresAt }), method: 'PUT', headers, expiresAt, reservationId: entry.blobId }
      })
    },
    async commitFile(userId: string, spaceId: string, reservationId: string) {
      let previous: StoredEntry | null = null
      const result = await ports.metadata.transaction(async tx => {
        const space = await requireSpace(tx, userId, spaceId, 'write')
        const r = (await tx.listReservations()).find(r => r.id === reservationId && r.entry.spaceId === spaceId) ?? fail('not_found')
        if (r.entry.updatedBy !== userId) fail('forbidden')
        if (r.expiresAt <= ports.now()) fail('revision_conflict')
        previous = await tx.getEntry(spaceId, r.entry.path)
        if ((previous?.blobId ?? null) !== r.previousBlobId) fail('revision_conflict')
        const usage = await tx.ownerUsage(space.ownerId)
        usage.usedBytes += (await tx.listReservations()).filter(p => p.id !== r.id && p.ownerId === space.ownerId && p.expiresAt > ports.now())
          .reduce((n, p) => n + p.chargedBytes, 0)
        const quotaBytes = await ports.quota(space.ownerId)
        if (!Number.isFinite(quotaBytes) || quotaBytes < 0 || !fitsStorageQuota({ ...usage, quotaBytes }, r.entry.size, previous?.size ?? 0)) fail('quota_exceeded')
        const node = client(r.entry.nodeId)
        if (!node.stat) fail('node_unavailable')
        const stat = await nodeCall(() => node.stat!(r.entry.blobId))
        if (stat.size !== r.entry.size) fail('revision_conflict')
        if (r.expiresAt <= ports.now()) fail('revision_conflict')
        await tx.putEntry(r.entry)
        await tx.deleteReservation(r.id)
        await touch(tx, space)
        return entryView(r.entry)
      })
      if (previous) await cleanup([previous])
      return result
    },
    async cleanupReservations() {
      // Keep failed cleanup jobs durable and retry them on the next poll/restart.
      await ports.metadata.transaction(async tx => {
        for (const r of await tx.listReservations()) {
          if (r.expiresAt > ports.now()) continue
          try {
            await nodeCall(() => client(r.entry.nodeId).delete(r.entry.blobId))
            await tx.deleteReservation(r.id)
          } catch (error) { try { ports.onCleanupError?.(r.entry, error) } catch { /* Retry later. */ } }
        }
      })
    },
    async createSpace(userId: string, request: CreateStorageSpaceRequest) {
      signedIn(userId)
      if (!storageAllows('owner', 'write')) fail('forbidden')
      if (!['personal', 'chat', 'make-project'].includes(request.kind)) fail('invalid_path')
      return ports.metadata.transaction(async tx => {
        const now = ports.now()
        const space: StoredSpace = { id: ports.newId(), ownerId: userId, kind: request.kind,
          title: request.title, ref: request.ref ?? null, createdAt: now, updatedAt: now }
        return view(tx, userId, await tx.createSpace(space))
      })
    },
    async listSpaces(userId: string) {
      signedIn(userId)
      return ports.metadata.transaction(async tx => {
        const result: StorageSpace[] = []
        for (const space of await tx.listSpaces())
          if (storageAllows(await access(tx, userId, space), 'read')) result.push(await view(tx, userId, space))
        return result
      })
    },
    async getSpace(userId: string, spaceId: string) {
      return ports.metadata.transaction(async tx => view(tx, userId, await requireSpace(tx, userId, spaceId, 'read')))
    },
    async updateSpace(userId: string, spaceId: string, request: UpdateStorageSpaceRequest) {
      return ports.metadata.transaction(async tx => {
        const space = await requireSpace(tx, userId, spaceId, 'write', true)
        if (typeof request.title !== 'string' || !request.title.trim() || request.title.trim().length > 200) fail('invalid_path')
        const updated = { ...space, title: request.title.trim(), updatedAt: ports.now() }
        await tx.putSpace(updated)
        return view(tx, userId, updated)
      })
    },
    async mergeDuplicates(userId: string, spaceId: string, request: MergeStorageSpacesRequest = {}): Promise<MergeStorageSpacesResult> {
      return ports.metadata.transaction(async tx => {
        const source = await requireSpace(tx, userId, spaceId, 'write', true)
        if (source.kind === 'personal') fail('invalid_path')
        if (request.dryRun !== undefined && typeof request.dryRun !== 'boolean') fail('invalid_path')
        const group = []
        for (const space of await tx.listSpaces()) {
          if (space.ownerId === source.ownerId && space.kind === source.kind && space.ref === source.ref)
            group.push({ space, entries: (await tx.listEntries(space.id)).sort((a, b) => a.path.localeCompare(b.path)),
              shares: (await tx.listShares(space.id)).sort((a, b) => a.id.localeCompare(b.id)) })
        }
        group.sort((a, b) => b.entries.length - a.entries.length ||
          a.space.createdAt - b.space.createdAt || a.space.id.localeCompare(b.space.id))
        const [keep, ...duplicates] = group
        const entries = new Map<string, StoredEntry[]>()
        for (const member of group) for (const entry of member.entries) {
          const versions = entries.get(entry.path) ?? []
          versions.push(entry)
          entries.set(entry.path, versions)
        }
        const occupied = new Set(entries.keys())
        const moves: StoredEntry[] = []
        const result: MergeStorageSpacesResult = {
          dryRun: request.dryRun ?? (request.previewToken === undefined), keepSpaceId: keep.space.id,
          deleteSpaceIds: duplicates.map(d => d.space.id), moves: [], conflicts: [],
          revokedShareIds: duplicates.flatMap(d => d.shares.map(s => s.id)),
          previewToken: createHash('sha256').update(JSON.stringify(group)).digest('hex'),
        }
        for (const versions of entries.values()) {
          // Revisions are local to each space; timestamps order versions across spaces.
          versions.sort((a, b) => b.updatedAt - a.updatedAt || b.revision - a.revision ||
            Number(b.spaceId === keep.space.id) - Number(a.spaceId === keep.space.id) ||
            a.spaceId.localeCompare(b.spaceId))
          const [latest, ...older] = versions
          for (const entry of older) {
            const prefix = `.duplicates/${entry.spaceId}`
            // Keep even maximum-length source paths addressable through the API.
            const archiveName = normalizeStoragePath(`${prefix}/999999999/${entry.path}`)
              ? entry.path : createHash('sha256').update(entry.path).digest('hex')
            let target = `${prefix}/${archiveName}`
            let suffix = 1
            while (occupied.has(target)) target = `${prefix}/${suffix++}/${archiveName}`
            path(target)
            occupied.add(target)
            moves.push({ ...entry, path: target })
            result.conflicts.push({ fromSpaceId: entry.spaceId, path: entry.path, toPath: target })
            result.moves.push({ fromSpaceId: entry.spaceId, path: entry.path, toPath: target })
          }
          if (latest.spaceId !== keep.space.id) {
            moves.push(latest)
            result.moves.push({ fromSpaceId: latest.spaceId, path: latest.path })
          }
        }
        if (result.dryRun) return result
        if (request.previewToken !== result.previewToken) fail('revision_conflict')
        for (const entry of moves) await tx.putEntry({ ...entry, spaceId: keep.space.id })
        for (const duplicate of duplicates) await tx.deleteSpace(duplicate.space.id)
        if (duplicates.length) await touch(tx, keep.space)
        // Deleting the old canonical identity cascades its reference. Rebind it now.
        await tx.createSpace(keep.space)
        return result
      })
    },
    async deleteSpace(userId: string, spaceId: string) {
      const entries = await ports.metadata.transaction(async tx => {
        await requireSpace(tx, userId, spaceId, 'write', true)
        const entries = await tx.listEntries(spaceId)
        await tx.deleteSpace(spaceId)
        return entries
      })
      await cleanup(entries)
    },
    async listEntries(userId: string, spaceId: string, prefix?: string) {
      return ports.metadata.transaction(async tx => {
        const space = await requireSpace(tx, userId, spaceId, 'read')
        const normalized = normalizeStoragePrefix(prefix) ?? fail('invalid_path')
        return { space: await view(tx, userId, space),
          entries: (await tx.listEntries(spaceId)).filter(e => e.path.startsWith(normalized)).map(entryView).sort((a, b) => a.path.localeCompare(b.path)) }
      })
    },
    async readFile(userId: string, spaceId: string, input: string) {
      return ports.metadata.transaction(async tx => {
        await requireSpace(tx, userId, spaceId, 'read')
        const entry = await tx.getEntry(spaceId, path(input)) ?? fail('not_found')
        const bytes = await nodeCall(() => client(entry.nodeId).get(entry.blobId))
        return { entry: entryView(entry), bytes }
      })
    },
    async writeFile(userId: string, spaceId: string, input: string, bytes: Uint8Array, options: WriteStorageFileOptions = {}) {
      let uploaded: StoredEntry | undefined
      let previous: StoredEntry | null = null
      let result: StorageEntry
      try {
        result = await ports.metadata.transaction(async tx => {
          const prepared = await prepareWrite(tx, userId, spaceId, input, bytes.byteLength, options)
          const { space, entry } = prepared
          previous = prepared.previous
          // Do not destroy the old blob before both storage and metadata commit.
          await nodeCall(() => client(entry.nodeId).put(entry.blobId, bytes))
          uploaded = entry
          await tx.putEntry(entry)
          await touch(tx, space)
          return entryView(entry)
        })
      } catch (error) {
        if (uploaded) await cleanup([uploaded])
        throw error
      }
      if (previous) await cleanup([previous])
      return result
    },
    async deleteFile(userId: string, spaceId: string, input: string) {
      const entry = await ports.metadata.transaction(async tx => {
        const space = await requireSpace(tx, userId, spaceId, 'write')
        const entry = await tx.getEntry(spaceId, path(input)) ?? fail('not_found')
        await tx.deleteEntry(spaceId, entry.path)
        await touch(tx, space)
        return entry
      })
      await cleanup([entry])
    },
    async move(userId: string, spaceId: string, from: string, to: string) {
      return ports.metadata.transaction(async tx => {
        const space = await requireSpace(tx, userId, spaceId, 'write')
        const source = path(from), target = path(to)
        const entry = await tx.getEntry(spaceId, source) ?? fail('not_found')
        if (source === target) return entryView(entry)
        if (await tx.getEntry(spaceId, target)) fail('revision_conflict')
        const moved = { ...entry, path: target, updatedAt: ports.now(), updatedBy: userId }
        await tx.deleteEntry(spaceId, source)
        await tx.putEntry(moved)
        await touch(tx, space)
        return entryView(moved)
      })
    },
    async usage(userId: string): Promise<StorageUsage> {
      signedIn(userId)
      if (!storageAllows('owner', 'read')) fail('forbidden')
      return ports.metadata.transaction(async tx => ({ userId, ...await tx.ownerUsage(userId), quotaBytes: await ports.quota(userId) }))
    },
    async cluster(userId: string) {
      signedIn(userId)
      if (!storageAllows('read', 'read')) fail('forbidden')
      return summarizeStorageCluster(structuredClone(ports.nodeInfo()))
    },
    async listShares(userId: string, spaceId: string) {
      return ports.metadata.transaction(async tx => {
        await requireSpace(tx, userId, spaceId, 'read', true)
        return tx.listShares(spaceId)
      })
    },
    async createShare(userId: string, spaceId: string, request: CreateStorageShareRequest) {
      return ports.metadata.transaction(async tx => {
        await requireSpace(tx, userId, spaceId, 'write', true)
        if (!['read', 'write'].includes(request.permission) || (request.userId !== undefined && !request.userId.trim())) fail('forbidden')
        const share: StorageShare = { id: ports.newId(), spaceId, permission: request.permission,
          audience: request.userId === undefined ? { kind: 'link', token: ports.newId() } : { kind: 'user', userId: request.userId },
          createdAt: ports.now(), createdBy: userId }
        await tx.putShare(share)
        return share
      })
    },
    async revokeShare(userId: string, spaceId: string, shareId: string) {
      return ports.metadata.transaction(async tx => {
        await requireSpace(tx, userId, spaceId, 'write', true)
        if (!(await tx.listShares(spaceId)).some(s => s.id === shareId)) fail('not_found')
        await tx.deleteShare(shareId)
      })
    },
    async describeLink(userId: string, token: string): Promise<StorageLinkInfo> {
      return ports.metadata.transaction(async tx => {
        const { share, space } = await link(tx, userId, token)
        return { space: { id: space.id, kind: space.kind, title: space.title, ownerId: space.ownerId }, permission: share.permission }
      })
    },
    async acceptLink(userId: string, token: string) {
      return ports.metadata.transaction(async tx => {
        const { share, space } = await link(tx, userId, token)
        await tx.putAcceptance({ shareId: share.id, userId, acceptedAt: ports.now() })
        return view(tx, userId, space)
      })
    },
  }
}
export type FileStorageService = ReturnType<typeof createFileStorageService>

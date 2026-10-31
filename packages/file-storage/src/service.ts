import { createHash } from 'node:crypto'
import type { CreateStorageUploadRequest, StorageUploadSession, MergeStorageSpacesRequest, MergeStorageSpacesResult } from '@voicechat/shared/fileStorage'
import {
  MAX_STORAGE_BATCH_OPERATIONS, isStorageSmallText, type StorageBatchOperation, type ListStorageEntriesResponse,
  DEFAULT_STORAGE_PART_SIZE, MAX_STORAGE_UPLOAD_PARTS, STORAGE_UPLOAD_TTL_MS, MAX_STORAGE_FILE_BYTES, MAX_STORAGE_THUMBNAIL_INPUT_BYTES, STORAGE_THUMBNAIL_SIZES, fitsStorageQuota, normalizeStoragePath, normalizeStoragePrefix,
  pickStorageNode, storageAllows, strongestStorageAccess, summarizeStorageCluster,
  type CreateStorageSpaceRequest, type UpdateStorageSpaceRequest, type CreateStorageShareRequest, type StorageAccess,
  type StorageEntry, type StorageNodeInfo, type StoragePermission, type StorageShare,
  type StorageSpace, type StorageUsage, type StorageLinkInfo, type StorageThumbnailSize,
} from '@voicechat/shared/fileStorage'
import type { StorageNodeClient } from './client.js'
import type { StorageMetadataStore, StorageMetadataTransaction, StoredEntry, StoredSpace, StoredUpload } from './metadata.js'
import { StorageServiceError } from './errors.js'

export interface FileStoragePorts {
  partSize?: number
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
  thumbnail?(bytes: Uint8Array, size: StorageThumbnailSize): Promise<{ bytes: Uint8Array; mimeType: 'image/webp' | 'image/jpeg' }>
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
  const imageMime = (mime: string) => ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime.toLowerCase())
  const derivedId = (blobId: string, size: StorageThumbnailSize, format: 'webp' | 'jpeg') =>
    createHash('sha256').update(`thumbnail:${blobId}:${size}:${format}`).digest('base64url')
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
      try {
        const node = client(entry.nodeId)
        await nodeCall(() => node.delete(entry.blobId))
        for (const size of STORAGE_THUMBNAIL_SIZES) for (const format of ['webp', 'jpeg'] as const)
          await nodeCall(() => node.delete(derivedId(entry.blobId, size, format)))
      }
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
  const partSize = ports.partSize ?? DEFAULT_STORAGE_PART_SIZE
  if (!Number.isSafeInteger(partSize) || partSize < 1 || partSize > MAX_STORAGE_FILE_BYTES) throw new Error('Invalid storage part size')
  const uploadView = (u: StoredUpload): StorageUploadSession => ({uploadId: u.uploadId, partSize: u.partSize, expiresAt: u.expiresAt})
  function uploadNode(u: StoredUpload) {
    const n = client(u.nodeId)
    if (!n.createUpload || !n.putPart || !n.listParts || !n.completeUpload || !n.abortUpload) fail('node_unavailable')
    return n as Required<StorageNodeClient>
  }
  async function upload(tx: StorageMetadataTransaction, userId: string, spaceId: string, id: string) {
    await requireSpace(tx, userId, spaceId, 'write')
    const u = (await tx.listUploads()).find(u => u.uploadId === id && u.spaceId === spaceId && u.userId === userId)
    if (!u || u.expiresAt <= ports.now()) return fail('not_found')
    return u
  }
  async function reservations(tx: StorageMetadataTransaction, ownerId: string) {
    return (await tx.listUploads()).filter(u => u.ownerId === ownerId).reduce((n, u) => n + u.size, 0)
  }
  return {
    async createUpload(userId: string, spaceId: string, request: CreateStorageUploadRequest) {
      let allocated: StoredUpload | undefined
      try {
        return await ports.metadata.transaction(async tx => {
          const space = await requireSpace(tx, userId, spaceId, 'write')
          const normalized = path(request.path)
          if (!Number.isSafeInteger(request.size) || request.size < 0 ||
            Math.ceil(request.size / partSize) > MAX_STORAGE_UPLOAD_PARTS ||
            typeof request.mimeType !== 'string' || !request.mimeType.trim() || request.mimeType.length > 255 ||
            /[\r\n]/.test(request.mimeType) ||
            (request.createOnly !== undefined && typeof request.createOnly !== 'boolean') ||
            (request.ifMatch !== undefined && (!Number.isSafeInteger(request.ifMatch) || request.ifMatch < 1))) fail('invalid_path')
          const previous = await tx.getEntry(spaceId, normalized)
          if ((request.createOnly && previous) || (request.ifMatch !== undefined && request.ifMatch !== previous?.revision)) fail('revision_conflict')
          const usage = await tx.ownerUsage(space.ownerId)
          const quotaBytes = await ports.quota(space.ownerId)
          if (!Number.isFinite(quotaBytes) || quotaBytes < 0 || !fitsStorageQuota({...usage, usedBytes: usage.usedBytes + await reservations(tx, space.ownerId), quotaBytes}, request.size)) fail('quota_exceeded')
          const node = pickStorageNode(ports.nodeInfo(), request.size * 2) ?? fail('storage_full')
          const u: StoredUpload = { ...request, path: normalized, uploadId: ports.newId(), blobId: ports.newId(),
            partSize, expiresAt: ports.now() + STORAGE_UPLOAD_TTL_MS, userId, ownerId: space.ownerId, spaceId, nodeId: node.id }
          const n = uploadNode(u)
          allocated = u
          await nodeCall(() => n.createUpload(u.uploadId, u))
          await tx.putUpload(u)
          return uploadView(u)
        })
      } catch (error) {
        if (allocated) { try { await uploadNode(allocated).abortUpload(allocated.uploadId) } catch { /* Node expiry releases abandoned reservations. */ } }
        throw error
      }
    },
    async getUpload(userId: string, spaceId: string, id: string) {
      return ports.metadata.transaction(async tx => {
        const u = await upload(tx, userId, spaceId, id)
        return {...uploadView(u), receivedParts: await nodeCall(() => uploadNode(u).listParts(id))}
      })
    },
    async putUploadPart(userId: string, spaceId: string, id: string, n: number, bytes: Uint8Array) {
      const u = await ports.metadata.transaction(async tx => {
        const u = await upload(tx, userId, spaceId, id)
        if (!Number.isSafeInteger(n) || n < 0 || n >= Math.ceil(u.size / u.partSize) ||
          bytes.byteLength !== Math.min(u.partSize, u.size - n * u.partSize)) fail('invalid_path')
        return u
      })
      await nodeCall(() => uploadNode(u).putPart(id, n, bytes))
    },
    async completeUpload(userId: string, spaceId: string, id: string) {
      let previous: StoredEntry | null = null
      let completed: StoredUpload | undefined
      const result = await ports.metadata.transaction(async tx => {
        const u = await upload(tx, userId, spaceId, id)
        const space = await requireSpace(tx, userId, spaceId, 'write')
        previous = await tx.getEntry(spaceId, u.path)
        if ((u.createOnly && previous) || (u.ifMatch !== undefined && u.ifMatch !== previous?.revision)) fail('revision_conflict')
        const usage = await tx.ownerUsage(space.ownerId)
        const quotaBytes = await ports.quota(space.ownerId)
        if (!Number.isFinite(quotaBytes) || quotaBytes < 0 || !fitsStorageQuota({...usage, usedBytes: usage.usedBytes + await reservations(tx, space.ownerId) - u.size, quotaBytes}, u.size, previous?.size ?? 0)) fail('quota_exceeded')
        await nodeCall(() => uploadNode(u).completeUpload(id))
        const entry: StoredEntry = {spaceId, path: u.path, size: u.size, mimeType: u.mimeType,
          revision: (previous?.revision ?? 0) + 1, updatedAt: ports.now(), updatedBy: userId, nodeId: u.nodeId, blobId: u.blobId}
        await tx.putEntry(entry); await tx.deleteUpload(id); await touch(tx, space)
        completed = u
        return entryView(entry)
      })
      if (completed) { try { await uploadNode(completed).abortUpload(id) } catch { /* Node expiry cleans committed parts. */ } }
      if (previous) await cleanup([previous])
      return result
    },
    async abortUpload(userId: string, spaceId: string, id: string) {
      await ports.metadata.transaction(async tx => {
        const u = await upload(tx, userId, spaceId, id)
        await nodeCall(() => uploadNode(u).abortUpload(id))
        await nodeCall(() => client(u.nodeId).delete(u.blobId))
        await tx.deleteUpload(id)
      })
    },
    async expireUploads() {
      await ports.metadata.transaction(async tx => {
        for (const u of await tx.listUploads()) {
          if (u.expiresAt > ports.now() && await tx.getSpace(u.spaceId)) continue
          try {
            await nodeCall(() => uploadNode(u).abortUpload(u.uploadId))
            await nodeCall(() => client(u.nodeId).delete(u.blobId))
            await tx.deleteUpload(u.uploadId)
          } catch { /* Keep the reservation and retry when the node returns. */ }
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
    async listEntries(userId: string, spaceId: string, prefix?: string, withContent = false): Promise<ListStorageEntriesResponse> {
      return ports.metadata.transaction(async tx => {
        const space = await requireSpace(tx, userId, spaceId, 'read')
        const normalized = normalizeStoragePrefix(prefix) ?? fail('invalid_path')
        const entries: ListStorageEntriesResponse['entries'] = []
        for (const entry of (await tx.listEntries(spaceId)).filter(e => e.path.startsWith(normalized))) {
          const item: ListStorageEntriesResponse['entries'][number] = entryView(entry)
          if (withContent && isStorageSmallText(entry)) item.content = { encoding: 'base64',
            data: Buffer.from(await nodeCall(() => client(entry.nodeId).get(entry.blobId))).toString('base64') }
          entries.push(item)
        }
        return { space: await view(tx, userId, space), entries: entries.sort((a, b) => a.path.localeCompare(b.path)) }
      })
    },
    async prepareFileRead(userId: string, spaceId: string, input: string) {
      return ports.metadata.transaction(async tx => {
        await requireSpace(tx, userId, spaceId, 'read')
        const entry = await tx.getEntry(spaceId, path(input)) ?? fail('not_found')
        return {
          entry: entryView(entry),
          // Bind the bytes to the immutable blob selected with the authorized metadata.
          open: (range?: import('@voicechat/shared/fileStorage').StorageByteRange) => nodeCall(async () => {
            const node = client(entry.nodeId)
            if (node.getStream) return node.getStream(entry.blobId, range)
            const bytes = await node.get(entry.blobId)
            return Buffer.from(range ? bytes.subarray(range.start, range.end + 1) : bytes)
          }),
        }
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
    async readThumbnail(userId: string, spaceId: string, input: string, size: StorageThumbnailSize) {
      return ports.metadata.transaction(async tx => {
        await requireSpace(tx, userId, spaceId, 'read')
        if (!STORAGE_THUMBNAIL_SIZES.includes(size)) fail('invalid_path')
        const entry = await tx.getEntry(spaceId, path(input)) ?? fail('not_found')
        if (!imageMime(entry.mimeType) || entry.size > MAX_STORAGE_THUMBNAIL_INPUT_BYTES)
          fail('unsupported_media_type')
        const generate = ports.thumbnail ?? fail('unsupported_media_type')
        const node = client(entry.nodeId)
        for (const format of ['webp', 'jpeg'] as const) {
          try {
            const bytes = await nodeCall(() => node.get(derivedId(entry.blobId, size, format)))
            return { entry: entryView(entry), bytes, mimeType: `image/${format}` as 'image/webp' | 'image/jpeg' }
          } catch (error) {
            if (!(error instanceof StorageServiceError) || error.code !== 'not_found') throw error
          }
        }
        const generated = await generate(await nodeCall(() => node.get(entry.blobId)), size)
        const format = generated.mimeType === 'image/webp' ? 'webp' : 'jpeg'
        await nodeCall(() => node.put(derivedId(entry.blobId, size, format), generated.bytes))
        return { entry: entryView(entry), ...generated }
      })
    },
    async writeFile(userId: string, spaceId: string, input: string, bytes: Uint8Array, options: WriteStorageFileOptions = {}) {
      let uploaded: StoredEntry | undefined
      let previous: StoredEntry | null = null
      let result: StorageEntry
      try {
        result = await ports.metadata.transaction(async tx => {
          const space = await requireSpace(tx, userId, spaceId, 'write')
          const normalized = path(input)
          if (bytes.byteLength > MAX_STORAGE_FILE_BYTES) fail('file_too_large')
          previous = await tx.getEntry(spaceId, normalized)
          if ((options.createOnly && previous) || (options.ifMatch !== undefined && previous?.revision !== options.ifMatch))
            fail('revision_conflict')
          const usage = await tx.ownerUsage(space.ownerId)
          const quotaBytes = await ports.quota(space.ownerId)
          if (!Number.isFinite(quotaBytes) || quotaBytes < 0 ||
            !fitsStorageQuota({ ...usage, usedBytes: usage.usedBytes + await reservations(tx, space.ownerId), quotaBytes }, bytes.byteLength, previous?.size ?? 0)) fail('quota_exceeded')
          const nodes = ports.nodeInfo()
          if (!ports.nodes().length) fail('storage_disabled')
          if (!nodes.some(n => n.online)) fail('node_unavailable')
          const node = pickStorageNode(nodes, bytes.byteLength) ?? fail('storage_full')
          const entry: StoredEntry = { spaceId, path: normalized, size: bytes.byteLength,
            mimeType: options.mimeType ?? 'application/octet-stream', revision: (previous?.revision ?? 0) + 1,
            updatedAt: ports.now(), updatedBy: userId, blobId: ports.newId(), nodeId: node.id }
          // Do not destroy the old blob before both storage and metadata commit.
          await nodeCall(() => client(node.id).put(entry.blobId, bytes))
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
    /** Conservative preflight: do not credit deletes or replacements that may fail. */
    async checkBatch(userId: string, spaceId: string, operations: StorageBatchOperation[], payloads: Map<string, { bytes: Uint8Array }>) {
      if (!Array.isArray(operations) || operations.length < 1 || operations.length > MAX_STORAGE_BATCH_OPERATIONS) fail('invalid_path')
      await ports.metadata.transaction(async tx => {
        const space = await requireSpace(tx, userId, spaceId, 'read')
        const sizes = new Map((await tx.listEntries(spaceId)).map(e => [e.path, e.size]))
        let growth = 0
        for (const op of operations) {
          if (!op || !['read', 'write', 'delete', 'move', 'copy'].includes(op.op)) continue
          const source = normalizeStoragePath(op.path)
          if (!source) continue
          if (op.op === 'write') {
            const size = payloads.get(op.bodyRef ?? '')?.bytes.byteLength
            if (size !== undefined) { growth += size; sizes.set(source, Math.max(sizes.get(source) ?? 0, size)) }
          } else if ((op.op === 'copy' || op.op === 'move') && op.to) {
            const target = normalizeStoragePath(op.to)
            if (target) {
              const size = sizes.get(source) ?? 0
              if (op.op === 'copy') growth += size
              sizes.set(target, Math.max(sizes.get(target) ?? 0, size))
            }
          }
        }
        const usage = await tx.ownerUsage(space.ownerId), quotaBytes = await ports.quota(space.ownerId)
        if (growth && (!Number.isFinite(quotaBytes) || quotaBytes < 0 ||
          !fitsStorageQuota({ ...usage, usedBytes: usage.usedBytes + await reservations(tx, space.ownerId), quotaBytes }, growth))) fail('quota_exceeded')
      })
    },
    async copy(userId: string, spaceId: string, from: string, to: string, options: WriteStorageFileOptions = {}) {
      let created: StoredEntry | undefined, previous: StoredEntry | null = null
      try {
        const result = await ports.metadata.transaction(async tx => {
          const space = await requireSpace(tx, userId, spaceId, 'write')
          const source = await tx.getEntry(spaceId, path(from)) ?? fail('not_found')
          const target = path(to)
          previous = await tx.getEntry(spaceId, target)
          if ((options.createOnly && previous) || (options.ifMatch !== undefined && options.ifMatch !== previous?.revision)) fail('revision_conflict')
          const usage = await tx.ownerUsage(space.ownerId), quotaBytes = await ports.quota(space.ownerId)
          if (!Number.isFinite(quotaBytes) || quotaBytes < 0 ||
            !fitsStorageQuota({ ...usage, usedBytes: usage.usedBytes + await reservations(tx, space.ownerId), quotaBytes }, source.size, previous?.size ?? 0)) fail('quota_exceeded')
          const node = client(source.nodeId)
          if (!node.copy) fail('node_unavailable')
          const entry = { ...source, path: target, blobId: ports.newId(), revision: (previous?.revision ?? 0) + 1,
            updatedBy: userId, updatedAt: ports.now() }
          await nodeCall(() => node.copy!(source.blobId, entry.blobId))
          created = entry
          await tx.putEntry(entry)
          await touch(tx, space)
          return entryView(entry)
        })
        if (previous) await cleanup([previous])
        return result
      } catch (error) {
        if (created) await cleanup([created])
        throw error
      }
    },
    async deleteFile(userId: string, spaceId: string, input: string, options: WriteStorageFileOptions = {}) {
      const entry = await ports.metadata.transaction(async tx => {
        const space = await requireSpace(tx, userId, spaceId, 'write')
        const entry = await tx.getEntry(spaceId, path(input)) ?? fail('not_found')
        if (options.ifMatch !== undefined && options.ifMatch !== entry.revision) fail('revision_conflict')
        await tx.deleteEntry(spaceId, entry.path)
        await touch(tx, space)
        return entry
      })
      await cleanup([entry])
    },
    async move(userId: string, spaceId: string, from: string, to: string, options: WriteStorageFileOptions = {}) {
      return ports.metadata.transaction(async tx => {
        const space = await requireSpace(tx, userId, spaceId, 'write')
        const source = path(from), target = path(to)
        const entry = await tx.getEntry(spaceId, source) ?? fail('not_found')
        if (options.ifMatch !== undefined && options.ifMatch !== entry.revision) fail('revision_conflict')
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

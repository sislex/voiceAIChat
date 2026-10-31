import { FILE_STORAGE_NODE_PATHS, STORAGE_ERROR_STATUS, isStorageBlobId,
  type StorageErrorCode, type StorageNodeHealth } from '@voicechat/shared/fileStorage'
import { StorageServiceError } from './errors.js'
import { Readable } from 'node:stream'

export interface StorageNodeRead {
  stream: Readable
  contentLength: number
  contentRange?: string
}

export interface StorageNodeClient {
  copy?(sourceId: string, targetId: string): Promise<void>
  readonly id: string
  createUpload?(id: string, options: { size: number; partSize: number; expiresAt: number; blobId: string }): Promise<void>
  putPart?(id: string, n: number, bytes: Uint8Array): Promise<void>
  listParts?(id: string): Promise<number[]>
  completeUpload?(id: string): Promise<void>
  abortUpload?(id: string): Promise<void>
  health(): Promise<StorageNodeHealth>
  put(blobId: string, bytes: Uint8Array): Promise<void>
  get(blobId: string): Promise<Uint8Array>
  open?(blobId: string, range?: string): Promise<StorageNodeRead>
  delete(blobId: string): Promise<void>
}
export function createStorageNodeClient(options: {
  id: string; url: string; token: string; fetchImpl?: typeof fetch
}): StorageNodeClient {
  const base = new URL(options.url)
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
    throw new Error('Invalid storage node URL')
  const transport = options.fetchImpl ?? fetch
  async function request(path: string, method = 'GET', bytes?: Uint8Array, headers?: Record<string, string>) {
    try {
      const response = await transport(new URL(path, base), {
        method, headers: { authorization: `Bearer ${options.token}`, 'content-type': 'application/octet-stream', ...headers },
        ...(bytes === undefined ? {} : { body: Buffer.from(bytes) }),
        redirect: 'error', signal: AbortSignal.timeout(60_000),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null
        const code = body?.error
        const mapped: StorageErrorCode = code && Object.hasOwn(STORAGE_ERROR_STATUS, code)
          ? code as StorageErrorCode
          : response.status === 401 || response.status === 403 ? 'forbidden'
          : response.status === 404 ? 'not_found'
          : response.status === 416 ? 'range_not_satisfiable'
          : response.status === 507 ? 'storage_full'
          : response.status === 413 ? 'file_too_large' : 'node_unavailable'
        throw new StorageServiceError(mapped)
      }
      return response
    } catch (error) {
      if (error instanceof StorageServiceError) throw error
      throw new StorageServiceError('node_unavailable')
    }
  }
  function blobPath(id: string) {
    if (!isStorageBlobId(id)) throw new StorageServiceError('invalid_path')
    return FILE_STORAGE_NODE_PATHS.blob(id)
  }
  return {
    id: options.id,
    async createUpload(id, options) { await request(`/v1/uploads/${encodeURIComponent(id)}`, 'POST', Buffer.from(JSON.stringify(options))) },
    async putPart(id, n, bytes) { await request(`/v1/uploads/${encodeURIComponent(id)}/parts/${n}`, 'PUT', bytes) },
    async listParts(id) { return await (await request(`/v1/uploads/${encodeURIComponent(id)}`)).json() as number[] },
    async completeUpload(id) { await request(`/v1/uploads/${encodeURIComponent(id)}/complete`, 'POST') },
    async abortUpload(id) { await request(`/v1/uploads/${encodeURIComponent(id)}`, 'DELETE') },
    async health() {
      try {
        const value = await (await request(FILE_STORAGE_NODE_PATHS.health)).json() as StorageNodeHealth
        if (value.nodeId !== options.id || ![value.capacityBytes, value.usedBytes, value.freeBytes]
          .every(n => Number.isSafeInteger(n) && n >= 0) ||
          value.freeBytes !== Math.max(0, value.capacityBytes - value.usedBytes))
          throw new StorageServiceError('node_unavailable')
        return value
      } catch (error) {
        if (error instanceof StorageServiceError) throw error
        throw new StorageServiceError('node_unavailable')
      }
    },
    async copy(sourceId, targetId) {
      blobPath(sourceId); blobPath(targetId)
      await request(FILE_STORAGE_NODE_PATHS.copy(sourceId), 'POST', Buffer.from(JSON.stringify({ targetId })))
    },
    async put(id, bytes) { await request(blobPath(id), 'PUT', bytes) },
    async get(id) {
      const response = await request(blobPath(id))
      try { return new Uint8Array(await response.arrayBuffer()) }
      catch { throw new StorageServiceError('node_unavailable') }
    },
    async open(id, range) {
      const response = await request(blobPath(id), 'GET', undefined, range ? { range } : undefined)
      if (!response.body) throw new StorageServiceError('node_unavailable')
      const contentLength = Number(response.headers.get('content-length'))
      if (!Number.isSafeInteger(contentLength) || contentLength < 0) throw new StorageServiceError('node_unavailable')
      return { stream: Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), contentLength,
        ...(response.headers.get('content-range') ? { contentRange: response.headers.get('content-range')! } : {}) }
    },
    async delete(id) { await request(blobPath(id), 'DELETE') },
  }
}

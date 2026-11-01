import { Agent, fetch as pooledFetch } from 'undici'
const dispatcher = new Agent({ keepAliveTimeout: 30_000, keepAliveMaxTimeout: 60_000, allowH2: true })
export type StorageBody = Uint8Array | Readable
export async function storageBytes(body: StorageBody): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body
  const chunks: Buffer[] = []
  for await (const chunk of body) chunks.push(Buffer.from(chunk))
  const bytes = Buffer.concat(chunks)
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

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
  put(blobId: string, bytes: StorageBody, size?: number): Promise<void>
  putStream?(blobId: string, bytes: AsyncIterable<Uint8Array>, size?: number): Promise<void>
  get(blobId: string): Promise<StorageBody>
  open?(blobId: string, range?: string): Promise<StorageNodeRead>
  delete(blobId: string): Promise<void>
}
export function createStorageNodeClient(options: {
  id: string; url: string; token: string; fetchImpl?: typeof fetch
}): StorageNodeClient {
  const base = new URL(options.url)
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
    throw new Error('Invalid storage node URL')
  const transport = (options.fetchImpl ?? pooledFetch) as typeof pooledFetch
  async function request(path: string, method = 'GET', bytes?: StorageBody, size?: number, headers?: Record<string, string>) {
    try {
      const response = await transport(new URL(path, base), {
        method, headers: { authorization: `Bearer ${options.token}`, 'content-type': 'application/octet-stream', ...headers,
          ...(size === undefined ? {} : { 'content-length': String(size) }) },
        ...(bytes === undefined ? {} : { body: bytes, duplex: 'half' }),
        ...{ dispatcher },
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
    async putStream(id, bytes, size) { await (await request(blobPath(id), 'PUT', Readable.from(bytes), size)).body?.cancel() },
    async put(id, bytes, size) {
      const response = await request(blobPath(id), 'PUT', bytes, size ?? (bytes instanceof Uint8Array ? bytes.byteLength : undefined))
      await response.body?.cancel()
    },
    async get(id) {
      const response = await request(blobPath(id))
      const source = response.body ? Readable.fromWeb(response.body as import('node:stream/web').ReadableStream) : Readable.from([])
      // Attach immediately, including when a conditional GET discards the unread body.
      source.on('error', () => {})
      const stream = Readable.from((async function* () {
        try { yield* source }
        catch { throw new StorageServiceError('node_unavailable') }
        finally { source.destroy() }
      })())
      stream.once('close', () => source.destroy())
      return stream
    },
    async open(id, range) {
      const response = await request(blobPath(id), 'GET', undefined, undefined, range ? { range } : undefined)
      if (!response.body) throw new StorageServiceError('node_unavailable')
      const contentLength = Number(response.headers.get('content-length'))
      if (!response.headers.has('content-length') || !Number.isSafeInteger(contentLength) || contentLength < 0) {
        await response.body.cancel()
        throw new StorageServiceError('node_unavailable')
      }
      return { stream: Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), contentLength,
        ...(response.headers.get('content-range') ? { contentRange: response.headers.get('content-range')! } : {}) }
    },
    async delete(id) { await (await request(blobPath(id), 'DELETE')).body?.cancel() },
  }
}

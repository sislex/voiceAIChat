import { Readable } from 'node:stream'
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

export interface StorageNodeClient {
  readonly id: string
  health(): Promise<StorageNodeHealth>
  put(blobId: string, bytes: StorageBody, size?: number): Promise<void>
  /** Byte results remain supported for injected legacy clients. HTTP clients stream. */
  get(blobId: string): Promise<StorageBody>
  delete(blobId: string): Promise<void>
}
export function createStorageNodeClient(options: {
  id: string; url: string; token: string; fetchImpl?: typeof fetch
}): StorageNodeClient {
  const base = new URL(options.url)
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
    throw new Error('Invalid storage node URL')
  const transport = (options.fetchImpl ?? pooledFetch) as typeof pooledFetch
  async function request(path: string, method = 'GET', bytes?: StorageBody, size?: number) {
    try {
      const response = await transport(new URL(path, base), {
        method, headers: { authorization: `Bearer ${options.token}`, 'content-type': 'application/octet-stream',
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
    async delete(id) { await (await request(blobPath(id), 'DELETE')).body?.cancel() },
  }
}

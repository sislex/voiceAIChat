import { FILE_STORAGE_NODE_PATHS, STORAGE_ERROR_STATUS, isStorageBlobId,
  type StorageErrorCode, type StorageNodeHealth } from '@voicechat/shared/fileStorage'
import { StorageServiceError } from './errors.js'

export interface StorageNodeClient {
  readonly id: string
  health(): Promise<StorageNodeHealth>
  put(blobId: string, bytes: Uint8Array): Promise<void>
  /** Optional streaming extension; existing byte-array clients remain compatible. */
  putStream?(blobId: string, bytes: AsyncIterable<Uint8Array>): Promise<void>
  get(blobId: string): Promise<Uint8Array>
  delete(blobId: string): Promise<void>
}
export function createStorageNodeClient(options: {
  id: string; url: string; token: string; fetchImpl?: typeof fetch
}): StorageNodeClient {
  const base = new URL(options.url)
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
    throw new Error('Invalid storage node URL')
  const transport = options.fetchImpl ?? fetch
  async function request(path: string, method = 'GET', bytes?: Uint8Array | AsyncIterable<Uint8Array>) {
    try {
      const response = await transport(new URL(path, base), {
        method, headers: { authorization: `Bearer ${options.token}`, 'content-type': 'application/octet-stream' },
        ...(bytes === undefined ? {} : bytes instanceof Uint8Array ? { body: Buffer.from(bytes) }
          : { body: bytes as unknown as NonNullable<Parameters<typeof fetch>[1]>['body'], duplex: 'half' }),
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
    async put(id, bytes) { await request(blobPath(id), 'PUT', bytes) },
    async putStream(id, bytes) { await request(blobPath(id), 'PUT', bytes) },
    async get(id) {
      const response = await request(blobPath(id))
      try { return new Uint8Array(await response.arrayBuffer()) }
      catch { throw new StorageServiceError('node_unavailable') }
    },
    async delete(id) { await request(blobPath(id), 'DELETE') },
  }
}

import { createHmac, timingSafeEqual } from 'node:crypto'
import { FILE_STORAGE_NODE_PATHS, STORAGE_DIRECT_TTL_MS, MAX_STORAGE_FILE_BYTES, STORAGE_ERROR_STATUS, isStorageBlobId,
  type StorageErrorCode, type StorageNodeHealth } from '@voicechat/shared/fileStorage'
import { StorageServiceError } from './errors.js'

export interface DirectClaims {
  blobId: string
  method: 'GET' | 'PUT'
  size: number
  mimeType: string
  expiresAt: number
}
export function signDirectUrl(publicUrl: string, secret: string, claims: DirectClaims): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const sig = createHmac('sha256', secret).update(payload).digest('base64url')
  const url = new URL(FILE_STORAGE_NODE_PATHS.direct(claims.blobId), publicUrl)
  url.searchParams.set('sig', payload + '.' + sig)
  return url.toString()
}
export function verifyDirectUrl(token: string, secret: string, blobId: string, method: string, now = Date.now()): DirectClaims {
  const fail = (): never => { throw new StorageServiceError('forbidden') }
  if (!secret || typeof token !== 'string' || token.length > 4096) return fail()
  const parts = token.split('.')
  if (parts.length !== 2) return fail()
  const [payload, signature] = parts
  if (!payload || !signature) return fail()
  const expected = createHmac('sha256', secret).update(payload).digest('base64url')
  const actual = Buffer.from(signature)
  if (actual.length !== expected.length || !timingSafeEqual(actual, Buffer.from(expected))) return fail()
  let c: DirectClaims
  try { c = JSON.parse(Buffer.from(payload, 'base64url').toString()) } catch { return fail() }
  if (!c || c.blobId !== blobId || !isStorageBlobId(c.blobId) || c.method !== method ||
      !['GET', 'PUT'].includes(c.method) || !Number.isSafeInteger(c.size) || c.size < 0 || c.size > MAX_STORAGE_FILE_BYTES ||
      typeof c.mimeType !== 'string' || !c.mimeType || /[\r\n]/.test(c.mimeType) ||
      !Number.isSafeInteger(c.expiresAt) || c.expiresAt <= now || c.expiresAt > now + STORAGE_DIRECT_TTL_MS) return fail()
  return c
}

export interface StorageNodeClient {
  /** Optional for older injected clients; required to enable direct writes. */
  stat?(blobId: string): Promise<{ size: number }>

  readonly id: string
  health(): Promise<StorageNodeHealth>
  put(blobId: string, bytes: Uint8Array): Promise<void>
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
  async function request(path: string, method = 'GET', bytes?: Uint8Array) {
    try {
      const response = await transport(new URL(path, base), {
        method, headers: { authorization: `Bearer ${options.token}`, 'content-type': 'application/octet-stream' },
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
    async stat(id) {
      const response = await request(blobPath(id), 'HEAD')
      const length = response.headers.get('content-length')
      if (length === null || !/^\d+$/.test(length)) throw new StorageServiceError('node_unavailable')
      const size = Number(length)
      if (!Number.isSafeInteger(size) || size < 0) throw new StorageServiceError('node_unavailable')
      return { size }
    },
    async put(id, bytes) { await request(blobPath(id), 'PUT', bytes) },
    async get(id) {
      const response = await request(blobPath(id))
      try { return new Uint8Array(await response.arrayBuffer()) }
      catch { throw new StorageServiceError('node_unavailable') }
    },
    async delete(id) { await request(blobPath(id), 'DELETE') },
  }
}

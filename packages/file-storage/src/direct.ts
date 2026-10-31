import { createHmac, timingSafeEqual } from 'node:crypto'
import { isStorageBlobId, STORAGE_DIRECT_TTL_MS, MAX_STORAGE_FILE_BYTES } from '@voicechat/shared/fileStorage'
import { StorageServiceError } from './errors.js'

export interface DirectClaims {
  blobId: string
  method: 'GET' | 'PUT'
  size: number
  mimeType: string
  expiresAt: number
  uploadId?: string
}
export interface DirectNodeConfig { publicUrl: string; secret: string }
export function signDirect(claims: DirectClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return payload + '.' + createHmac('sha256', secret).update(payload).digest('base64url')
}
export function verifyDirect(token: string, secret: string, now = Date.now()): DirectClaims {
  const fail = (): never => { throw new StorageServiceError('forbidden') }
  if (!secret || token.length > 4096) return fail()
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra !== undefined) return fail()
  const expected = createHmac('sha256', secret).update(payload).digest()
  const actual = Buffer.from(signature, 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return fail()
  let c: DirectClaims
  try { c = JSON.parse(Buffer.from(payload, 'base64url').toString()) } catch { return fail() }
  if (!c || !isStorageBlobId(c.blobId) || !['GET', 'PUT'].includes(c.method) ||
    !Number.isSafeInteger(c.size) || c.size < 0 || (c.method === 'PUT' && c.size > MAX_STORAGE_FILE_BYTES) ||
    typeof c.mimeType !== 'string' || !c.mimeType || /[\r\n]/.test(c.mimeType) ||
    !Number.isSafeInteger(c.expiresAt) || c.expiresAt <= now || c.expiresAt > now + STORAGE_DIRECT_TTL_MS ||
    (c.method === 'PUT' && (typeof c.uploadId !== 'string' || !isStorageBlobId(c.uploadId)))) return fail()
  return c
}
export function directUrl(config: DirectNodeConfig, claims: DirectClaims): string {
  const url = new URL('/v1/direct/' + claims.blobId, config.publicUrl)
  url.searchParams.set('sig', signDirect(claims, config.secret))
  return url.href
}

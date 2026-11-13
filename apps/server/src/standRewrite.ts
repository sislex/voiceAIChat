import type { IncomingHttpHeaders } from 'node:http'
import { promisify } from 'node:util'
import { brotliDecompress, gunzip, inflate } from 'node:zlib'

/** Textual bodies above this size (encoded or decoded) are passed through untouched. */
export const REWRITE_MAX_BYTES = 10 * 1024 * 1024

const decoders: Record<string, (body: Buffer, options: { maxOutputLength: number }) => Promise<Buffer>> = {
  gzip: promisify(gunzip), 'x-gzip': promisify(gunzip), deflate: promisify(inflate), br: promisify(brotliDecompress)
}

/**
 * Accept-Encoding forwarded to an external upstream: only codings the proxy can decode before
 * rewriting, so a response never arrives in an encoding (zstd, compress) the rewrite cannot read.
 */
export function rewritableAcceptEncoding(value: string | undefined): string | undefined {
  const kept = (value ?? '').split(',').map(token => token.trim()).filter(token => {
    const name = token.split(';')[0]!.trim().toLowerCase()
    return name === 'identity' || name in decoders
  })
  return kept.length ? kept.join(', ') : undefined
}

/** HTML, JSON (`application/json`, `*\/*+json`), JavaScript, CSS and any `text/*` in an ASCII-compatible charset. */
export function isRewritableType(contentType: string | undefined): boolean {
  if (!contentType) return false
  const [mime = '', ...params] = contentType.toLowerCase().split(';').map(part => part.trim())
  const charset = params.find(part => part.startsWith('charset='))?.slice(8).replace(/["']/g, '')
  if (charset && /^utf-?(16|32)/.test(charset)) return false
  return mime.startsWith('text/') || mime === 'application/json' || /^[a-z0-9.+-]+\/[a-z0-9.+-]+\+json$/.test(mime)
    || /^application\/(x-)?(javascript|ecmascript)$/.test(mime) || mime === 'application/xhtml+xml'
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

/**
 * Replaces the upstream origin with the lease origin in absolute (`https://host`), protocol-relative
 * (`//host`), JSON-escaped (`https:\/\/host`) and WebSocket (`wss://host`) forms. Another port on
 * the same host and longer hostnames (`host.evil`) are left alone.
 */
export function rewriteOriginText(text: string, upstream: string, origin: string): string {
  const up = new URL(upstream), lease = new URL(origin)
  const defaultPort = up.protocol === 'https:' ? '443' : '80'
  const host = escapeRegExp(up.host)
  // A default-port upstream also matches its explicit `:443`/`:80` spelling.
  const hostPattern = up.port ? host : host + '(?::' + defaultPort + ')?'
  const pattern = new RegExp('(?:\\b(https?|wss?):)?(\\/\\/|\\\\\\/\\\\\\/)' + hostPattern + '(?![A-Za-z0-9_.-]|:\\d)', 'gi')
  const secure = lease.protocol === 'https:'
  return text.replace(pattern, (_match, scheme: string | undefined, slashes: string) => {
    const name = scheme === undefined ? '' : (/^ws/i.test(scheme) ? (secure ? 'wss' : 'ws') : lease.protocol.slice(0, -1)) + ':'
    return name + slashes + lease.host
  })
}

/** Rewrites `Access-Control-Allow-Origin` and CSP sources that name the upstream origin. */
export function rewriteOriginHeaders(headers: IncomingHttpHeaders, upstream: string, origin: string): IncomingHttpHeaders {
  const result = { ...headers }
  if (typeof result['access-control-allow-origin'] === 'string' && result['access-control-allow-origin'].trim().toLowerCase() === upstream.toLowerCase())
    result['access-control-allow-origin'] = origin
  const csp = result['content-security-policy']
  if (Array.isArray(csp)) result['content-security-policy'] = csp.map(value => rewriteOriginText(value, upstream, origin))
  else if (typeof csp === 'string') result['content-security-policy'] = rewriteOriginText(csp, upstream, origin)
  return result
}

/** True when the response body should be buffered and passed to {@link rewriteOriginBody}. */
export function canRewriteOrigin(headers: IncomingHttpHeaders): boolean {
  const encoding = headers['content-encoding']?.trim().toLowerCase()
  const length = Number(headers['content-length'] ?? 0)
  return isRewritableType(headers['content-type']) && !headers['content-range']
    && (!encoding || encoding === 'identity' || encoding in decoders) && !(length > REWRITE_MAX_BYTES)
}

/**
 * Decodes the body, swaps the upstream origin for the lease origin and returns identity bytes, or
 * undefined when nothing changed or the body cannot be rewritten (the caller then sends the original).
 * Works on latin1 code units, so any ASCII-compatible charset (incl. UTF-8) round-trips byte for byte.
 */
export async function rewriteOriginBody(body: Buffer, headers: IncomingHttpHeaders, upstream: string, origin: string): Promise<Buffer | undefined> {
  if (!canRewriteOrigin(headers) || body.length > REWRITE_MAX_BYTES) return undefined
  try {
    const encoding = headers['content-encoding']?.trim().toLowerCase()
    const decoded = encoding && encoding !== 'identity' ? await decoders[encoding]!(body, { maxOutputLength: REWRITE_MAX_BYTES }) : body
    const text = decoded.toString('latin1')
    const rewritten = rewriteOriginText(text, upstream, origin)
    if (rewritten === text) return encoding && encoding !== 'identity' ? decoded : undefined
    return Buffer.from(rewritten, 'latin1')
  } catch { return undefined }
}

/** Headers for a body replaced by {@link rewriteOriginBody}: identity coding, exact length, weak validator. */
export function rewrittenBodyHeaders(headers: IncomingHttpHeaders, length: number): void {
  headers['content-length'] = String(length)
  delete headers['transfer-encoding']
  delete headers['content-encoding']
  delete headers['content-md5']
  delete headers.digest
  // The rewrite is deterministic for a lease origin, so a weak validator still revalidates correctly.
  if (typeof headers.etag === 'string' && !headers.etag.startsWith('W/')) headers.etag = 'W/' + headers.etag
}

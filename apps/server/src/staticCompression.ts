import type { FastifyInstance } from 'fastify'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'
import { brotliCompress, gzip, constants } from 'node:zlib'

type Encoding = 'br' | 'gzip'
const br = promisify(brotliCompress)
const gz = promisify(gzip)
export const compressStatic = (body: Buffer, encoding: Encoding): Promise<Buffer> =>
  encoding === 'br' ? br(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }) : gz(body)
const MAX_FILE_BYTES = 32 * 1024 * 1024

function negotiate(header: string): Encoding | undefined {
  const weights = new Map(header.toLowerCase().split(',').map(part => {
    const [name, ...params] = part.trim().split(';')
    const q = params.find(p => p.trim().startsWith('q='))
    const weight = q ? Number(q.trim().slice(2)) : 1
    return [name.trim(), Number.isFinite(weight) && weight >= 0 && weight <= 1 ? weight : 0]
  }))
  const quality = (name: string) => weights.get(name) ?? weights.get('*') ?? 0
  const selected = quality('br') >= quality('gzip') ? 'br' : 'gzip'
  return quality(selected) > 0 && quality(selected) >= (weights.get('identity') ?? 0) ? selected : undefined
}

/** Content-addressed LRU: replacing a local or remote frontend cannot reuse stale bytes. */
export function registerStaticCompression(app: FastifyInstance, options: {
  maxBytes?: number
  compress?: typeof compressStatic
} = {}): void {
  const cache = new Map<string, Buffer>()
  const pending = new Map<string, Promise<Buffer>>()
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024
  let bytes = 0
  app.addHook('onSend', async (request, reply, payload) => {
    const path = request.url.split('?', 1)[0]
    if (!/^\/(?:assets\/|applications\/[^/]+\/|ui\/releases\/)/.test(path) ||
        !/\.(?:js|css|html|json|svg|map)$/i.test(path) ||
        !['GET', 'HEAD'].includes(request.method) || reply.statusCode !== 200 ||
        /^text\/event-stream(?:;|$)/i.test(String(reply.getHeader('content-type') ?? '')) ||
        request.headers.range || request.headers.upgrade ||
        reply.hasHeader('content-range') || reply.hasHeader('content-encoding')) return payload
    const vary = String(reply.getHeader('vary') ?? '')
    if (!vary.split(',').some(v => ['*', 'accept-encoding'].includes(v.trim().toLowerCase())))
      reply.header('vary', vary ? vary + ', Accept-Encoding' : 'Accept-Encoding')
    const encoding = negotiate(request.headers['accept-encoding'] ?? '')
    if (!encoding || request.method === 'HEAD') return payload
    const length = Number(reply.getHeader('content-length'))
    const buffered = typeof payload === 'string' || Buffer.isBuffer(payload)
    if ((!buffered && (!(payload instanceof Readable) || !Number.isFinite(length) || length > MAX_FILE_BYTES)) ||
        (buffered && Buffer.byteLength(payload) > MAX_FILE_BYTES) || pending.size >= 4) return payload
    // API streams never enter this static-only hook.
    const body = buffered ? Buffer.from(payload) : await (payload as Readable).toArray().then(chunks => Buffer.concat(chunks))
    const key = encoding + ':' + createHash('sha256').update(body).digest('hex')
    let compressed = cache.get(key)
    if (compressed) { cache.delete(key); cache.set(key, compressed) }
    else {
      let work = pending.get(key)
      if (!work) {
        work = (options.compress ?? compressStatic)(body, encoding)
        pending.set(key, work)
      }
      try {
        compressed = await work
        if (!cache.has(key) && compressed.length <= maxBytes) {
          while (bytes + compressed.length > maxBytes && cache.size) {
            const oldest = cache.keys().next().value!
            bytes -= cache.get(oldest)!.length
            cache.delete(oldest)
          }
          cache.set(key, compressed)
          bytes += compressed.length
        }
      } finally { pending.delete(key) }
    }
    const etag = reply.getHeader('etag')
    if (typeof etag === 'string' && !etag.startsWith('W/')) reply.header('etag', 'W/' + etag)
    reply.header('content-encoding', encoding).header('content-length', compressed.length)
    reply.removeHeader('accept-ranges')
    return compressed
  })
}

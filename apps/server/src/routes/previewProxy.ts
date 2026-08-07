import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { IncomingMessage } from 'node:http'
import type { FastifyInstance } from 'fastify'

const MAX_REDIRECTS = 5
const MAX_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 10_000

export class PreviewProxyError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export function isPublicAddress(address: string): boolean {
  const v = address.toLowerCase().replace(/^::ffff:/, '')
  if (isIP(v) === 4) {
    const [a, b] = v.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a >= 224)
  }
  if (isIP(v) === 6) return !(v === '::1' || v === '::' || v.startsWith('fe80:') || /^(fc|fd)[0-9a-f]{2}:/.test(v))
  return false
}

async function assertPublicHost(hostname: string): Promise<void> {
  const literal = hostname.replace(/^\[|\]$/g, '')
  if (isIP(literal)) {
    if (!isPublicAddress(literal)) throw new PreviewProxyError(403, 'Адрес сайта недоступен для превью')
    return
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new PreviewProxyError(403, 'Адрес сайта недоступен для превью')
}

function proxyUrl(value: string, base: URL): string {
  try {
    const target = new URL(value, base)
    return target.protocol === 'http:' || target.protocol === 'https:' ? '/api/preview?url=' + encodeURIComponent(target.toString()) : value
  } catch { return value }
}

export function rewritePreviewBody(body: Buffer, type: string, base: URL): Buffer {
  let text = body.toString('utf8')
  if (/text\/html|application\/xhtml\+xml/i.test(type)) {
    text = text.replace(/<meta\b[^>]*http-equiv\s*=\s*(['"]?)content-security-policy\1[^>]*>/gi, '')
      .replace(/\b(href|src|action|poster)\s*=\s*(["'])(.*?)\2/gi, (_m, name, quote, value) => name + '=' + quote + proxyUrl(value, base) + quote)
      .replace(/\bsrcset\s*=\s*(["'])(.*?)\1/gi, (_m, quote, value) => 'srcset=' + quote + value.split(',').map((part: string) => {
        const [url, ...descriptor] = part.trim().split(/\s+/)
        return proxyUrl(url, base) + (descriptor.length ? ' ' + descriptor.join(' ') : '')
      }).join(', ') + quote)
  }
  if (/text\/css/i.test(type)) text = text.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_m, quote, value) => 'url(' + quote + proxyUrl(value, base) + quote + ')')
  return Buffer.from(text)
}

async function get(url: URL): Promise<{ response: IncomingMessage; finalUrl: URL }> {
  await assertPublicHost(url.hostname)
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest
    const request = transport(url, {
      headers: { 'user-agent': 'voiceAIChat-preview/1.0', accept: '*/*' },
      timeout: TIMEOUT_MS,
      lookup(hostname, _opts, callback) {
        void lookup(hostname, { all: true, verbatim: true }).then((addresses) => {
          const address = addresses.find((candidate) => isPublicAddress(candidate.address))
          if (!address || addresses.some((candidate) => !isPublicAddress(candidate.address))) return callback(new Error('blocked address'), '', 4)
          callback(null, address.address, address.family)
        }, (err) => callback(err, '', 4))
      }
    }, (response) => resolve({ response, finalUrl: url }))
    request.once('timeout', () => request.destroy(new PreviewProxyError(504, 'Сайт не ответил вовремя')))
    request.once('error', reject)
    request.end()
  })
}

async function load(url: URL): Promise<{ response: IncomingMessage; finalUrl: URL }> {
  let current = url
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const result = await get(current)
    const location = result.response.headers.location
    if (!location || ![301, 302, 303, 307, 308].includes(result.response.statusCode ?? 0)) return result
    result.response.resume()
    if (redirects === MAX_REDIRECTS) throw new PreviewProxyError(502, 'Слишком много перенаправлений')
    current = new URL(location, current)
    if (current.protocol !== 'http:' && current.protocol !== 'https:') throw new PreviewProxyError(400, 'Разрешены только HTTP и HTTPS')
  }
  throw new PreviewProxyError(502, 'Не удалось загрузить сайт')
}

async function readLimited(response: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of response) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += data.length
    if (size > MAX_BYTES) {
      response.destroy()
      throw new PreviewProxyError(413, 'Ответ сайта слишком большой')
    }
    chunks.push(data)
  }
  return Buffer.concat(chunks)
}

export function registerPreviewProxy(app: FastifyInstance): void {
  app.get<{ Querystring: { url?: string } }>('/api/preview', async (req, reply) => {
    let url: URL
    try {
      url = new URL(req.query.url ?? '')
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error()
    } catch {
      return reply.code(400).send({ error: 'invalid_url', message: 'Разрешены только HTTP и HTTPS адреса' })
    }
    try {
      const { response, finalUrl } = await load(url)
      const contentType = response.headers['content-type'] ?? 'application/octet-stream'
      const body = await readLimited(response)
      const rewritten = /text\/(html|css)|application\/xhtml\+xml/i.test(contentType) ? rewritePreviewBody(body, contentType, finalUrl) : body
      reply.code(response.statusCode ?? 502)
      for (const [name, value] of Object.entries(response.headers)) {
        if (value === undefined || ['x-frame-options', 'content-security-policy', 'set-cookie', 'content-length', 'connection', 'transfer-encoding'].includes(name.toLowerCase())) continue
        reply.header(name, value)
      }
      reply.header('content-type', contentType)
      reply.header('content-length', String(rewritten.length))
      return reply.send(rewritten)
    } catch (err) {
      const known = err instanceof PreviewProxyError ? err : new PreviewProxyError(502, 'Сайт недоступен')
      return reply.code(known.status).send({ error: 'preview_unavailable', message: known.message })
    }
  })
}

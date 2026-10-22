// Прокси путей Web Reader в ядре для режима `remote`. Пути превью идут только через ядро: авторизация
// `/api/*` (Bearer, cookie сессии, preview-cookie iframe и ключ Chromium) срабатывает у ядра, ридер
// перепроверяет её через `whoami`. Роуты Make под тем же префиксом (`/api/preview/make*`) конкретнее
// wildcard-а и по правилам Fastify выигрывают — во встроенном Make это его роуты, в remote — его прокси.
// `/mcp/preview` исполнитель зовёт напрямую по `VC_READER_MCP_PUBLIC_BASE`; прокси здесь — запасной путь.
import { createHash, randomBytes } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { uid } from '@sislexa/identity/server/users/auth'
import { injectInspectorHtml, inspectorScriptUrl } from '../htmlInject.js'
import { registerServiceProxy } from '../makeBridge/proxy.js'

/** Всё, что регистрируют `routes/previewProxy.ts` и `mcp/previewMcp.ts`; полноту держит `proxy.test.ts`. */
export const READER_PROXY_PREFIXES = ['/api/preview', '/mcp/preview', '/web-recorder'] as const

export function registerReaderProxy(app: FastifyInstance, opts: { readerUrl: string; fetchImpl?: typeof fetch; timeoutMs?: number }): void {
  // Прокси превью отдаёт страницы и ресурсы до 5 МБ, формы уходят сырым телом; запас — на обёртку.
  registerServiceProxy(app, { name: 'reader', baseUrl: opts.readerUrl, prefixes: READER_PROXY_PREFIXES, bodyLimit: 16 * 1024 * 1024, ...opts })
}

const MAKE_PREVIEW_COOKIE = 'vc_make_preview'
const SESSION_MS = 30 * 60_000
const bridges = new WeakMap<FastifyInstance, ReturnType<typeof createMakePreviewInspector>>()

/** Register before Reader routes; covers embedded and remote Reader alike. */
export function registerMakePreviewInspector(app: FastifyInstance) {
  let bridge = bridges.get(app)
  if (!bridge) {
    bridge = createMakePreviewInspector(app)
    bridges.set(app, bridge)
  }
  return bridge
}

function createMakePreviewInspector(app: FastifyInstance) {
  const sessions = new Map<string, { user: string; origin: string; expiresAt: number }>()
  app.addHook('onClose', async () => { sessions.clear() })
  const isMakeSession = (req: FastifyRequest): boolean => {
    const requestUrl = new URL(req.url, 'http://core')
    if (requestUrl.pathname !== '/api/preview') return false
    let origin: string
    try { origin = new URL(requestUrl.searchParams.get('url') ?? '').origin } catch { return false }
    const cookieName = MAKE_PREVIEW_COOKIE + '_' + createHash('sha256').update(origin).digest('hex').slice(0, 16)
    const token = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1)
    const session = token ? sessions.get(token) : undefined
    if (!session) return false
    if (session.expiresAt <= Date.now()) { sessions.delete(token!); return false }
    return session.user === uid(req) && origin === session.origin
  }
  app.addHook('preHandler', async req => {
    if (!isMakeSession(req)) return
    // A cached ordinary preview must not produce 304 when Make first opens it.
    delete req.headers['if-none-match']
    delete req.headers['if-modified-since']
  })
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.method === 'HEAD' || [204, 304].includes(reply.statusCode)
      || !(typeof payload === 'string' || Buffer.isBuffer(payload)) || !isMakeSession(req)) return payload
    const scriptUrl = inspectorScriptUrl(req.headers.host, req.protocol === 'https')
    if (!scriptUrl) return payload
    const rewritten = await injectInspectorHtml(Buffer.from(payload), reply.getHeaders() as IncomingHttpHeaders, scriptUrl)
    if (!rewritten) return payload
    for (const name of ['transfer-encoding', 'content-encoding', 'etag', 'content-md5', 'digest']) reply.removeHeader(name)
    reply.header('content-length', rewritten.length)
    reply.header('cache-control', 'private, no-store')
    return rewritten
  })
  return {
    open(user: string, target: string, reply: FastifyReply): void {
      const now = Date.now()
      for (const [token, session] of sessions) if (session.expiresAt <= now) sessions.delete(token)
      if (sessions.size >= 1000) sessions.delete(sessions.keys().next().value!)
      const token = randomBytes(24).toString('hex')
      const origin = new URL(target).origin
      sessions.set(token, { user, origin, expiresAt: now + SESSION_MS })
      const cookieName = MAKE_PREVIEW_COOKIE + '_' + createHash('sha256').update(origin).digest('hex').slice(0, 16)
      const existing = reply.getHeader('set-cookie')
      const cookies = existing === undefined ? [] : Array.isArray(existing) ? existing.map(String) : [String(existing)]
      reply.header('set-cookie', [...cookies, `${cookieName}=${token}; Path=/api/preview; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${reply.request.protocol === 'https' ? '; Secure' : ''}`])
    }
  }
}

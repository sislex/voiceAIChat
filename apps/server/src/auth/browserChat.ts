import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'

/** Exact origins only; neither suffix matching nor a wildcard grants browser access. */
export function browserOriginAllowed(origin: string, origins: readonly string[], ownOrigin: string): boolean {
  if (origin === 'sislexa://app') return origins.includes(origin)
  try {
    const parsed = new URL(origin)
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.origin === origin
      && (origin === ownOrigin || origins.includes(origin))
  } catch { return false }
}

export interface BrowserChatSession {
  sessionId: string
  expiresAt: number
  origin?: string
  headers: FastifyRequest['headers']
  conversationId?: string
}
const digest = (token: string) => createHash('sha256').update(token).digest('hex')
const chatPath = (path: string) => path === '/ws' || path === '/api/uploads'
  || path === '/api/chat/settings' || /^\/api\/conversations(?:\/|$)/.test(path)

/** Short-lived opaque handles. Authority remains with the live Identity session/grant. */
export class BrowserChatSessions {
  private entries = new Map<string, BrowserChatSession>()
  readonly requests = new WeakMap<FastifyRequest, BrowserChatSession>()
  constructor(private now = Date.now) {}
  issue(req: FastifyRequest, cookieCredential?: string, conversationId?: string, authorityExpiresAt = Infinity) {
    this.prune()
    if (this.entries.size >= 4096) throw Object.assign(Error('chat_session_capacity'), { statusCode: 503 })
    const expiresAt = Math.min(this.now() + 5 * 60_000, authorityExpiresAt)
    if (expiresAt <= this.now()) throw Object.assign(Error('chat_session_expired'), { statusCode: 403 })
    const accessToken = 'chat_' + randomBytes(32).toString('base64url')
    const token = req.headers.authorization?.replace(/^Bearer /, '') ?? cookieCredential
    const entry: BrowserChatSession = { sessionId: randomUUID(), expiresAt,
      origin: req.headers.origin, conversationId,
      headers: { ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...(req.headers['x-sislexa-delegation'] ? { 'x-sislexa-delegation': req.headers['x-sislexa-delegation'] } : {}),
        'x-sislexa-tenant-id': req.user!.account!.tenantId } }
    this.entries.set(digest(accessToken), entry)
    return { version: 1 as const, sessionId: entry.sessionId, accessToken, expiresAt: entry.expiresAt,
      socketUrl: '/ws?session=' + encodeURIComponent(accessToken) }
  }
  current(entry: BrowserChatSession) { return entry.expiresAt > this.now() }
  private prune() { for (const [key, entry] of this.entries) if (!this.current(entry)) this.entries.delete(key) }
  register(app: FastifyInstance) {
    app.addHook('onClose', async () => { this.entries.clear() })
    app.addHook('onRequest', async (req, reply) => {
      const path = req.url.split('?')[0]!
      const query = new URL(req.url, 'http://core').searchParams
      const token = path === '/ws' ? query.get('session') : req.headers.authorization?.replace(/^Bearer /, '')
      if (!token || (path !== '/ws' && !token.startsWith('chat_'))) return
      reply.header('cache-control', 'no-store')
      this.prune()
      const entry = this.entries.get(digest(token))
      if (!entry) return reply.code(401).send({ error: 'chat_session_expired' })
      if (path === '/ws' && (query.has('token') || query.getAll('session').length !== 1
        || query.has('tenantId') && query.get('tenantId') !== entry.headers['x-sislexa-tenant-id'])) {
        return reply.code(403).send({ error: 'chat_session_denied' })
      }
      if (entry.conversationId && path.startsWith('/api/conversations')
        && decodeURIComponent(path.split('/')[3] ?? '') !== entry.conversationId) {
        return reply.code(403).send({ error: 'chat_session_denied' })
      }
      if (!chatPath(path) || entry.origin !== req.headers.origin
        || req.headers['x-sislexa-delegation'] !== undefined
        || (req.headers['x-sislexa-tenant-id'] !== undefined && req.headers['x-sislexa-tenant-id'] !== entry.headers['x-sislexa-tenant-id'])) {
        return reply.code(403).send({ error: 'chat_session_denied' })
      }
      this.requests.set(req, entry)
      // The bearer handle replaces ambient cookies; recheck its original authority on every request.
      delete req.headers.cookie
      delete req.headers.authorization
      Object.assign(req.headers, entry.headers)
    })
  }
}

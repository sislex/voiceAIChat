import type { FastifyInstance } from 'fastify'
import { REST } from '@voicechat/shared'
import { readCookie, SESSION_COOKIE } from '@sislexa/identity/server/users/auth'

export interface AnalyticsPublicTransport { url: string; publicFetchImpl: typeof fetch }

/** Core preserves the verified user credential while the component runtime
 * independently checks that this installation may connect to Analytics. */
export function registerAnalyticsProxy(app: FastifyInstance, transport: AnalyticsPublicTransport | undefined): void {
  for (const [method, url] of [['GET', REST.analyticsAccount], ['POST', REST.analyticsActivity]] as const) {
    app.route({ method, url, bodyLimit: 65_536, handler: async (request, reply) => {
      reply.header('cache-control', 'no-store')
      if (!transport) return reply.code(503).send({ error: 'analytics_not_configured' })
      const token = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization :
        readCookie(request, SESSION_COOKIE) ? 'Bearer ' + readCookie(request, SESSION_COOKIE) : undefined
      if (!token) return reply.code(401).send({ error: 'user_session_required' })
      const query = method === 'GET' && request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : ''
      try {
        const response = await transport.publicFetchImpl(transport.url + url + query, { method, redirect: 'error', signal: AbortSignal.timeout(10_000),
          headers: { authorization: token, 'x-request-id': request.id, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
          ...(method === 'POST' ? { body: JSON.stringify(request.body) } : {}) })
        if (response.status >= 300 && response.status < 400) return reply.code(503).send({ error: 'analytics_unavailable' })
        return reply.code(response.status).send(await response.json())
      } catch { return reply.code(503).send({ error: 'analytics_unavailable' }) }
    } })
  }
}

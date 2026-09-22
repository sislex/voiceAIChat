import type { FastifyInstance } from 'fastify'
import { REST } from '@voicechat/shared'
import { readCookie, SESSION_COOKIE } from "@sislexa/identity/server/users/auth"

export interface BillingPublicTransport { url: string; publicFetchImpl: typeof fetch }

/** Core authenticates and checks cookie CSRF before forwarding the user's authority. */
export function registerBillingProxy(app: FastifyInstance, transport: BillingPublicTransport | undefined): void {
  for (const [method, url] of [['GET', REST.billingAccount], ['PUT', REST.billingPolicy]] as const) {
    app.route({ method, url, bodyLimit: 16384, handler: async (req, reply) => {
      reply.header('cache-control', 'no-store')
      if (!transport) return reply.code(503).send({ error: 'billing_not_configured' })
      const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization :
        readCookie(req, SESSION_COOKIE) ? 'Bearer '+readCookie(req, SESSION_COOKIE) : undefined
      if (!token) return reply.code(401).send({ error: 'user_session_required' })
      try {
        const headers: Record<string, string> = { authorization: token }
        if (typeof req.headers['x-sislexa-tenant-id'] === 'string') headers['x-sislexa-tenant-id'] = req.headers['x-sislexa-tenant-id']
        if (method === 'PUT') headers['content-type'] = 'application/json'
        const response = await transport.publicFetchImpl(transport.url+url, { method, headers,
          ...(method === 'PUT' ? { body: JSON.stringify(req.body) } : {}), redirect: 'error', signal: AbortSignal.timeout(10_000) })
        if (response.status >= 300 && response.status < 400) return reply.code(503).send({ error: 'billing_unavailable' })
        const content = await response.json()
        return reply.code(response.status).send(content)
      } catch { return reply.code(503).send({ error: 'billing_unavailable' }) }
    } })
  }
}

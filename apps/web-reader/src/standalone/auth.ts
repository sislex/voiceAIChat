// Авторизация принадлежит ядру: передаём исходные cookie/Bearer/CSRF на каждый запрос.
// У browser API нет GET-чтений, поэтому кэш авторизации здесь не нужен.
import type { FastifyInstance } from 'fastify'
import { INTERNAL_WHOAMI_PATH, type WhoamiRequest, type WhoamiResponse } from '@voicechat/shared'

export function registerForwardedAuth(app: FastifyInstance, opts: { coreUrl: string; token: string; fetchImpl?: typeof fetch }): void {
  app.decorateRequest('user', null)
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return
    const headers: WhoamiRequest['headers'] = {}
    for (const name of ['cookie', 'authorization', 'x-vc-csrf']) {
      const value = req.headers[name]
      if (typeof value === 'string') headers[name] = value
    }
    try {
      const res = await (opts.fetchImpl ?? fetch)(`${opts.coreUrl.replace(/\/+$/, '')}${INTERNAL_WHOAMI_PATH}`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.token}` },
        body: JSON.stringify({ method: req.method, url: req.url, headers } satisfies WhoamiRequest),
        signal: AbortSignal.timeout(10_000)
      })
      if (!res.ok) throw new Error(`whoami: HTTP ${res.status}`)
      const verdict = await res.json() as WhoamiResponse
      if (!verdict.ok) return reply.code(verdict.status).send({ error: verdict.error })
      ;(req as unknown as { user: unknown }).user = verdict.user
    } catch (error) {
      req.log.warn({ err: error }, '[web-reader] ядро недоступно для проверки сессии')
      return reply.code(503).send({ error: 'core_unavailable' })
    }
  })
}

// Авторизация в отдельном процессе Image Studio: своей у него нет и не должно быть — одна авторизация на
// все сервисы. Cookie/Bearer запроса пересылаются ядру (`/internal/whoami`), ответ кладётся в
// `req.user`, как это делает preHandler ядра. Проверка каждого запроса
// сохраняет немедленный отзыв сессии; мутации дополнительно проходят CSRF-проверку ядра.

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { INTERNAL_WHOAMI_PATH, type WhoamiRequest, type WhoamiResponse } from '@voicechat/shared'

export interface ForwardedAuthOptions {
  coreUrl: string
  token: string
  fetchImpl?: typeof fetch
}

export function registerForwardedAuth(app: FastifyInstance, opts: ForwardedAuthOptions): void {
  const fetchImpl = opts.fetchImpl ?? fetch
  const url = `${opts.coreUrl.replace(/\/+$/, '')}${INTERNAL_WHOAMI_PATH}`

  const whoami = async (req: FastifyRequest): Promise<WhoamiResponse> => {
    const headers: WhoamiRequest['headers'] = {}
    for (const name of ['cookie', 'authorization', 'x-vc-csrf'] as const) {
      const value = req.headers[name]
      if (typeof value === 'string') headers[name] = value
    }
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.token}` },
      body: JSON.stringify({ method: req.method, url: req.url, headers } satisfies WhoamiRequest),
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) throw new Error(`whoami: HTTP ${res.status}`)
    return (await res.json()) as WhoamiResponse
  }

  app.decorateRequest('user', null)
  app.addHook('preHandler', async (req, reply) => {
    const path = req.url.split('?')[0]!
    if (!path.startsWith('/api/')) return
    let verdict: WhoamiResponse
    try { verdict = await whoami(req) } catch (error) {
      req.log.error({ err: error }, '[image-studio] ядро недоступно для проверки сессии')
      await reply.code(503).send({ error: 'core_unavailable' })
      return reply
    }
    if (!verdict.ok) {
      await reply.code(verdict.status).send({ error: verdict.error })
      return reply
    }
    ;(req as unknown as { user: unknown }).user = verdict.user
  })
}

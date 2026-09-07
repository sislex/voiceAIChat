// Авторизация в отдельном процессе Make: своей у него нет и не должно быть — одна авторизация на
// все сервисы. Cookie/Bearer запроса пересылаются ядру (`/internal/whoami`), ответ кладётся в
// `req.user`, как это делает preHandler ядра. Чтения кэшируются на 30 с по значению токена:
// открытая панель шлёт десятки запросов в минуту, а отзыв сессии, доехавший за полминуты, для
// редактора файлов — приемлемо. Мутации в кэш не ходят: у них CSRF-проверка на каждый запрос.

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { INTERNAL_WHOAMI_PATH, type WhoamiRequest, type WhoamiResponse } from '../internal.js'

export interface ForwardedAuthOptions {
  coreUrl: string
  token: string
  fetchImpl?: typeof fetch
  cacheMs?: number
  now?: () => number
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function registerForwardedAuth(app: FastifyInstance, opts: ForwardedAuthOptions): void {
  const fetchImpl = opts.fetchImpl ?? fetch
  const now = opts.now ?? Date.now
  const cacheMs = opts.cacheMs ?? 30_000
  const url = `${opts.coreUrl.replace(/\/+$/, '')}${INTERNAL_WHOAMI_PATH}`
  const cache = new Map<string, { user: WhoamiResponse & { ok: true }; at: number }>()

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
    // Превью и обычный API у ядра авторизуются по-разному (preview-cookie действует только под
    // `/api/preview/make`), поэтому класс пути — часть ключа кэша.
    const readable = READ_METHODS.has(req.method)
    const key = readable
      ? `${path.startsWith('/api/preview/') ? 'preview' : 'api'}|${req.headers.authorization ?? ''}|${req.headers.cookie ?? ''}`
      : null
    if (key) {
      const hit = cache.get(key)
      if (hit && now() - hit.at < cacheMs) { (req as unknown as { user: unknown }).user = hit.user.user; return }
    }
    let verdict: WhoamiResponse
    try { verdict = await whoami(req) } catch (error) {
      req.log.error({ err: error }, '[make] ядро недоступно для проверки сессии')
      await reply.code(503).send({ error: 'core_unavailable' })
      return reply
    }
    if (!verdict.ok) {
      await reply.code(verdict.status).send({ error: verdict.error })
      return reply
    }
    if (key) {
      if (cache.size > 5_000) cache.clear()
      cache.set(key, { user: verdict, at: now() })
    }
    ;(req as unknown as { user: unknown }).user = verdict.user
  })
}

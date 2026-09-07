// Авторизация в отдельном процессе канбана: своей у него нет и не должно быть — одна авторизация на
// все сервисы. Cookie/Bearer запроса пересылаются ядру (`/internal/whoami`), ответ кладётся в
// `req.user`, как это делает preHandler ядра, — `uid(req)`/`requireProjectPermission` кластера работают
// без изменений. Права проекта по пути запроса проверяет ядро до пересылки: пути канбана снаружи идут
// только через прокси ядра (`kanbanBridge/proxy.ts`). Чтения кэшируются на 30 с по значению токена;
// мутации в кэш не ходят — у них CSRF-проверка на каждый запрос.
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { INTERNAL_WHOAMI_PATH, type SessionUser, type WhoamiRequest, type WhoamiResponse } from '@voicechat/shared'

export interface ForwardedAuthOptions {
  coreUrl: string
  token: string
  fetchImpl?: typeof fetch
  cacheMs?: number
  now?: () => number
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Публичные пути кластера — те же, что у ядра (`isPublic`): приглашение по токену не требует сессии. */
function isPublic(path: string): boolean {
  return path.startsWith('/api/session/')
}

export function registerForwardedAuth(app: FastifyInstance, opts: ForwardedAuthOptions): void {
  const fetchImpl = opts.fetchImpl ?? fetch
  const now = opts.now ?? Date.now
  const cacheMs = opts.cacheMs ?? 30_000
  const url = `${opts.coreUrl.replace(/\/+$/, '')}${INTERNAL_WHOAMI_PATH}`
  const cache = new Map<string, { user: SessionUser; at: number }>()

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
    if (!path.startsWith('/api/') || isPublic(path)) return
    const key = READ_METHODS.has(req.method) ? `${req.headers.authorization ?? ''}|${req.headers.cookie ?? ''}` : null
    if (key) {
      const hit = cache.get(key)
      if (hit && now() - hit.at < cacheMs) { req.user = hit.user; return }
    }
    let verdict: WhoamiResponse
    try { verdict = await whoami(req) } catch (error) {
      req.log.error({ err: error }, '[kanban] ядро недоступно для проверки сессии')
      await reply.code(503).send({ error: 'core_unavailable' })
      return reply
    }
    if (!verdict.ok) {
      await reply.code(verdict.status).send({ error: verdict.error })
      return reply
    }
    const user = verdict.user as SessionUser
    if (key) {
      if (cache.size > 5_000) cache.clear()
      cache.set(key, { user, at: now() })
    }
    req.user = user
  })
}

// Внутренний API ядра для соседних сервисов (сегодня — отдельный процесс Make). Не под `/api/`:
// сюда не действует пользовательская авторизация, действует общий Bearer `VC_INTERNAL_TOKEN`
// сети compose; наружу Caddy эти пути не проксирует. Без токена в конфиге API не регистрируется —
// в dev и desktop его просто нет.

import type { FastifyInstance } from 'fastify'
import {
  INTERNAL_MAKE_CORE_PATH, INTERNAL_MAKE_EVENTS_PATH, INTERNAL_WHOAMI_PATH, RpcError, createCoreRpcDispatcher,
  type MakeCore, type MakeEventsRequest, type MakeHub, type RpcRequest, type WhoamiRequest, type WhoamiResponse
} from '@voicechat/make'
import type { AuthenticateFn } from '../users/auth.js'

export interface InternalRoutesDeps {
  token: string
  /** Данные чата/канбана/машин для Make — тот же порт, что и у встроенного режима. */
  makeCore: MakeCore
  /** Шина событий Make у ядра: сюда отдельный процесс Make присылает `changed`/`presence`/`turnSnapshot`. */
  makeHub?: Pick<MakeHub, 'apply'>
  authenticate: AuthenticateFn
}

export function registerInternalRoutes(app: FastifyInstance, deps: InternalRoutesDeps): void {
  const dispatch = createCoreRpcDispatcher(deps.makeCore)
  app.register(async (scope) => {
    scope.addHook('onRequest', async (req, reply) => {
      if (req.headers.authorization !== `Bearer ${deps.token}`) { await reply.code(401).send({ error: 'unauthorized' }); return reply }
    })
    scope.post<{ Body: RpcRequest }>(INTERNAL_MAKE_CORE_PATH, async (req, reply) => {
      try { return { result: await dispatch(req.body ?? { method: '', args: [] }) } } catch (error) {
        return reply.code(error instanceof RpcError ? error.status : 500).send({ error: error instanceof Error ? error.message : String(error) })
      }
    })
    scope.post<{ Body: MakeEventsRequest }>(INTERNAL_MAKE_EVENTS_PATH, async (req, reply) => {
      if (!deps.makeHub) return reply.code(409).send({ error: 'Make встроен в ядро — событий снаружи не ждём' })
      for (const event of req.body?.events ?? []) deps.makeHub.apply(event)
      return { ok: true }
    })
    // Аутентификация пересланного запроса: тот же код, что в preHandler `/api/*`, по методу, пути и заголовкам.
    scope.post<{ Body: WhoamiRequest }>(INTERNAL_WHOAMI_PATH, async (req): Promise<WhoamiResponse> => {
      const forwarded = req.body
      const verdict = await deps.authenticate({ method: forwarded.method, url: forwarded.url, headers: forwarded.headers })
      return verdict.ok ? { ok: true, user: verdict.user } : verdict
    })
  })
}

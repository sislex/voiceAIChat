import type { PlaywrightReaderCore, PlaywrightReaderService } from '@voicechat/playwright-reader'
import { INTERNAL_PLAYWRIGHT_READER_CORE_PATH, INTERNAL_PLAYWRIGHT_READER_SERVICE_PATH, PLAYWRIGHT_READER_CORE_METHODS, PLAYWRIGHT_READER_SERVICE_METHODS, PLAYWRIGHT_READER_RPC_BODY_LIMIT } from '@voicechat/shared'
// Внутренний API ядра для соседних сервисов (отдельные процессы Make и канбана). Не под `/api/`:
// сюда не действует пользовательская авторизация, действует общий Bearer `VC_INTERNAL_TOKEN`
// сети compose; наружу Caddy эти пути не проксирует. Без токена в конфиге API не регистрируется —
// в dev и desktop его просто нет.

import type { FastifyInstance } from 'fastify'
import {
  INTERNAL_MAKE_CORE_PATH, INTERNAL_MAKE_EVENTS_PATH, INTERNAL_MAKE_SERVICE_PATH, INTERNAL_WHOAMI_PATH, RpcError,
  createCoreRpcDispatcher, createServiceRpcDispatcher,
  type MakeCore, type MakeEventsRequest, type MakeHub, type MakeService, type RpcRequest, type WhoamiRequest, type WhoamiResponse
} from '@voicechat/make'
import type { AuthenticateFn } from '../users/auth.js'
import type { SessionHub } from '../users/sessionHub.js'
import type { DeployTrigger } from './admin.js'
import { ADMIN_RPC_METHODS, INTERNAL_ADMIN_RPC_PATH, type AdminRpcMethod } from '../admin/internal.js'
import type { KanbanCore } from '../kanban/core.js'
import { createKanbanCoreRpcDispatcher } from '../kanbanBridge/internal.js'
import {
  INTERNAL_KANBAN_CORE_PATH, INTERNAL_KANBAN_EVENTS_PATH, INTERNAL_KANBAN_EXEC_STREAM_PATH,
  type KanbanEvent, type KanbanEventsRequest, type MachineSnapshot
} from '../kanban/internal.js'
import { serveExecStream, type ExecStreamRequest } from '../internal/execStream.js'
import { createRpcDispatcher } from '@voicechat/shared'
import type { ReaderCore } from '../reader/core.js'
import { INTERNAL_READER_CORE_PATH, READER_CORE_RPC_METHODS, READER_RPC_BODY_LIMIT } from '../reader/internal.js'

export interface InternalRoutesDeps {
  token: string
  /** Данные чата/канбана/машин для Make — тот же порт, что и у встроенного режима. */
  makeCore: MakeCore
  /** Шина событий Make у ядра: сюда отдельный процесс Make присылает `changed`/`presence`/`turnSnapshot`. */
  makeHub?: Pick<MakeHub, 'apply'>
  /** Make встроен в ядро: его `MakeService` отдаём по RPC соседям (отдельному канбану нужны источники дизайна задачи). */
  makeService?: MakeService
  authenticate: AuthenticateFn
  /** Для отдельного процесса админки: деплой (сокет на хосте ядра) и живое уведомление об отзыве сессии. */
  admin?: { deployTrigger?: DeployTrigger; sessionHub: Pick<SessionHub, 'emit'> }
  /** Web Reader — отдельный процесс: relay действий в панель, ключи Chromium, список превью, кадры проверок. */
  reader?: ReaderCore
  playwrightReader?: { core: PlaywrightReaderCore; service: PlaywrightReaderService }
  /** Канбан — отдельный процесс: состояние ядра ему по RPC, его события — на ленты ядра. */
  kanban?: {
    core: KanbanCore
    machinesSnapshot: () => MachineSnapshot[]
    tunnels: { authorize(id: string): Promise<boolean>; closed(id: string): Promise<void> }
    apply: (event: KanbanEvent) => void
  }
}

export function registerInternalRoutes(app: FastifyInstance, deps: InternalRoutesDeps): void {
  const dispatch = createCoreRpcDispatcher(deps.makeCore)
  const sendRpcError = (reply: { code(status: number): { send(body: unknown): unknown } }, error: unknown): unknown =>
    reply.code(error instanceof RpcError ? error.status : 500).send({ error: error instanceof Error ? error.message : String(error) })
  app.register(async (scope) => {
    scope.addHook('onRequest', async (req, reply) => {
      if (req.headers.authorization !== `Bearer ${deps.token}`) { await reply.code(401).send({ error: 'unauthorized' }); return reply }
    })
    scope.post<{ Body: RpcRequest }>(INTERNAL_MAKE_CORE_PATH, async (req, reply) => {
      try { return { result: await dispatch(req.body ?? { method: '', args: [] }) } } catch (error) { return sendRpcError(reply, error) }
    })
    scope.post<{ Body: MakeEventsRequest }>(INTERNAL_MAKE_EVENTS_PATH, async (req, reply) => {
      if (!deps.makeHub) return reply.code(409).send({ error: 'Make встроен в ядро — событий снаружи не ждём' })
      for (const event of req.body?.events ?? []) deps.makeHub.apply(event)
      return { ok: true }
    })
    if (deps.makeService) {
      const dispatchMake = createServiceRpcDispatcher(deps.makeService)
      scope.post<{ Body: RpcRequest }>(INTERNAL_MAKE_SERVICE_PATH, async (req, reply) => {
        try { return { result: await dispatchMake(req.body ?? { method: '', args: [] }) } } catch (error) { return sendRpcError(reply, error) }
      })
    }
    // Аутентификация пересланного запроса: тот же код, что в preHandler `/api/*`, по методу, пути и заголовкам.
    scope.post<{ Body: WhoamiRequest }>(INTERNAL_WHOAMI_PATH, async (req): Promise<WhoamiResponse> => {
      const forwarded = req.body
      const verdict = await deps.authenticate({ method: forwarded.method, url: forwarded.url, headers: forwarded.headers })
      return verdict.ok ? { ok: true, user: verdict.user } : verdict
    })
    if (deps.kanban) registerKanbanInternal(scope, deps.kanban, sendRpcError)
    if (deps.reader) {
      const dispatchReader = createRpcDispatcher(deps.reader, READER_CORE_RPC_METHODS)
      scope.post<{ Body: RpcRequest }>(INTERNAL_READER_CORE_PATH, { bodyLimit: READER_RPC_BODY_LIMIT }, async (req, reply) => {
        try { return { result: await dispatchReader(req.body ?? { method: '', args: [] }) } } catch (error) { return sendRpcError(reply, error) }
      })
    }
    if (deps.playwrightReader) {
      const endpoints = [
        [INTERNAL_PLAYWRIGHT_READER_CORE_PATH, createRpcDispatcher(deps.playwrightReader.core, PLAYWRIGHT_READER_CORE_METHODS)],
        [INTERNAL_PLAYWRIGHT_READER_SERVICE_PATH, createRpcDispatcher(deps.playwrightReader.service, PLAYWRIGHT_READER_SERVICE_METHODS)]
      ] as const
      for (const [path, dispatchReader] of endpoints) {
        scope.post<{ Body: RpcRequest }>(path, { bodyLimit: PLAYWRIGHT_READER_RPC_BODY_LIMIT }, async (req, reply) => {
          try { return { result: await dispatchReader(req.body ?? { method: '', args: [] }) } } catch (error) { return sendRpcError(reply, error) }
        })
      }
    }
    if (deps.admin) {
      const admin = deps.admin
      scope.post<{ Body: RpcRequest }>(INTERNAL_ADMIN_RPC_PATH, async (req, reply) => {
        const { method, args } = req.body ?? { method: '', args: [] }
        if (!Array.isArray(args) || !(ADMIN_RPC_METHODS as readonly string[]).includes(method)) return sendRpcError(reply, new RpcError(400, `неизвестный метод ${method}`))
        try {
          switch (method as AdminRpcMethod) {
            case 'deploy': {
              if (!admin.deployTrigger) return reply.code(503).send({ error: 'deploy API недоступен: сокет host-side API не настроен' })
              return { result: await admin.deployTrigger.trigger() }
            }
            case 'sessionsChanged': admin.sessionHub.emit(args[0] as string, args[1] as string | undefined); return { result: null }
          }
        } catch (error) { return sendRpcError(reply, error) }
      })
    }
  })
}

function registerKanbanInternal(scope: FastifyInstance, kanban: NonNullable<InternalRoutesDeps['kanban']>, sendRpcError: (reply: { code(status: number): { send(body: unknown): unknown } }, error: unknown) => unknown): void {
  const dispatch = createKanbanCoreRpcDispatcher({ core: kanban.core, machinesSnapshot: kanban.machinesSnapshot, tunnels: kanban.tunnels })
  scope.post<{ Body: RpcRequest }>(INTERNAL_KANBAN_CORE_PATH, async (req, reply) => {
    try { return { result: await dispatch(req.body ?? { method: '', args: [] }) } } catch (error) { return sendRpcError(reply, error) }
  })
  scope.post<{ Body: KanbanEventsRequest }>(INTERNAL_KANBAN_EVENTS_PATH, async (req) => {
    for (const event of req.body?.events ?? []) kanban.apply(event)
    return { ok: true }
  })
  // Поток вывода команды машины: NDJSON до конца команды. Обрыв соединения со стороны канбана —
  // отмена команды (так же, как отмена рана отменяет exec во встроенном режиме).
  scope.post<{ Body: ExecStreamRequest }>(INTERNAL_KANBAN_EXEC_STREAM_PATH, async (req, reply) => {
    const body = req.body
    if (!body || typeof body.agentId !== 'string' || typeof body.command !== 'string') return reply.code(400).send({ error: 'bad exec request' })
    await serveExecStream(reply, body, kanban.core.machines)
  })
}

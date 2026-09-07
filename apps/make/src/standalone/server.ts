// Отдельный процесс Make (`VC_MAKE_MODE=remote` у ядра). Тот же `createMakeModule`, что и внутри
// ядра, но данные чата/канбана — по HTTP (`HttpMakeCore`), авторизация — пересылкой в ядро
// (`registerForwardedAuth`), а события шины уходят ядру, у которого живут сокеты пользователей.
// Caddy направляет сюда `/api/make/*`, `/api/preview/make*/*`, `/p/*`, `/s/*` и `/mcp/make`.

import Fastify, { type FastifyInstance } from 'fastify'
import type { MakeCore } from '../core.js'
import type { MakeHubEvent } from '../hub.js'
import { INTERNAL_MAKE_EVENTS_PATH, INTERNAL_MAKE_SERVICE_PATH, MAKE_HEALTH_PATH, RpcError, createServiceRpcDispatcher, type MakeEventsRequest, type RpcRequest } from '../internal.js'
import { createMakeModule, type MakeModule } from '../module.js'
import { registerForwardedAuth } from './auth.js'
import type { MakeStandaloneConfig } from './config.js'
import { HttpMakeCore } from './httpCore.js'

export interface BuildMakeServerOptions {
  config: MakeStandaloneConfig
  /** Порт к ядру (в тестах — фейк); по умолчанию HTTP к `config.coreUrl`. */
  core?: MakeCore
  fetchImpl?: typeof fetch
  logger?: boolean
}

export async function buildMakeServer(opts: BuildMakeServerOptions): Promise<{ app: FastifyInstance; make: MakeModule }> {
  const { config } = opts
  if (!config.internalToken) throw new Error('Make standalone requires VC_INTERNAL_TOKEN')
  if (!config.mcpSecret) throw new Error('Make standalone requires VC_MCP_SECRET (тот же, что у ядра)')
  const fetchImpl = opts.fetchImpl ?? fetch
  const app = Fastify({ logger: opts.logger ?? false })
  const core = opts.core ?? new HttpMakeCore({ coreUrl: config.coreUrl, token: config.internalToken, fetchImpl, onError: (error) => app.log.warn({ err: error }, '[make] фоновый вызов ядра не удался') })

  registerForwardedAuth(app, { coreUrl: config.coreUrl, token: config.internalToken, fetchImpl })
  const make = createMakeModule({ dataDir: config.dataDir, core, mcpSecret: config.mcpSecret })

  // События шины — ядру пачками: за один ход ассистента приходит много `changed`, и слать каждый
  // отдельным запросом значит удвоить трафик ради того, что и так сливается в один кадр у клиента.
  let pending: MakeHubEvent[] = []
  let flushTimer: NodeJS.Timeout | null = null
  const flush = async (): Promise<void> => {
    flushTimer = null
    const events = pending
    pending = []
    if (!events.length) return
    try {
      const res = await fetchImpl(`${config.coreUrl.replace(/\/+$/, '')}${INTERNAL_MAKE_EVENTS_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.internalToken}` },
        body: JSON.stringify({ events } satisfies MakeEventsRequest),
        signal: AbortSignal.timeout(10_000)
      })
      if (!res.ok) app.log.warn({ status: res.status }, '[make] ядро не приняло события шины')
    } catch (error) { app.log.warn({ err: error }, '[make] события шины не доставлены ядру') }
  }
  make.hub.setListener((event) => {
    pending.push(event)
    // turnSnapshot нужен ядру до конца хода, changed — как можно скорее: не ждём таймера дольше 20 мс.
    if (!flushTimer) flushTimer = setTimeout(() => { void flush() }, 20)
  })
  app.addHook('onClose', async () => { if (flushTimer) clearTimeout(flushTimer); await flush() })

  make.register(app)

  // Внутреннее API для ядра: `MakeService` по RPC. Не под `/api/` — пересылка авторизации сюда не действует.
  const dispatch = createServiceRpcDispatcher(make.service)
  app.post<{ Body: RpcRequest }>(INTERNAL_MAKE_SERVICE_PATH, async (req, reply) => {
    if (req.headers.authorization !== `Bearer ${config.internalToken}`) return reply.code(401).send({ error: 'unauthorized' })
    try { return { result: await dispatch(req.body ?? { method: '', args: [] }) } } catch (error) {
      return reply.code(error instanceof RpcError ? error.status : 500).send({ error: error instanceof Error ? error.message : String(error) })
    }
  })
  app.get(MAKE_HEALTH_PATH, async () => ({ ok: true, service: 'make', version: config.version }))

  return { app, make }
}

import { applicationRuntimeMetadata } from '@voicechat/shared'
// Standalone Make process, with VC_MAKE_MODE=remote in core. Uses the same createMakeModule as
// embedded mode, but fetches chat and kanban data over HTTP via HttpMakeCore, forwards
// authentication via registerForwardedAuth, and sends events to core, which owns user sockets.
// Caddy routes /api/make/*, /api/preview/make*/*, /p/*, /s/*, and /mcp/make here.

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
  /** Core port, replaceable by a fake in tests; defaults to HTTP at config.coreUrl. */
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

  // Send events to core in batches: an assistant turn produces many changed events that the client
  // coalesces anyway, so one request per event would waste traffic.
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
    // Core needs turnSnapshot before the turn finishes, and changed should arrive promptly; wait no
    // longer than 20 ms.
    if (!flushTimer) flushTimer = setTimeout(() => { void flush() }, 20)
  })
  app.addHook('onClose', async () => { if (flushTimer) clearTimeout(flushTimer); await flush() })

  make.register(app)

  // Internal MakeService RPC for core. These paths are outside /api/, so forwarded user
  // authentication does not apply.
  const dispatch = createServiceRpcDispatcher(make.service)
  app.post<{ Body: RpcRequest }>(INTERNAL_MAKE_SERVICE_PATH, async (req, reply) => {
    if (req.headers.authorization !== `Bearer ${config.internalToken}`) return reply.code(401).send({ error: 'unauthorized' })
    try { return { result: await dispatch(req.body ?? { method: '', args: [] }) } } catch (error) {
      return reply.code(error instanceof RpcError ? error.status : 500).send({ error: error instanceof Error ? error.message : String(error) })
    }
  })
  app.get(MAKE_HEALTH_PATH, async () => ({ application: applicationRuntimeMetadata('make', process.env), ok: true, service: 'make', version: config.version }))

  return { app, make }
}

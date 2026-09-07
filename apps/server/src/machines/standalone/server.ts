// Отдельный процесс машин (`VC_MACHINES_MODE=remote` у ядра): тот же `createMachinesModule`, что внутри
// ядра — реестр, WebSocket компаньон-агентов `/agent`, REST машин и установщики, политика команд, журнал,
// watchdog — на общей базе (только Postgres). Ядру он отдаёт порт `MachinesService` по внутреннему API:
// RPC, потоковый exec и шину событий на постоянном WebSocket (снимки машин и PTY, события PTY, кадры
// владельцам, запросы авторизации тоннелей). Авторизация REST — пересылкой в ядро (`/internal/whoami`).
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import type { WebSocket } from 'ws'
import { RpcError, type RpcRequest } from '@voicechat/shared'
import type { ServerConfig } from '../../config.js'
import { VoiceChatDb } from '../../db/database.js'
import { AgentFsError, AgentRegistry } from '../../agents/registry.js'
import { registerForwardedAuth } from '../../internal/forwardedAuth.js'
import { serveExecStream, type ExecStreamRequest } from '../../internal/execStream.js'
import { createMachinesModule } from '../module.js'
import type { MachinesService } from '../service.js'
import {
  MACHINES_HEALTH_PATH, MACHINES_INTERNAL_EVENTS_PATH, MACHINES_INTERNAL_EXEC_STREAM_PATH, MACHINES_INTERNAL_RPC_PATH, MACHINES_RPC_METHODS,
  machineStates, type MachinesClientMessage, type MachinesEvent, type MachinesRpcErrorBody, type MachinesRpcMethod, type MachinesSnapshot
} from '../internal.js'

export interface BuildMachinesServerOptions {
  /** Тот же `loadConfig(env)`, что у ядра. */
  config: ServerConfig
  /** Адрес ядра внутри сети (`VC_CORE_URL`) — для проверки сессий. */
  coreUrl: string
  /** Общая база; по умолчанию — `VC_DB_URL`. В тестах — тот же экземпляр, что у ядра. */
  db?: VoiceChatDb
  registry?: AgentRegistry
  fetchImpl?: typeof fetch
  logger?: boolean
  version?: string | null
}

export interface MachinesServer {
  app: FastifyInstance
  db: VoiceChatDb
  registry: AgentRegistry
  machines: MachinesService
}

/** Сколько ждать ответа ядра на авторизацию подключения к тоннелю. */
const TUNNEL_AUTHORIZE_TIMEOUT_MS = 10_000

export async function buildMachinesServer(opts: BuildMachinesServerOptions): Promise<MachinesServer> {
  const { config, coreUrl } = opts
  if (!config.internalToken) throw new Error('Машины отдельным процессом требуют VC_INTERNAL_TOKEN (тот же, что у ядра)')
  if (!opts.db && !config.dbUrl) throw new Error('Машины отдельным процессом требуют общую базу VC_DB_URL (Postgres)')
  const token = config.internalToken
  const fetchImpl = opts.fetchImpl ?? fetch
  const app = Fastify({ logger: opts.logger ?? false })
  await app.register(fastifyWebsocket, { options: { maxPayload: 48 * 1024 * 1024 } })

  const ownDb = !opts.db
  const db = opts.db ?? new VoiceChatDb(join(config.dataDir, 'voicechat.db'), { postgres: { url: config.dbUrl! } })
  await db.ready
  if (ownDb) app.addHook('onClose', async () => { await db.close() })

  registerForwardedAuth(app, { name: 'machines', coreUrl, token, fetchImpl })

  // Шина событий: подключённые ядра (обычно одно). Кадры и снимки уходят всем; ответы на авторизацию
  // тоннеля ждём от любого.
  const clients = new Set<WebSocket>()
  const push = (event: MachinesEvent): void => {
    const data = JSON.stringify(event)
    for (const client of clients) if (client.readyState === client.OPEN) client.send(data)
  }
  const pendingAuthorizations = new Map<string, (ok: boolean) => void>()

  const registry = opts.registry ?? new AgentRegistry({ offlineGraceMs: config.agentOfflineGraceMs })
  const module = await createMachinesModule({ app, db, config, registry, publish: (message, userId) => push({ kind: 'frame', message, userId }) })

  // Снимок машин — после каждого изменения реестра (телеметрия идёт часто, поэтому с небольшой задержкой).
  let machinesTimer: NodeJS.Timeout | null = null
  const pushMachines = (): void => {
    if (machinesTimer) return
    machinesTimer = setTimeout(() => { machinesTimer = null; push({ kind: 'machines', machines: machineStates(registry) }) }, 100)
    machinesTimer.unref?.()
  }
  registry.onChange(pushMachines)
  registry.onPtyChange(() => push({ kind: 'ptys', ptys: registry.ptySnapshot() }))
  registry.onAgentReady(async (agentId) => push({ kind: 'agentReady', agentId }))
  registry.onCommand(async (report) => push({ kind: 'command', report }))
  app.addHook('onClose', async () => { if (machinesTimer) clearTimeout(machinesTimer); for (const client of clients) client.close() })

  const snapshot = (): MachinesSnapshot => ({ machines: machineStates(registry), ptys: registry.ptySnapshot() })
  const authorizeViaCore = (id: string): Promise<boolean> => new Promise((resolve) => {
    if (!clients.size) { resolve(false); return }
    const requestId = randomUUID()
    const timer = setTimeout(() => { pendingAuthorizations.delete(requestId); resolve(false) }, TUNNEL_AUTHORIZE_TIMEOUT_MS)
    pendingAuthorizations.set(requestId, (ok) => { clearTimeout(timer); pendingAuthorizations.delete(requestId); resolve(ok) })
    push({ kind: 'tunnelAuthorize', requestId, id })
  })

  const dispatch = async ({ method, args }: RpcRequest): Promise<unknown> => {
    if (!Array.isArray(args) || !(MACHINES_RPC_METHODS as readonly string[]).includes(method)) throw new RpcError(400, `неизвестный метод ${method}`)
    const a = args as never[]
    switch (method as MachinesRpcMethod) {
      case 'snapshot': return snapshot()
      case 'ptyStart': registry.ptyStart(a[0], a[1], a[2], a[3], a[4], (event) => push({ kind: 'pty', event })); return null
      case 'createTunnel': {
        const id = a[0] as string
        return registry.createTunnel(id, a[1], a[2], a[3], () => authorizeViaCore(id), async () => push({ kind: 'tunnelClosed', id }))
      }
      case 'closeTunnel': return registry.closeTunnel(a[0])
      default: {
        const fn = registry[method as Exclude<MachinesRpcMethod, 'snapshot' | 'ptyStart' | 'createTunnel' | 'closeTunnel'>] as (...x: never[]) => unknown
        return (await fn.apply(registry, a)) ?? null
      }
    }
  }

  app.register(async (scope) => {
    scope.addHook('onRequest', async (req, reply) => {
      if (req.headers.authorization !== `Bearer ${token}`) { await reply.code(401).send({ error: 'unauthorized' }); return reply }
    })
    scope.post<{ Body: RpcRequest }>(MACHINES_INTERNAL_RPC_PATH, async (req, reply) => {
      try { return { result: await dispatch(req.body ?? { method: '', args: [] }) } } catch (error) {
        const body: MachinesRpcErrorBody = { error: error instanceof Error ? error.message : String(error), ...(error instanceof AgentFsError && error.code ? { code: error.code } : {}) }
        return reply.code(error instanceof RpcError ? error.status : 500).send(body)
      }
    })
    scope.post<{ Body: ExecStreamRequest }>(MACHINES_INTERNAL_EXEC_STREAM_PATH, async (req, reply) => {
      const body = req.body
      if (!body || typeof body.agentId !== 'string' || typeof body.command !== 'string') return reply.code(400).send({ error: 'bad exec request' })
      await serveExecStream(reply, body, registry)
    })
    scope.get(MACHINES_INTERNAL_EVENTS_PATH, { websocket: true }, (socket) => {
      clients.add(socket)
      const full = snapshot()
      socket.send(JSON.stringify({ kind: 'machines', machines: full.machines } satisfies MachinesEvent))
      socket.send(JSON.stringify({ kind: 'ptys', ptys: full.ptys } satisfies MachinesEvent))
      socket.on('message', (data: Buffer | string) => {
        let message: MachinesClientMessage
        try { message = JSON.parse(data.toString()) as MachinesClientMessage } catch { return }
        if (message.kind === 'tunnelAuthorizeResult') pendingAuthorizations.get(message.requestId)?.(message.ok)
      })
      socket.on('close', () => { clients.delete(socket) })
      socket.on('error', () => { clients.delete(socket) })
    })
  })
  app.get(MACHINES_HEALTH_PATH, async () => ({ ok: true, service: 'machines', version: opts.version ?? null, engine: db.engine, online: registry.onlineIds().size, cores: clients.size }))

  return { app, db, registry, machines: module.machines }
}

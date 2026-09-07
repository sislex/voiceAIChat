// Внутренний API машин для соседних процессов (`machines/internal.ts`): RPC над реестром, потоковый exec и
// шина событий на постоянном WebSocket. Его поднимает и отдельный процесс машин, и само ядро во встроенном
// режиме (при заданном `VC_INTERNAL_TOKEN`) — так админка и другие соседи берут машины у того процесса, где
// живёт реестр, одним и тем же клиентом `HttpMachines`. Требует зарегистрированного `@fastify/websocket`.
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import { RpcError, type RpcRequest } from '@voicechat/shared'
import { AgentFsError, type AgentRegistry } from '../agents/registry.js'
import { serveExecStream, type ExecStreamRequest } from '../internal/execStream.js'
import {
  MACHINES_INTERNAL_EVENTS_PATH, MACHINES_INTERNAL_EXEC_STREAM_PATH, MACHINES_INTERNAL_RPC_PATH, MACHINES_RPC_METHODS,
  machineStates, type MachinesClientMessage, type MachinesEvent, type MachinesRpcErrorBody, type MachinesRpcMethod, type MachinesSnapshot
} from './internal.js'

export interface MachinesInternalApiDeps {
  registry: AgentRegistry
  token: string
}

export interface MachinesInternalApi {
  /** Кадр владельцу — подключённым ядрам (в отдельном процессе машин так уходят журнал команд и watchdog). */
  publish(event: MachinesEvent): void
  /** Сколько процессов подключено к шине. */
  clients(): number
}

/** Сколько ждать ответа ядра на авторизацию подключения к тоннелю. */
const TUNNEL_AUTHORIZE_TIMEOUT_MS = 10_000

export function registerMachinesInternalApi(app: FastifyInstance, deps: MachinesInternalApiDeps): MachinesInternalApi {
  const { registry, token } = deps
  const clients = new Set<WebSocket>()
  const push = (event: MachinesEvent): void => {
    const data = JSON.stringify(event)
    for (const client of clients) if (client.readyState === client.OPEN) client.send(data)
  }
  const pendingAuthorizations = new Map<string, (ok: boolean) => void>()

  // Снимок машин — после каждого изменения реестра (телеметрия идёт часто, поэтому с небольшой задержкой).
  let machinesTimer: NodeJS.Timeout | null = null
  registry.onChange(() => {
    if (machinesTimer) return
    machinesTimer = setTimeout(() => { machinesTimer = null; push({ kind: 'machines', machines: machineStates(registry) }) }, 100)
    machinesTimer.unref?.()
  })
  registry.onPtyChange(() => push({ kind: 'ptys', ptys: registry.ptySnapshot() }))
  registry.onAgentReady(async (agentId) => push({ kind: 'agentReady', agentId }))
  registry.onCommand(async (report) => push({ kind: 'command', report }))
  app.addHook('onClose', async () => { if (machinesTimer) clearTimeout(machinesTimer); for (const client of clients) client.close() })

  const snapshot = (): MachinesSnapshot => ({ machines: machineStates(registry), ptys: registry.ptySnapshot() })
  // Авторизацию подключения к тоннелю знает тот процесс, что тоннель создал: спрашиваем всех, ждём первого «знающего».
  const authorizeViaClients = (id: string): Promise<boolean> => new Promise((resolve) => {
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
        return registry.createTunnel(id, a[1], a[2], a[3], () => authorizeViaClients(id), async () => push({ kind: 'tunnelClosed', id }))
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

  return { publish: push, clients: () => clients.size }
}

// Отдельный процесс машин (`VC_MACHINES_MODE=remote` у ядра): тот же `createMachinesModule`, что внутри
// ядра — реестр, WebSocket компаньон-агентов `/agent`, REST машин и установщики, политика команд, журнал,
// watchdog — на общей базе (только Postgres). Ядру и другим соседям он отдаёт порт `MachinesService` по
// внутреннему API (`machines/internalApi.ts`); авторизация REST — пересылкой в ядро (`/internal/whoami`).
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import type { ServerConfig } from '../../config.js'
import { VoiceChatDb } from '../../db/database.js'
import { AgentRegistry } from '../../agents/registry.js'
import { registerForwardedAuth } from '../../internal/forwardedAuth.js'
import { createMachinesModule } from '../module.js'
import { registerMachinesInternalApi } from '../internalApi.js'
import { MACHINES_HEALTH_PATH } from '../internal.js'
import type { MachinesService } from '../service.js'

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

  const registry = opts.registry ?? new AgentRegistry({ offlineGraceMs: config.agentOfflineGraceMs })
  // Кадры владельцам (журнал команд, watchdog) уходят подключённым ядрам по шине событий — регистрируем API первым.
  const api = registerMachinesInternalApi(app, { registry, token })
  const module = await createMachinesModule({ app, db, config, registry, publish: (message, userId) => api.publish({ kind: 'frame', message, userId }) })
  app.get(MACHINES_HEALTH_PATH, async () => ({ ok: true, service: 'machines', version: opts.version ?? null, engine: db.engine, online: registry.onlineIds().size, cores: api.clients() }))

  return { app, db, registry, machines: module.machines }
}

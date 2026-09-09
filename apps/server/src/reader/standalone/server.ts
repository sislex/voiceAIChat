// Отдельный процесс Web Reader (`VC_READER_MODE=remote` у ядра): тот же `createReaderModule`, что и внутри
// ядра, на той же базе (только Postgres), но состояние ядра — по HTTP (`HttpReaderCore`), авторизация —
// пересылкой в ядро (`registerForwardedAuth`: cookie превью и ключ Chromium разбирает ядро в `whoami`),
// машины — `HttpMachines` к процессу машин или к ядру. Снаружи сюда ходит только прокси ядра
// (`readerBridge/proxy.ts`) и исполнитель LLM за `/mcp/preview`.
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import type { ServerConfig } from '../../config.js'
import { VoiceChatDb } from '../../db/database.js'
import { registerForwardedAuth } from '../../internal/forwardedAuth.js'
import { HttpMachines } from '../../machinesBridge/httpMachines.js'
import type { MachinesService } from '../../machines/service.js'
import { createRemotePlaywrightReader, type PlaywrightReaderService } from '@voicechat/playwright-reader'
import type { ReaderCore } from '../core.js'
import { createReaderModule } from '../module.js'
import { READER_HEALTH_PATH } from '../internal.js'
import { HttpReaderCore } from './httpCore.js'

export interface BuildReaderServerOptions {
  /** Тот же `loadConfig(env)`, что у ядра: база, секреты, адрес Playwright Reader — из одного набора env. */
  config: ServerConfig
  /** Адрес ядра внутри сети (`VC_CORE_URL`). */
  coreUrl: string
  /** Общая база; по умолчанию — `VC_DB_URL`. В тестах — тот же экземпляр, что у ядра. */
  db?: VoiceChatDb
  /** Порт к ядру; по умолчанию HTTP. */
  core?: ReaderCore
  /** Машины; по умолчанию — `HttpMachines` к `VC_MACHINES_URL` или к ядру. */
  machines?: Pick<MachinesService, 'isOnline' | 'http'>
  browser?: PlaywrightReaderService
  fetchImpl?: typeof fetch
  logger?: boolean
  version?: string | null
}

export interface ReaderServer {
  app: FastifyInstance
  db: VoiceChatDb
  core: ReaderCore
}

export async function buildReaderServer(opts: BuildReaderServerOptions): Promise<ReaderServer> {
  const { config, coreUrl } = opts
  if (!config.internalToken) throw new Error('Web Reader отдельным процессом требует VC_INTERNAL_TOKEN (тот же, что у ядра)')
  if (!config.mcpSecret) throw new Error('Web Reader отдельным процессом требует VC_MCP_SECRET (тот же, что у ядра)')
  if (config.playwrightReaderMode === 'remote' && !config.playwrightReaderUrl) throw new Error('VC_PLAYWRIGHT_READER_MODE=remote требует VC_PLAYWRIGHT_READER_URL')
  if (!opts.db && !config.dbUrl) throw new Error('Web Reader отдельным процессом требует общую базу VC_DB_URL (Postgres)')
  const token = config.internalToken
  const fetchImpl = opts.fetchImpl ?? fetch
  const app = Fastify({ logger: opts.logger ?? false })

  const ownDb = !opts.db
  const db = opts.db ?? new VoiceChatDb(join(config.dataDir, 'voicechat.db'), { postgres: { url: config.dbUrl! } })
  await db.ready
  if (ownDb) app.addHook('onClose', async () => { await db.close() })

  registerForwardedAuth(app, { name: 'reader', coreUrl, token, fetchImpl })

  const machines = opts.machines ?? (() => {
    const http = new HttpMachines({ machinesUrl: config.machinesUrl ?? coreUrl, token, publish: () => {}, fetchImpl, log: (level, message, extra) => app.log[level](extra ?? {}, message) })
    http.start()
    app.addHook('onClose', async () => http.stop())
    return http
  })()
  const core = opts.core ?? new HttpReaderCore({ coreUrl, token, fetchImpl })
  // Встроенный Playwright Reader публикует тот же RPC у ядра: режимы двух ридеров независимы.
  const browser = opts.browser ?? createRemotePlaywrightReader({
    baseUrl: config.playwrightReaderMode === 'remote' ? config.playwrightReaderUrl! : coreUrl,
    token, fetchImpl
  })

  createReaderModule({ app, db, core, machines, mcpSecret: config.mcpSecret, browser })
  app.get(READER_HEALTH_PATH, async () => ({ ok: true, service: 'reader', version: opts.version ?? null, engine: db.engine }))
  return { app, db, core }
}

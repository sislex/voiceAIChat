// Отдельный процесс админки (`VC_ADMIN_MODE=remote` у ядра): `routes/admin.ts` на общей базе (только
// Postgres); авторизация — пересылкой в ядро; машины — портом `HttpMachines` к тому процессу, где живёт
// реестр (отдельный процесс машин или ядро во встроенном режиме — оба отдают один внутренний API); Make —
// его RPC; деплой и уведомление об отзыве сессии — RPC к ядру. Снаружи сюда ходит только прокси ядра.
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import { createRpcClient } from '@voicechat/shared'
import type { AdminDeployResponse } from '@voicechat/shared'
import type { ServerConfig } from '../../config.js'
import { VoiceChatDb } from '../../db/database.js'
import { registerForwardedAuth } from '../../internal/forwardedAuth.js'
import { HttpMachines } from '../../machinesBridge/httpMachines.js'
import type { MachinesService } from '../../machines/service.js'
import { createRemoteMake } from '../../makeBridge/remote.js'
import { registerAdminRoutes } from '../../routes/admin.js'
import { createMailer, type Mailer } from '../../users/mailer.js'
import { ADMIN_HEALTH_PATH, INTERNAL_ADMIN_RPC_PATH } from '../internal.js'

export interface BuildAdminServerOptions {
  config: ServerConfig
  coreUrl: string
  db?: VoiceChatDb
  /** Порт машин; по умолчанию — `HttpMachines` к `VC_MACHINES_URL` или к ядру. */
  machines?: MachinesService
  mailer?: Mailer
  fetchImpl?: typeof fetch
  logger?: boolean
  version?: string | null
}

export interface AdminServer { app: FastifyInstance; db: VoiceChatDb; machines: MachinesService }

export async function buildAdminServer(opts: BuildAdminServerOptions): Promise<AdminServer> {
  const { config, coreUrl } = opts
  if (!config.internalToken) throw new Error('Админка отдельным процессом требует VC_INTERNAL_TOKEN (тот же, что у ядра)')
  if (!config.mcpSecret) throw new Error('Админка отдельным процессом требует VC_MCP_SECRET (тот же, что у ядра)')
  if (!opts.db && !config.dbUrl) throw new Error('Админка отдельным процессом требует общую базу VC_DB_URL (Postgres)')
  const token = config.internalToken
  const fetchImpl = opts.fetchImpl ?? fetch
  const app = Fastify({ logger: opts.logger ?? false })
  const warn = (extra: Record<string, unknown>, message: string): void => { app.log.warn(extra, message) }

  const ownDb = !opts.db
  const db = opts.db ?? new VoiceChatDb(join(config.dataDir, 'voicechat.db'), { postgres: { url: config.dbUrl! } })
  await db.ready
  if (ownDb) app.addHook('onClose', async () => { await db.close() })

  registerForwardedAuth(app, { name: 'admin', coreUrl, token, fetchImpl })

  const machines = opts.machines ?? (() => {
    const http = new HttpMachines({ machinesUrl: config.machinesUrl ?? coreUrl, token, publish: () => {}, fetchImpl, log: (level, message, extra) => app.log[level](extra ?? {}, message) })
    http.start()
    app.addHook('onClose', async () => http.stop())
    return http
  })()
  const make = createRemoteMake({ makeUrl: (config.makeUrl ?? coreUrl).replace(/\/+$/, ''), token, mcpSecret: config.mcpSecret, fetchImpl })
  const mailer = opts.mailer ?? createMailer({ smtpUrl: config.smtpUrl, mailFrom: config.mailFrom }, (m, extra) => warn(extra ?? {}, m))
  const core = createRpcClient({ baseUrl: coreUrl, token, path: INTERNAL_ADMIN_RPC_PATH, fetchImpl, timeoutMs: 30_000 })
  const deployTrigger = { trigger: () => core<AdminDeployResponse>('deploy') }
  const sessionHub = { emit: (user: string, revokedSid?: string) => { void core('sessionsChanged', user, revokedSid).catch((error) => warn({ err: error }, '[admin] ядро не уведомлено об отзыве сессии')) } }

  registerAdminRoutes(app, db, machines, deployTrigger, make.service, mailer, config.publicUrl, sessionHub)
  app.get(ADMIN_HEALTH_PATH, async () => ({ ok: true, service: 'admin', version: opts.version ?? null, engine: db.engine }))
  return { app, db, machines }
}

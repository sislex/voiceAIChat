// Сборка модуля машин: реестр онлайн-подключений, WebSocket компаньон-агентов `/agent`, REST машин и
// установщиков, политика команд, каталог ChatAI по умолчанию, журнал команд, watchdog и перенос
// хранилищ (docs/plans/machines-service.md, круг 1). Раньше всё это лежало в `buildServer`; теперь
// зависимости от ядра перечислены явно в `MachinesDeps`, а наружу модуль отдаёт порт `MachinesService`
// — единственное, что видят потребители (сессия, ходы, MCP, канбан, Make, админка).
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { MachineCommandEvent, ServerMessage } from '@voicechat/shared'
import type { ServerConfig } from '../config.js'
import type { VoiceChatDb } from '../db/database.js'
import { AgentRegistry } from '../agents/registry.js'
import { attachAgentWs } from '../agents/wsAgent.js'
import { createCommandGate, type CommandGate } from '../agents/commandGate.js'
import { ensureDefaultStorage } from '../agents/defaultStorage.js'
import { createAgentWatchdog } from '../agents/watchdog.js'
import { registerAgentRoutes } from '../routes/agents.js'
import { StorageMigrationManager } from '../storageMigration/manager.js'
import { registerStorageMigrationRoutes } from '../storageMigration/routes.js'
import type { MachinesService } from './service.js'

export interface MachinesDeps {
  app: FastifyInstance
  db: VoiceChatDb
  config: Pick<ServerConfig, 'agentOfflineGraceMs' | 'agentOfflineAlertMs' | 'longCommandMs' | 'dataDir' | 'agentAppPath' | 'desktopAppPath' | 'loginApplicationPath'>
  /** Кадры владельцу машины (журнал команд, тревоги watchdog) — шина кадров ядра. */
  publish: (message: ServerMessage, userId: string) => void
  /**
   * Куда положить полный лог долгой команды из чата: каталог artifacts привязанного хранилища разговора.
   * Знание о хранилищах чата — у ядра; null — лог не сохраняем, только тост.
   */
  chatArtifacts?: (userId: string, conversationId: string) => Promise<{ machineId: string; artifacts: string } | null>
  /** Готовый реестр (тесты) вместо нового. */
  registry?: AgentRegistry
}

export interface MachinesModule {
  machines: MachinesService
  commandGate: CommandGate
}

export async function createMachinesModule(deps: MachinesDeps): Promise<MachinesModule> {
  const { app, db, config, publish } = deps
  const registry = deps.registry ?? new AgentRegistry({ offlineGraceMs: config.agentOfflineGraceMs })
  const log = (m: string, extra?: Record<string, unknown>): void => app.log.info(extra ?? {}, m)

  // Гейт команд (п.10): политика проекта и роли поверх политики машины; опасные команды в чате — с подтверждением.
  const commandGate = createCommandGate({
    projectPolicy: async (projectId) => await db.projects.getProjectCommandPolicy(projectId),
    rolePolicies: async () => await db.machines.getRoleCommandPolicies(),
    userRole: async (userId) => (await db.identity.getUser(userId))?.role ?? null
  })
  await registerAgentRoutes(app, db, registry, {
    agentApp: config.agentAppPath,
    desktopApp: config.desktopAppPath,
    loginApplication: config.loginApplicationPath
  }, commandGate)
  const storageMigrations = new StorageMigrationManager(join(config.dataDir, 'storage-migrations.json'), {
    list: (machineId, path) => registry.fsList(machineId, path),
    read: (machineId, path) => registry.fsRead(machineId, path),
    write: (machineId, path, dataBase64) => registry.fsWrite(machineId, path, dataBase64),
    mkdir: (machineId, path) => registry.fsMkdir(machineId, path),
    rename: (machineId, from, to) => registry.fsRename(machineId, from, to),
    deleteFile: (machineId, path) => registry.fsDeleteFileSafe(machineId, path)
  })
  registerStorageMigrationRoutes(app, db, registry, storageMigrations)

  // Журнал команд машины: пишем всё, что прошло через registry.exec (консоль, чат, системные вызовы).
  registry.onCommand(async (rec) => {
    const { output, ...record } = rec
    const userId = record.userId || (await db.machines.agentOwnerId(record.machineId) ?? '')
    try { await db.machines.addMachineCommand({ ...record, userId }) } catch (error) { app.log.warn({ error }, 'machine command log failed') }
    // Долгая команда (п.17): тост владельцу; для команды из чата — полный лог в artifacts/commands чата.
    if (!userId || record.source === 'system' || record.durationMs < config.longCommandMs) return
    void (async () => {
      let logPath: string | undefined
      if (record.source === 'chat' && record.conversationId && deps.chatArtifacts) {
        try {
          const managed = await deps.chatArtifacts(userId, record.conversationId)
          if (managed) {
            const separator = managed.artifacts.includes('\\') && !managed.artifacts.includes('/') ? '\\' : '/'
            const dir = `${managed.artifacts}${separator}commands`
            await registry.fsMkdir(managed.machineId, dir)
            const stamp = new Date(record.startedAt).toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
            const slug = record.command.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'command'
            logPath = `${dir}${separator}${stamp}__${slug}.log`
            const header = `$ ${record.command}\n# exit ${record.exitCode ?? 'null'} · ${record.durationMs} ms · ${new Date(record.startedAt).toISOString()}\n\n`
            await registry.fsWrite(managed.machineId, logPath, Buffer.from(header + output).toString('base64'))
          }
        } catch (error) {
          app.log.warn({ error }, 'command log save failed')
          logPath = undefined
        }
      }
      const event: MachineCommandEvent = {
        machineId: record.machineId, machineName: registry.nameOf(record.machineId) ?? (await db.machines.listAgents(userId)).find((a) => a.id === record.machineId)?.name ?? record.machineId,
        source: record.source, command: record.command, exitCode: record.exitCode, timedOut: record.timedOut, error: record.error,
        durationMs: record.durationMs, conversationId: record.conversationId, ...(logPath ? { logPath } : {})
      }
      publish({ t: 'machine.command', event }, userId)
    })()
  })
  // Каталог ChatAI по умолчанию — при первой телеметрии подключившейся машины (тогда известен homePath).
  registry.onAgentReady(async (agentId) => {
    const owner = await db.machines.agentOwnerId(agentId)
    if (owner) void await ensureDefaultStorage({ db, registry, log }, owner, agentId)
  })
  // Watchdog агентов (п.1): раз в минуту ищем машины, пропавшие дольше порога.
  const agentWatchdog = createAgentWatchdog({ db, registry, publish, thresholdMs: config.agentOfflineAlertMs })
  const watchdogTimer = config.agentOfflineAlertMs > 0 ? setInterval(async () => { try { await agentWatchdog.tick() } catch (error) { app.log.warn({ error }, 'agent watchdog tick failed') } }, 60_000) : null
  watchdogTimer?.unref?.()
  app.addHook('onClose', async () => { if (watchdogTimer) clearInterval(watchdogTimer); agentWatchdog.stop() })
  // WebSocket компаньон-агента: первое сообщение — agent.register {token}, дальше exec/fs/pty через реестр.
  await app.register(async (scoped) => {
    scoped.get('/agent', { websocket: true }, (socket, request) => {
      const fwd = String(request.headers['x-forwarded-for'] ?? '').split(',')[0]!.trim()
      attachAgentWs(socket, db, registry, { ip: fwd || request.socket.remoteAddress || '' })
    })
  })

  return { machines: registry, commandGate }
}

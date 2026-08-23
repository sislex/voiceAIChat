import type { FastifyInstance } from 'fastify'
import { isMachineStoragePathAllowed, normalizeMachineStoragePath, type MigrationAssignment } from '@voicechat/shared'
import type { AgentRegistry } from '../agents/registry.js'
import type { VoiceChatDb } from '../db/database.js'
import { uid } from '../users/auth.js'
import type { StorageMigrationManager } from './manager.js'

interface CreateBody { machineId?: string; storageId?: string; sources?: Array<{ path?: string; assignment?: MigrationAssignment }> }

export function registerStorageMigrationRoutes(app: FastifyInstance, db: VoiceChatDb, agents: AgentRegistry, manager: StorageMigrationManager): void {
  const ownerContext = async (userId: string, machineId: string, storageId: string) => {
    if (!db.listAgents(userId).some((agent) => agent.id === machineId)) throw new Error('Machine not found')
    if (!agents.isOnline(machineId)) throw new Error('Machine offline')
    const storage = db.listMachineStorages(userId, machineId).find((candidate) => candidate.id === storageId)
    if (!storage) throw new Error('MachineStorage not found')
    const platform = agents.platformOf(machineId) ?? 'linux'
    const allowedDirs = agents.policyOf(machineId)?.allowedDirs ?? []
    if (!isMachineStoragePathAllowed(storage.rootPath, allowedDirs, platform)) throw new Error('MachineStorage outside allowedDirs')
    const separator = platform === 'win32' ? '\\' : '/'
    const markerResult = await agents.fsRead(machineId, storage.rootPath + separator + '.voicechat' + separator + 'storage.json')
    const marker = JSON.parse(Buffer.from(markerResult.dataBase64 ?? '', 'base64').toString('utf8')) as { id?: unknown; formatVersion?: unknown }
    if (marker.id !== storage.id || marker.formatVersion !== storage.formatVersion) throw new Error('MachineStorage marker mismatch')
    return { storage, platform, allowedDirs }
  }
  app.post<{ Body: CreateBody }>('/api/storage-migrations', async (req, reply) => {
    const actor = uid(req)
    const machineId = req.body?.machineId ?? ''
    const storageId = req.body?.storageId ?? ''
    try {
      const context = await ownerContext(actor, machineId, storageId)
      const sources = (req.body?.sources ?? []).map((source) => {
        if (!source.path || !source.assignment) throw new Error('Every source requires path and assignment')
        const path = normalizeMachineStoragePath(source.path, context.platform)
        if (!isMachineStoragePathAllowed(path, context.allowedDirs, context.platform)) throw new Error('Source outside allowedDirs')
        return { path, assignment: source.assignment }
      })
      return await manager.createDryRun({ actor, machineId, storageId, storageRoot: context.storage.rootPath, platform: context.platform, sources })
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) }) }
  })
  app.get<{ Params: { id: string } }>('/api/storage-migrations/:id', async (req, reply) => manager.get(uid(req), req.params.id) ?? reply.code(404).send({ error: 'not found' }))
  app.get<{ Params: { id: string } }>('/api/storage-migrations/:id/audit', async (req, reply) => {
    const actor = uid(req); if (!manager.get(actor, req.params.id)) return reply.code(404).send({ error: 'not found' })
    return manager.auditLog(actor, req.params.id)
  })
  app.post<{ Params: { id: string }; Body: { confirm?: boolean } }>('/api/storage-migrations/:id/copy', async (req, reply) => {
    if (req.body?.confirm !== true) return reply.code(400).send({ error: 'Explicit copy confirmation required' })
    const actor = uid(req); const plan = manager.get(actor, req.params.id); if (!plan) return reply.code(404).send({ error: 'not found' })
    try { await ownerContext(actor, plan.machineId, plan.storageId); return await manager.copy(actor, plan.id) } catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) }) }
  })
  app.post<{ Params: { id: string }; Body: { confirm?: boolean } }>('/api/storage-migrations/:id/delete-sources', async (req, reply) => {
    if (req.body?.confirm !== true) return reply.code(400).send({ error: 'Explicit deletion confirmation required' })
    const actor = uid(req); const plan = manager.get(actor, req.params.id); if (!plan) return reply.code(404).send({ error: 'not found' })
    try { await ownerContext(actor, plan.machineId, plan.storageId); return await manager.deleteVerified(actor, plan.id) } catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) }) }
  })
}

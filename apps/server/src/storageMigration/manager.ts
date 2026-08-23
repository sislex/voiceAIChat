import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { FsEntry, MigrationAssignment, MigrationAuditEvent, MigrationItem, MigrationPathMapping, MigrationPlan } from '@voicechat/shared'
import { STORAGE_MIGRATION_CHECKSUM_ALGORITHM, STORAGE_MIGRATION_SCHEMA_VERSION, isMigrationPathInside, migrationDestinationRelativePath, migrationPathKey } from '@voicechat/shared'

export interface MigrationSource {
  path: string
  assignment: MigrationAssignment
}

export interface StorageMigrationDeps {
  list(machineId: string, path: string): Promise<{ entries?: FsEntry[] }>
  read(machineId: string, path: string): Promise<{ dataBase64?: string }>
  write(machineId: string, path: string, dataBase64: string): Promise<unknown>
  mkdir(machineId: string, path: string): Promise<unknown>
  rename(machineId: string, from: string, to: string): Promise<unknown>
  deleteFile(machineId: string, path: string): Promise<unknown>
}

interface State { plans: MigrationPlan[]; audit: MigrationAuditEvent[]; mappings: MigrationPathMapping[] }
const emptyState = (): State => ({ plans: [], audit: [], mappings: [] })
const checksum = (data: Buffer): string => createHash(STORAGE_MIGRATION_CHECKSUM_ALGORITHM).update(data).digest('hex')
const missing = (error: unknown): boolean => /ENOENT|not found|no such|не найден/i.test(error instanceof Error ? error.message : String(error))

export class StorageMigrationManager {
  private state: State
  constructor(private readonly storePath: string, private readonly fs: StorageMigrationDeps) {
    try { this.state = JSON.parse(readFileSync(storePath, 'utf8')) as State } catch { this.state = emptyState() }
  }
  private persist(): void {
    const temp = this.storePath + '.tmp'
    writeFileSync(temp, JSON.stringify(this.state, null, 2))
    renameSync(temp, this.storePath)
  }
  private audit(plan: MigrationPlan, actor: string, action: MigrationAuditEvent['action'], outcome: MigrationAuditEvent['outcome'], itemId?: string, detail?: string): void {
    this.state.audit.push({ id: randomUUID(), planId: plan.id, actor, action, outcome, at: Date.now(), ...(itemId ? { itemId } : {}), ...(detail ? { detail } : {}) })
  }
  private join(root: string, relative: string, platform: string): string {
    const separator = platform === 'win32' ? '\\' : '/'
    return root.replace(/[/\\]+$/, '') + separator + relative.replace(/[/\\]/g, separator)
  }
  private async read(machineId: string, path: string): Promise<Buffer> {
    const result = await this.fs.read(machineId, path)
    return Buffer.from(result.dataBase64 ?? '', 'base64')
  }
  async createDryRun(args: { actor: string; machineId: string; storageId: string; storageRoot: string; platform: string; sources: MigrationSource[] }): Promise<MigrationPlan> {
    const items: MigrationItem[] = []
    const destinations = new Map<string, string>()
    for (const source of args.sources) {
      const name = source.path.replace(/\\/g, '/').split('/').pop() ?? ''
      let destination: string | null = null
      let conflict: MigrationItem['conflict'] = null
      try {
        if (source.assignment.kind !== 'undefined') destination = this.join(args.storageRoot, migrationDestinationRelativePath(source.assignment, name), args.platform)
        if (destination && !isMigrationPathInside(destination, args.storageRoot, args.platform)) throw new Error('Destination escapes MachineStorage')
      } catch (error) {
        conflict = { kind: 'unsafe-path', message: error instanceof Error ? error.message : String(error) }
      }
      const data = await this.read(args.machineId, source.path)
      const listed = await this.fs.list(args.machineId, source.path.replace(/[\\/][^\\/]+$/, ''))
      const entry = listed.entries?.find((candidate) => candidate.name === name)
      const item: MigrationItem = { id: randomUUID(), source: source.path, destination, assignment: source.assignment, size: data.byteLength, mtime: entry?.mtime ?? 0, checksum: checksum(data), conflict, status: source.assignment.kind === 'undefined' ? 'undefined' : conflict ? 'conflict' : 'planned' }
      if (destination && !conflict) {
        const key = migrationPathKey(destination, args.platform)
        const overlap = destinations.get(key)
        if (overlap) { item.conflict = { kind: 'overlapping-destination', itemId: overlap }; item.status = 'conflict' }
        else destinations.set(key, item.id)
        try {
          const target = await this.read(args.machineId, destination)
          item.conflict = { kind: 'destination-exists', destinationSize: target.byteLength, destinationChecksum: checksum(target) }
          item.status = target.byteLength === item.size && checksum(target) === item.checksum ? 'planned' : 'conflict'
        } catch (error) { if (!missing(error)) throw error }
      }
      items.push(item)
    }
    const plan: MigrationPlan = { schemaVersion: STORAGE_MIGRATION_SCHEMA_VERSION, id: randomUUID(), userId: args.actor, machineId: args.machineId, storageId: args.storageId, platform: args.platform, status: 'dry-run-ready', createdAt: Date.now(), totalBytes: items.reduce((sum, item) => sum + item.size, 0), items }
    this.state.plans.push(plan); this.audit(plan, args.actor, 'dry-run', 'success', undefined, `${items.length} items, ${plan.totalBytes} bytes`); this.persist()
    return structuredClone(plan)
  }
  get(actor: string, planId: string): MigrationPlan | null {
    const plan = this.state.plans.find((candidate) => candidate.id === planId && candidate.userId === actor)
    return plan ? structuredClone(plan) : null
  }
  auditLog(actor: string, planId: string): MigrationAuditEvent[] {
    if (!this.get(actor, planId)) return []
    return structuredClone(this.state.audit.filter((event) => event.planId === planId))
  }
  mappings(actor: string, machineId: string): MigrationPathMapping[] {
    return structuredClone(this.state.mappings.filter((mapping) => mapping.userId === actor && mapping.machineId === machineId))
  }
  async copy(actor: string, planId: string): Promise<MigrationPlan> {
    const plan = this.state.plans.find((candidate) => candidate.id === planId && candidate.userId === actor)
    if (!plan) throw new Error('Migration plan not found')
    if (plan.status !== 'dry-run-ready' && plan.status !== 'copy-interrupted') throw new Error('Migration plan cannot be copied')
    plan.copyConfirmedAt ??= Date.now(); this.audit(plan, actor, plan.status === 'copy-interrupted' ? 'resumed' : 'copy-confirmed', 'success'); plan.status = 'copying'; this.persist()
    try {
      for (const item of plan.items) {
        if (!item.destination || item.status === 'undefined' || item.status === 'conflict' || item.status === 'deleted') continue
        const source = await this.read(plan.machineId, item.source)
        if (source.byteLength !== item.size || checksum(source) !== item.checksum) { item.status = 'source-changed'; this.audit(plan, actor, 'copy-skipped', 'blocked', item.id, 'source changed after dry-run'); continue }
        let target: Buffer | null = null
        try { target = await this.read(plan.machineId, item.destination) } catch (error) { if (!missing(error)) throw error }
        if (!target || target.byteLength !== item.size || checksum(target) !== item.checksum) {
          if (target) { item.status = 'conflict'; item.conflict = { kind: 'destination-exists', destinationSize: target.byteLength, destinationChecksum: checksum(target) }; this.audit(plan, actor, 'copy-skipped', 'blocked', item.id, 'destination conflict'); continue }
          item.status = 'copying'; this.persist()
          const parent = item.destination.replace(/[\\/][^\\/]+$/, '')
          await this.fs.mkdir(plan.machineId, parent)
          const temporary = item.destination + '.migration-' + item.id + '.partial'
          await this.fs.write(plan.machineId, temporary, source.toString('base64'))
          await this.fs.rename(plan.machineId, temporary, item.destination)
          target = await this.read(plan.machineId, item.destination)
        }
        const destinationChecksum = checksum(target)
        item.verification = { algorithm: STORAGE_MIGRATION_CHECKSUM_ALGORITHM, sourceSize: item.size, destinationSize: target.byteLength, sourceChecksum: item.checksum, destinationChecksum, verified: target.byteLength === item.size && destinationChecksum === item.checksum, verifiedAt: Date.now() }
        item.status = item.verification.verified ? 'verified' : 'failed'
        if (item.status === 'verified' && !this.state.mappings.some((mapping) => mapping.userId === actor && mapping.machineId === plan.machineId && mapping.legacyPath === item.source)) this.state.mappings.push({ userId: actor, machineId: plan.machineId, legacyPath: item.source, managedPath: item.destination, planId: plan.id, itemId: item.id, createdAt: Date.now() })
        this.audit(plan, actor, item.status === 'verified' ? 'copy-verified' : 'copy-failed', item.status === 'verified' ? 'success' : 'failed', item.id); this.persist()
      }
      plan.status = 'copy-complete'
    } catch (error) { plan.status = 'copy-interrupted'; this.audit(plan, actor, 'copy-failed', 'failed', undefined, error instanceof Error ? error.message : String(error)); this.persist(); throw error }
    this.persist(); return structuredClone(plan)
  }
  async deleteVerified(actor: string, planId: string): Promise<MigrationPlan> {
    const plan = this.state.plans.find((candidate) => candidate.id === planId && candidate.userId === actor)
    if (!plan || (plan.status !== 'copy-complete' && plan.status !== 'complete')) throw new Error('Verified copy required before deletion')
    plan.deleteConfirmedAt = Date.now(); plan.status = 'deleting'; this.audit(plan, actor, 'delete-confirmed', 'success'); this.persist()
    for (const item of plan.items) {
      if (item.status !== 'verified') continue
      const source = await this.read(plan.machineId, item.source)
      if (source.byteLength !== item.size || checksum(source) !== item.checksum) { this.audit(plan, actor, 'delete-skipped', 'blocked', item.id, 'source changed'); continue }
      await this.fs.deleteFile(plan.machineId, item.source); item.status = 'deleted'; this.audit(plan, actor, 'source-deleted', 'success', item.id); this.persist()
    }
    plan.status = 'complete'; this.persist(); return structuredClone(plan)
  }
}

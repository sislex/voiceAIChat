import { ACTIVE_ENVIRONMENT_OPERATION_STATUSES } from '@voicechat/shared'
import type { Sql } from '@sislexa/identity/storage-sql/types'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VoiceChatDb } from './database.js'
import { PG_SCHEMA, postgresColumnUpgradePlan } from './schemaPg.js'

const modules = [{ repository: 'https://github.com/sislex/core', version: '1.2.3', commit: 'a'.repeat(40) }]
const input = { id: 'production', name: 'Production', machines: ['agent'], checkoutPath: '/srv/compose' }

// The same behavioral suite runs against real adapters, never a simulated SQL store.
for (const engine of ['sqlite', 'postgres'] as const) {
  describe.skipIf(engine === 'postgres' && !process.env.VC_TEST_DB_URL)(`environments (${engine})`, () => {
    let db: VoiceChatDb
    let peer: VoiceChatDb | undefined
    let dir: string
    let projectId: string
    let otherProjectId: string
    let schema: string
    beforeEach(async () => {
      dir = mkdtempSync(join(process.env.DELIVERY_ATTEMPT_ROOT ? join(process.env.DELIVERY_ATTEMPT_ROOT, 'tmp') : process.cwd(), 'environments-'))
      schema = `env_${randomUUID().replace(/-/g, '')}`
      db = new VoiceChatDb(join(dir, 'db.sqlite'), engine === 'postgres' ? { postgres: { url: process.env.VC_TEST_DB_URL!, schema, dropSchemaOnClose: true } } : {})
      await db.ready
      for (const user of ['owner', 'member', 'outsider']) await db.identity.createUser(user, 'pw', 'developer')
      projectId = (await db.projects.createProject('owner', { name: 'Project' })).id
      otherProjectId = (await db.projects.createProject('owner', { name: 'Other' })).id
      await db.projects.addMember('owner', projectId, 'member')
      await db.environments.upsertEnvironment('owner', projectId, input)
    })
    afterEach(async () => {
      await peer?.close(); peer = undefined
      await db?.close()
      if (dir) rmSync(dir, { recursive: true, force: true })
    })
    it('resolves link owners through the project creator and returns null for missing projects', async () => {
      const other = await db.projects.createProject('member', { name: 'Member project' })
      expect(await db.environments.linkOwner(projectId)).toBe('owner')
      expect(await db.environments.linkOwner(other.id)).toBe('member')
      expect(await db.environments.linkOwner('missing')).toBeNull()
    })
    it('persists environment-owned links, scopes deletion, reserves listener ports and revokes authorization', async () => {
      const request = { projectId, environmentId: input.id, clientMachineId: 'client', serverMachineId: 'server', servicePort: 5432, listenerPort: 17001 }
      const link = await db.environments.ensureLink(request)
      expect(await db.environments.ensureLink(request)).toEqual(link)
      expect(await db.environments.authorizeLink(link.id)).toBe(true)
      await expect(db.environments.ensureLink({ ...request, listenerPort: 17002 })).rejects.toThrow('cannot change')
      await expect(db.environments.ensureLink({ ...request, servicePort: 5433 })).rejects.toThrow()
      await expect(db.environments.ensureLink({ ...request, listenerPort: -1 })).rejects.toThrow()
      await db.environments.deleteLink(otherProjectId, input.id, link.id)
      expect(await db.environments.listLinks(projectId, input.id)).toEqual([link])
      await db.environments.setEnvironmentState(projectId, input.id, { state: 'provisioning' })
      expect(await db.environments.authorizeLink(link.id)).toBe(true)
      await db.environments.setEnvironmentState(projectId, input.id, { state: 'removed' })
      expect(await db.environments.authorizeLink(link.id)).toBe(false)
      await expect(db.environments.ensureLink(request)).rejects.toThrow('not active')
      const sql = (db as unknown as { sql: Sql }).sql
      await sql.run('DELETE FROM environments WHERE project_id = ? AND id = ?', [projectId, input.id])
      expect(await db.environments.listLinks(projectId, input.id)).toEqual([])
      expect(await db.environments.authorizeLink(link.id)).toBe(false)
    })
    it('scopes definitions by project and preserves creation metadata on update', async () => {
      const before = await db.environments.getEnvironment('member', projectId, input.id)
      expect(before).toMatchObject({ ...input, projectId, createdBy: 'owner' })
      const updated = await db.environments.upsertEnvironment('owner', projectId, { ...input, name: 'Renamed' })
      expect(updated.createdAt).toBe(before!.createdAt)
      expect(updated.name).toBe('Renamed')
      expect(await db.environments.getEnvironment('owner', otherProjectId, input.id)).toBeNull()
      await db.environments.upsertEnvironment('owner', otherProjectId, input)
      expect(await db.environments.listEnvironments('member', projectId)).toHaveLength(1)
      await expect(db.environments.upsertEnvironment('member', projectId, input)).rejects.toThrow('owner')
      await expect(db.environments.upsertEnvironment('owner', projectId, { ...input, machines: [] })).rejects.toThrow()
    })
    it('denies every user-facing repository method to non-members', async () => {
      const config = await db.environments.addConfiguration('owner', projectId, input.id, modules, null)
      for (const call of [
        () => db.environments.listEnvironments('outsider', projectId),
        () => db.environments.getEnvironment('outsider', projectId, input.id),
        () => db.environments.upsertEnvironment('outsider', projectId, input),
        () => db.environments.addConfiguration('outsider', projectId, input.id, modules, null),
        () => db.environments.listConfigurations('outsider', projectId, input.id),
        () => db.environments.getConfiguration('outsider', projectId, config.id),
        () => db.environments.createOperation('outsider', projectId, input.id, config.id, null),
        () => db.environments.listOperations('outsider', projectId, input.id)
      ]) await expect(call()).rejects.toThrow('membership')
    })
    it('allocates immutable consecutive revisions and validates writes', async () => {
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => db.environments.addConfiguration('member', projectId, input.id, modules, `note ${i}`)))
      expect(results.map(r => r.revision).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
      expect((await db.environments.listConfigurations('owner', projectId, input.id, 2)).map(r => r.revision)).toEqual([8, 7])
      expect(await db.environments.getConfiguration('owner', projectId, results[0]!.id)).toEqual(results[0])
      expect(await db.environments.getConfiguration('owner', otherProjectId, results[0]!.id)).toBeNull()
      await expect(db.environments.addConfiguration('owner', projectId, 'missing', modules, null)).rejects.toThrow()
      await expect(db.environments.addConfiguration('owner', projectId, input.id, [...modules, ...modules], null)).rejects.toThrow()
      expect((await db.environments.addConfiguration('owner', projectId, input.id, [], null)).revision).toBe(9)
    })
    it('allows one active operation and rejects cross-environment configurations', async () => {
      const config = await db.environments.addConfiguration('owner', projectId, input.id, modules, null)
      await db.environments.upsertEnvironment('owner', projectId, { ...input, id: 'staging' })
      const foreign = await db.environments.addConfiguration('owner', projectId, 'staging', modules, null)
      await expect(db.environments.createOperation('owner', projectId, input.id, foreign.id, null)).rejects.toThrow()
      await expect(db.environments.createOperation('owner', projectId, input.id, config.id, foreign.id)).rejects.toThrow()
      await expect(db.environments.createOperation('owner', otherProjectId, input.id, config.id, null)).rejects.toThrow()
      const attempts = await Promise.allSettled(Array.from({ length: 3 }, () => db.environments.createOperation('member', projectId, input.id, config.id, null)))
      expect(attempts.filter(a => a.status === 'fulfilled')).toHaveLength(1)
      const current = (await db.environments.activeOperation(projectId, input.id))!
      expect(current).toMatchObject({ status: 'pending', steps: [], error: null, finishedAt: null })
      const steps = [{ service: 'core', from: null, to: 'image', status: 'passed' as const, log: 'ready' }]
      await db.environments.updateOperation(current.id, { status: 'succeeded', steps, finishedAt: 123, error: null })
      expect(await db.environments.activeOperation(projectId, input.id)).toBeNull()
      expect((await db.environments.listOperations('owner', projectId, input.id))[0]).toMatchObject({ steps, finishedAt: 123 })
      const next = await db.environments.createOperation('owner', projectId, input.id, config.id, config.id)
      await db.environments.updateOperation(next.id, { status: 'rolled_back', error: 'health check failed' })
      expect(await db.environments.activeOperation(projectId, input.id)).toBeNull()
    })

    const managed = { id: 'stand', name: 'Stand', machineId: 'agent', storageId: 'storage', checkoutPath: '/srv/stand', composeProject: 'stand-project' }
    it('creates managed stands, reserves compose projects and permits only draft/removed reuse', async () => {
      await expect(db.environments.createManagedEnvironment('member', projectId, managed)).rejects.toThrow('owner')
      await expect(db.environments.createManagedEnvironment('outsider', projectId, managed)).rejects.toThrow('membership')
      await expect(db.environments.createManagedEnvironment('owner', projectId, { ...managed, id: 'production' })).rejects.toThrow()
      await db.environments.upsertEnvironment('owner', projectId, { ...input, id: 'external' })
      await expect(db.environments.createManagedEnvironment('owner', projectId, { ...managed, id: 'external' })).rejects.toThrow('Environment already exists')
      const first = await db.environments.createManagedEnvironment('owner', projectId, managed)
      expect(first).toMatchObject({ mode: 'managed', state: 'draft', machines: ['agent'], storageId: 'storage', composeProject: managed.composeProject, port: null })
      await expect(db.environments.upsertEnvironment('owner', projectId, { ...input, id: managed.id })).rejects.toThrow('Managed environment cannot be changed')
      await expect(db.environments.createManagedEnvironment('owner', otherProjectId, managed)).rejects.toThrow()
      const updated = await db.environments.createManagedEnvironment('owner', projectId, { ...managed, name: 'Renamed' })
      expect(updated).toMatchObject({ createdAt: first.createdAt, name: 'Renamed' })
      await db.environments.setEnvironmentState(projectId, managed.id, { state: 'ready', port: 17801 })
      await expect(db.environments.createManagedEnvironment('owner', projectId, managed)).rejects.toThrow('Environment already exists')
      await db.environments.createManagedEnvironment('owner', otherProjectId, { ...managed, composeProject: 'second-project' })
      await db.environments.setEnvironmentState(otherProjectId, managed.id, { port: 17802 })
      expect(await db.environments.managedPorts('agent')).toEqual([17801, 17802])
      expect(await db.environments.managedPorts('other-agent')).toEqual([])
      await db.environments.setEnvironmentState(projectId, managed.id, { state: 'removed' })
      expect(await db.environments.managedPorts('agent')).toEqual([17802])
      expect(await db.environments.createManagedEnvironment('owner', projectId, managed)).toMatchObject({ state: 'draft', port: null, createdAt: first.createdAt })
    })
    it('persists validated core selections without changing old configuration defaults', async () => {
      const core = { version: '1.2.3', commit: 'b'.repeat(40) }
      const config = await db.environments.addConfiguration('owner', projectId, input.id, modules, null, core)
      expect((await db.environments.getConfiguration('member', projectId, config.id))?.core).toEqual(core)
      expect((await db.environments.listConfigurations('owner', projectId, input.id))[0]?.core).toEqual(core)
      expect((await db.environments.addConfiguration('owner', projectId, input.id, [], null)).core).toBeNull()
      await expect(db.environments.addConfiguration('owner', projectId, input.id, [], null, { ...core, commit: 'bad' })).rejects.toThrow('Invalid commit')
    })
    it('stores settings atomically, checks ownership and isolates projects', async () => {
      const fixtureValue1 = randomUUID()
      const fixtureValue2 = randomUUID()
      const fixtureValue3 = randomUUID()
      const entry = { key: 'VC_ADMIN_PASSWORD', secret: true, value: fixtureValue1, source: 'generated' as const }
      await expect(db.environments.saveSettings('member', projectId, input.id, [entry])).rejects.toThrow('owner')
      await expect(db.environments.listSettings('outsider', projectId, input.id)).rejects.toThrow('membership')
      await expect(db.environments.saveSettings('owner', projectId, 'missing', [entry])).rejects.toThrow('Environment not found')
      await db.environments.saveSettings('owner', projectId, input.id, [entry])
      expect(await db.environments.listSettings('member', projectId, input.id)).toEqual([{ ...entry, updatedBy: 'owner', updatedAt: expect.any(Number) }])
      expect(await db.environments.readSettings(otherProjectId, input.id)).toEqual([])
      await expect(db.environments.saveSettings('owner', projectId, input.id, [{ ...entry, value: fixtureValue2 }, { ...entry, key: 'bad' }])).rejects.toThrow()
      expect((await db.environments.readSettings(projectId, input.id))[0]?.value).toBe(entry.value)
      await db.environments.saveSettings('owner', projectId, input.id, [{ ...entry, secret: false, value: fixtureValue3, source: 'user' }])
      expect((await db.environments.readSettings(projectId, input.id))[0]).toMatchObject({ value: fixtureValue3, secret: false, source: 'user' })
      await db.environments.saveSettings('owner', projectId, input.id, [{ ...entry, value: null }])
      expect(await db.environments.readSettings(projectId, input.id)).toEqual([])
    })
    it('keeps all active statuses exclusive and blocks settings until a terminal status', async () => {
      const config = await db.environments.addConfiguration('owner', projectId, input.id, [], null)
      const operation = await db.environments.createOperation('owner', projectId, input.id, config.id, null, 'provision')
      for (const status of ACTIVE_ENVIRONMENT_OPERATION_STATUSES) {
        await db.environments.updateOperation(operation.id, { status })
        expect(await db.environments.activeOperation(projectId, input.id)).toMatchObject({ status, kind: 'provision' })
        await expect(db.environments.createOperation('owner', projectId, input.id, config.id, null, 'remove')).rejects.toThrow()
        await expect(db.environments.saveSettings('owner', projectId, input.id, [])).rejects.toThrow('Environment is busy')
      }
      for (const status of ['failed', 'succeeded', 'rolled_back'] as const) {
        await db.environments.updateOperation(operation.id, { status })
        expect(await db.environments.activeOperation(projectId, input.id)).toBeNull()
        await db.environments.saveSettings('owner', projectId, input.id, [])
        const next = await db.environments.createOperation('owner', projectId, input.id, config.id, null, 'remove')
        expect(next.kind).toBe('remove')
        await db.environments.updateOperation(next.id, { status: 'succeeded' })
      }
    })
    it('backfills stage-3 link addresses and preserves VPN transport across reopen', async () => {
      const link = await db.environments.ensureLink({ projectId, environmentId: input.id, clientMachineId: 'client', serverMachineId: 'server', servicePort: 5432, listenerPort: 17001 })
      const sql = (db as unknown as { sql: Sql }).sql
      await sql.exec('ALTER TABLE environment_links DROP COLUMN transport')
      await sql.exec('ALTER TABLE environment_links DROP COLUMN address')
      for (let attempt = 0; attempt < 2; attempt++) {
        peer = new VoiceChatDb(join(dir, 'db.sqlite'), engine === 'postgres' ? { postgres: { url: process.env.VC_TEST_DB_URL!, schema } } : {})
        await peer.ready
        expect((await peer.environments.listLinks(projectId, input.id))[0]).toMatchObject(attempt === 0
          ? { id: link.id, transport: 'tunnel', address: 'host.docker.internal:17001' }
          : { id: link.id, transport: 'vpn', address: '100.64.0.2:5432' })
        await peer.environments.setLinkTransport(link.id, 'vpn', '100.64.0.2:5432')
        await peer.close(); peer = undefined
      }
    })
    it('upgrades populated stage-1 tables and replaces the active index idempotently', async () => {
      const config = await db.environments.addConfiguration('owner', projectId, input.id, [], null)
      const operation = await db.environments.createOperation('owner', projectId, input.id, config.id, null)
      const sql = (db as unknown as { sql: Sql }).sql
      await sql.exec('DROP TABLE environment_links')
      await sql.exec('DROP TABLE environment_settings')
      await sql.exec('DROP INDEX idx_environment_compose_project')
      await sql.exec('DROP INDEX idx_environment_active_operation_v2')
      for (const [table, columns] of [
        ['environments', ['mode', 'storage_id', 'state', 'compose_project', 'port']],
        ['environment_configurations', ['core_json']], ['environment_operations', ['kind']],
      ] as const) for (const column of columns) await sql.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`)
      await sql.exec("CREATE UNIQUE INDEX idx_environment_active_operation ON environment_operations(project_id, environment_id) WHERE status IN ('pending', 'pulling', 'switching', 'health_check')")
      for (let attempt = 0; attempt < 2; attempt++) {
        peer = new VoiceChatDb(join(dir, 'db.sqlite'), engine === 'postgres' ? { postgres: { url: process.env.VC_TEST_DB_URL!, schema } } : {})
        await peer.ready
        expect(await peer.environments.getEnvironment('owner', projectId, input.id)).toMatchObject({ mode: 'external', state: 'ready', storageId: null, composeProject: null, port: null })
        expect((await peer.environments.getConfiguration('owner', projectId, config.id))?.core).toBeNull()
        expect(await peer.environments.activeOperation(projectId, input.id)).toMatchObject({ kind: 'apply' })
        for (const status of ['preparing', 'building', 'starting', 'removing'] as const) {
          await peer.environments.updateOperation(operation.id, { status })
          await expect(peer.environments.createOperation('owner', projectId, input.id, config.id, null)).rejects.toThrow()
        }
        const peerSql = (peer as unknown as { sql: Sql }).sql
        const indexes = engine === 'postgres'
          ? await peerSql.all<{ name: string }>('SELECT indexname AS name FROM pg_indexes WHERE schemaname = current_schema()')
          : await peerSql.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index'")
        expect(indexes.map(index => index.name)).toContain('idx_environment_active_operation_v2')
        expect(indexes.map(index => index.name)).not.toContain('idx_environment_active_operation')
        expect(await peer.environments.readSettings(projectId, input.id)).toEqual([])
        const link = await peer.environments.ensureLink({ projectId, environmentId: input.id, clientMachineId: 'client', serverMachineId: 'server', servicePort: 5432, listenerPort: 17001 })
        expect(await peer.environments.listLinks(projectId, input.id)).toEqual([link])
        await peer.close(); peer = undefined
      }
    }, 120_000)
    it.skipIf(engine !== 'postgres')('serializes revisions across independent Postgres connections', async () => {
      peer = new VoiceChatDb(':memory:', { postgres: { url: process.env.VC_TEST_DB_URL!, schema } })
      await peer.ready
      const results = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? peer! : db).environments.addConfiguration('owner', projectId, input.id, modules, null)))
      expect(results.map(r => r.revision).sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
      const operations = await Promise.allSettled([db, peer].map(client => client.environments.createOperation('owner', projectId, input.id, results[0]!.id, null)))
      expect(operations.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    })
  })
}

it('includes environment tables, composite foreign keys and active-operation uniqueness in PostgreSQL DDL', () => {
  for (const table of ['environments', 'environment_configurations', 'environment_operations', 'environment_settings', 'environment_links']) expect(PG_SCHEMA.tables.some(sql => sql.includes(`CREATE TABLE IF NOT EXISTS ${table} (`))).toBe(true)
  expect(PG_SCHEMA.foreignKeys.join('\n')).toMatch(/FOREIGN KEY \(project_id, environment_id\) REFERENCES environments/)
  expect(PG_SCHEMA.indexes.join('\n')).toContain('idx_environment_active_operation')
})

it('adds transport and address to existing PostgreSQL links before startup backfill', () => {
  const existing = PG_SCHEMA.columns
    .filter(column => column.table !== 'environment_links' || !['transport', 'address'].includes(column.name))
    .map(column => ({ table_name: column.table, column_name: column.name }))
  const plan = postgresColumnUpgradePlan(PG_SCHEMA.columns, existing)
  expect([...plan.keys]).toEqual(['environment_links.transport', 'environment_links.address'])
  expect(plan.sql).toContain("transport TEXT NOT NULL DEFAULT 'tunnel'")
  expect(plan.sql).toContain("address TEXT NOT NULL DEFAULT ''")
})

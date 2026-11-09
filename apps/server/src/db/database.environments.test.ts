import { ACTIVE_ENVIRONMENT_OPERATION_STATUSES } from '@voicechat/shared'
import type { Sql } from '@sislexa/identity/storage-sql/types'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VoiceChatDb } from './database.js'
import { PG_SCHEMA, postgresColumnUpgradePlan } from './schemaPg.js'
import * as dbSeed from '../test/seed.js'

const input = { id: 'production', name: 'Production', machines: ['agent'], checkoutPath: '/srv/compose' }

/** Seeds a pending operation (and, by default, its configuration) the way the environment worker writes them. */
async function seedOperation(sql: Sql, projectId: string, environmentId: string, id: string, kind: string, withConfig = true): Promise<void> {
  if (withConfig) await sql.run(`INSERT INTO environment_configurations (id, project_id, environment_id, revision, modules_json, created_by, created_at) VALUES (?, ?, ?, 1, '[]', 'owner', 1)`, [`${id}-config`, projectId, environmentId])
  await sql.run(`INSERT INTO environment_operations (id, project_id, environment_id, configuration_id, kind, status, started_by, started_at) VALUES (?, ?, ?, ?, ?, 'pending', 'owner', 1)`, [id, projectId, environmentId, 'op-1-config', kind])
}

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
      await dbSeed.addMember(db, 'owner', projectId, 'member')
      await dbSeed.upsertEnvironment(db, 'owner', projectId, input)
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
      await dbSeed.setEnvironmentState(db, projectId, input.id, { state: 'provisioning' })
      expect(await db.environments.authorizeLink(link.id)).toBe(true)
      await dbSeed.setEnvironmentState(db, projectId, input.id, { state: 'removed' })
      expect(await db.environments.authorizeLink(link.id)).toBe(false)
      await expect(db.environments.ensureLink(request)).rejects.toThrow('not active')
      const sql = (db as unknown as { sql: Sql }).sql
      await sql.run('DELETE FROM environments WHERE project_id = ? AND id = ?', [projectId, input.id])
      expect(await db.environments.listLinks(projectId, input.id)).toEqual([])
      expect(await db.environments.authorizeLink(link.id)).toBe(false)
    })
    it('scopes definitions by project', async () => {
      const before = await db.environments.getEnvironment('member', projectId, input.id)
      expect(before).toMatchObject({ ...input, projectId, createdBy: 'owner' })
      expect(await db.environments.getEnvironment('owner', otherProjectId, input.id)).toBeNull()
      await dbSeed.upsertEnvironment(db, 'owner', otherProjectId, input)
      expect(await db.environments.listEnvironments('member', projectId)).toHaveLength(1)
    })
    it('denies every user-facing repository method to non-members', async () => {
      for (const call of [
        () => db.environments.listEnvironments('outsider', projectId),
        () => db.environments.getEnvironment('outsider', projectId, input.id),
        () => db.environments.listSettings('outsider', projectId, input.id)
      ]) await expect(call()).rejects.toThrow('membership')
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
      // Operations are written by the environment worker; Core reads them and guards settings.
      const sql = (db as unknown as { sql: Sql }).sql
      await seedOperation(sql, projectId, input.id, 'op-1', 'provision')
      for (const status of ACTIVE_ENVIRONMENT_OPERATION_STATUSES) {
        await sql.run('UPDATE environment_operations SET status = ? WHERE id = ?', [status, 'op-1'])
        expect(await db.environments.activeOperation(projectId, input.id)).toMatchObject({ status, kind: 'provision' })
        await expect(seedOperation(sql, projectId, input.id, `op-${status}`, 'remove', false)).rejects.toThrow()
        await expect(db.environments.saveSettings('owner', projectId, input.id, [])).rejects.toThrow('Environment is busy')
      }
      for (const status of ['failed', 'succeeded', 'rolled_back'] as const) {
        await sql.run('UPDATE environment_operations SET status = ? WHERE id = ?', [status, 'op-1'])
        expect(await db.environments.activeOperation(projectId, input.id)).toBeNull()
        await db.environments.saveSettings('owner', projectId, input.id, [])
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
      const sql = (db as unknown as { sql: Sql }).sql
      await seedOperation(sql, projectId, input.id, 'op-1', 'apply')
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
        const peerSql = (peer as unknown as { sql: Sql }).sql
        expect(await peerSql.get<{ core_json: string | null }>('SELECT core_json FROM environment_configurations WHERE id = ?', ['op-1-config'])).toEqual({ core_json: null })
        expect(await peer.environments.activeOperation(projectId, input.id)).toMatchObject({ kind: 'apply' })
        for (const status of ['preparing', 'building', 'starting', 'removing'] as const) {
          await peerSql.run('UPDATE environment_operations SET status = ? WHERE id = ?', [status, 'op-1'])
          await expect(seedOperation(peerSql, projectId, input.id, `op-${attempt}-${status}`, 'apply', false)).rejects.toThrow()
        }
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

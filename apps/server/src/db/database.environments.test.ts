import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VoiceChatDb } from './database.js'
import { PG_SCHEMA } from './schemaPg.js'

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
  for (const table of ['environments', 'environment_configurations', 'environment_operations']) expect(PG_SCHEMA.tables.some(sql => sql.includes(`CREATE TABLE IF NOT EXISTS ${table} (`))).toBe(true)
  expect(PG_SCHEMA.foreignKeys.join('\n')).toMatch(/FOREIGN KEY \(project_id, environment_id\) REFERENCES environments/)
  expect(PG_SCHEMA.indexes.join('\n')).toContain('idx_environment_active_operation')
})

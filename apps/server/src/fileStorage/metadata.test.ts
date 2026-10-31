import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VoiceChatDb } from '../db/database.js'
import { randomUUID } from 'node:crypto'
import type { Sql } from '@sislexa/identity/storage-sql/types'
import { metadataContract, metadataService } from '../../../../packages/file-storage/src/metadata.contract.js'

for (const engine of ['sqlite', 'postgres'] as const) {
  describe.skipIf(engine === 'postgres' && !process.env.VC_TEST_DB_URL)(engine, () => {
    const open = () => new VoiceChatDb(engine === 'sqlite' ? '' : ':memory:', engine === 'postgres' ? {
      postgres: {url: process.env.VC_TEST_DB_URL!, schema: 'storage_' + randomUUID().replace(/-/g, ''), dropSchemaOnClose: true},
    } : {})
    metadataContract(async () => {
      const db = open()
      await db.ready
      return {store: db.storageMetadata(), close: () => db.close()}
    })
    it('reads the winner after an identity insert conflict and removes the losing candidate', async () => {
      const db = open()
      try {
        await db.ready
        const sql = (db as unknown as {sql: Sql}).sql
        const run = sql.run.bind(sql)
        let injected = false
        const spy = vi.spyOn(sql, 'run').mockImplementation(async (query, params) => {
          if (!injected && query.startsWith('INSERT INTO storage_space_refs')) {
            injected = true
            const winner = {id: 'winner', ownerId: 'owner', kind: 'chat', ref: 'ref', title: 'Winner', createdAt: 1, updatedAt: 1}
            await run('INSERT INTO storage_spaces (id, owner_id, data) VALUES (?, ?, ?)', [winner.id, winner.ownerId, JSON.stringify(winner)])
            await run('INSERT INTO storage_space_refs (owner_id, kind, ref_key, space_id) VALUES (?, ?, ?, ?)',
              ['owner', 'chat', JSON.stringify('ref'), winner.id])
          }
          return run(query, params)
        })
        try {
          const service = metadataService(db.storageMetadata())
          expect(await service.createSpace('owner', {kind: 'chat', ref: 'ref', title: 'Candidate'})).toMatchObject({id: 'winner', title: 'Winner'})
          expect(await service.listSpaces('owner')).toHaveLength(1)
          expect(injected).toBe(true)
        } finally { spy.mockRestore() }
      } finally { await db.close() }
    })
    it('enforces canonical identity uniqueness in SQL', async () => {
      const db = open()
      try {
        await db.ready
        const service = metadataService(db.storageMetadata())
        const space = await service.createSpace('owner', {kind: 'chat', ref: 'ref', title: 'Files'})
        const sql = (db as unknown as {sql: Sql}).sql
        await expect(sql.run('INSERT INTO storage_space_refs (owner_id, kind, ref_key, space_id) VALUES (?, ?, ?, ?)',
          ['owner', 'chat', JSON.stringify('ref'), space.id])).rejects.toThrow()
        expect((await service.createSpace('owner', {kind: 'chat', ref: 'ref', title: 'Again'})).id).toBe(space.id)
      } finally { await db.close() }
    })
  })
}
it.skipIf(!process.env.VC_TEST_DB_URL)('serializes creation across independent Postgres connections', async () => {
  const schema = 'storage_peers_' + randomUUID().replace(/-/g, '')
  const postgres = {url: process.env.VC_TEST_DB_URL!, schema}
  const db = new VoiceChatDb(':memory:', {postgres: {...postgres, dropSchemaOnClose: true}})
  let peer: VoiceChatDb | undefined
  try {
    await db.ready
    peer = new VoiceChatDb(':memory:', {postgres})
    await peer.ready
    const services = [metadataService(db.storageMetadata()), metadataService(peer.storageMetadata())]
    const spaces = await Promise.all(Array.from({length: 12}, (_, i) =>
      services[i % 2].createSpace('owner', {kind: 'make-project', ref: 'parallel', title: 'Project'})))
    expect(new Set(spaces.map(s => s.id)).size).toBe(1)
    expect(await services[0].listSpaces('owner')).toHaveLength(1)
  } finally { await peer?.close(); await db.close() }
})
describe('persistent storage metadata', () => {
  it('survives closing and reopening Core SQLite', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'storage-db-'))
    let db = new VoiceChatDb(join(dir, 'core.sqlite'))
    try {
      await db.storageMetadata().transaction(tx => tx.putSpace({id: 's', ownerId: 'owner', kind: 'chat', title: 'files', ref: 'conversation', createdAt: 1, updatedAt: 1}))
      await db.close()
      db = new VoiceChatDb(join(dir, 'core.sqlite'))
      expect(await db.storageMetadata().transaction(tx => tx.getSpace('s'))).toMatchObject({ref: 'conversation'})
      expect((await metadataService(db.storageMetadata()).createSpace('owner', {kind: 'chat', ref: 'conversation', title: 'Chat'})).id).toBe('s')
      await db.close()
      db = new VoiceChatDb(join(dir, 'core.sqlite'))
      expect((await metadataService(db.storageMetadata()).createSpace('owner', {kind: 'chat', ref: 'conversation', title: 'Again'})).id).toBe('s')
    } finally { await db.close(); rmSync(dir, {recursive: true, force: true}) }
  })
})


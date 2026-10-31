import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VoiceChatDb } from '../db/database.js'
import { metadataContract } from '../../../../packages/file-storage/src/metadata.contract.js'

metadataContract(async () => {
  const db = new VoiceChatDb(':memory:')
  await db.ready
  return {store: db.storageMetadata(), close: () => db.close()}
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
    } finally { await db.close(); rmSync(dir, {recursive: true, force: true}) }
  })
})


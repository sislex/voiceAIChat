import { describe, expect, it } from 'vitest'
import type { StorageMetadataStore, StoredSpace } from './metadata.js'

/** Shared contract for memory and persistent host adapters. */
export function metadataContract(factory: () => Promise<{store: StorageMetadataStore; close(): Promise<void>}>) {
  describe('StorageMetadataStore contract', () => {
    it('commits, isolates values and rolls back without retrying callbacks', async () => {
      const f = await factory()
      const space: StoredSpace = {id: 's', ownerId: 'o', kind: 'chat', title: 'Files', ref: 'c', createdAt: 1, updatedAt: 1}
      try {
        await f.store.transaction(async tx => { await tx.putSpace(space) })
        space.title = 'mutated'
        expect(await f.store.transaction(tx => tx.getSpace('s'))).toMatchObject({title: 'Files'})
        let calls = 0
        await expect(f.store.transaction(async tx => {
          calls++; await tx.putSpace({...space, id: 'bad'}); throw new Error('rollback')
        })).rejects.toThrow('rollback')
        expect(calls).toBe(1)
        expect(await f.store.transaction(tx => tx.getSpace('bad'))).toBeNull()
      } finally { await f.close() }
    })
    it('upserts entries and acceptances, accounts owners, cascades share/space deletion', async () => {
      const f = await factory()
      try {
        await f.store.transaction(async tx => {
          await tx.putSpace({id: 's', ownerId: 'o', kind: 'personal', title: 'Files', ref: null, createdAt: 1, updatedAt: 1})
          const entry = {spaceId: 's', path: 'a', size: 7, mimeType: 'text/plain', revision: 1, updatedAt: 1, updatedBy: 'writer', nodeId: 'node', blobId: 'blob'}
          await tx.putEntry(entry); await tx.putEntry({...entry, size: 4})
          await tx.putShare({id: 'share', spaceId: 's', permission: 'read', audience: {kind: 'link', token: 'token'}, createdAt: 1, createdBy: 'o'})
          await tx.putAcceptance({shareId: 'share', userId: 'reader', acceptedAt: 1})
          await tx.putAcceptance({shareId: 'share', userId: 'reader', acceptedAt: 2})
          expect(await tx.ownerUsage('o')).toEqual({usedBytes: 4, fileCount: 1})
          expect(await tx.ownerUsage('writer')).toEqual({usedBytes: 0, fileCount: 0})
          expect(await tx.listAcceptances('reader')).toHaveLength(1)
          expect(await tx.getLink('token')).toMatchObject({id: 'share'})
          await tx.deleteShare('share')
          expect(await tx.listAcceptances('reader')).toEqual([])
          expect(await tx.getLink('token')).toBeNull()
          await tx.deleteSpace('s')
          expect(await tx.listEntries('s')).toEqual([])
          expect(await tx.listSpaces()).toEqual([])
        })
      } finally { await f.close() }
    })
    it('serializes concurrent quota-like reads and updates', async () => {
      const f = await factory()
      try {
        await f.store.transaction(tx => tx.putSpace({id: 's', ownerId: 'o', kind: 'personal', title: '0', ref: null, createdAt: 1, updatedAt: 1}))
        await Promise.all(Array.from({length: 8}, () => f.store.transaction(async tx => {
          const s = (await tx.getSpace('s'))!
          await new Promise(resolve => setTimeout(resolve, 1))
          await tx.putSpace({...s, title: String(Number(s.title) + 1)})
        })))
        expect(await f.store.transaction(tx => tx.getSpace('s'))).toMatchObject({title: '8'})
      } finally { await f.close() }
    })
  })
}


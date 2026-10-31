import { describe, expect, it } from 'vitest'
import type { StorageMetadataStore, StoredSpace } from './metadata.js'
import { createFileStorageService } from './service.js'
import { randomUUID } from 'node:crypto'

export const metadataService = (metadata: StorageMetadataStore) => createFileStorageService({
  metadata, nodes: () => [], nodeInfo: () => [], quota: async () => 100,
  now: Date.now, newId: randomUUID,
})

/** Shared contract for memory and persistent host adapters. */
export function metadataContract(factory: () => Promise<{store: StorageMetadataStore; close(): Promise<void>}>) {
  describe('StorageMetadataStore contract', () => {
    it.each(['chat', 'make-project'] as const)('creates one %s space across concurrent coordinators', async kind => {
      const f = await factory()
      try {
        const services = [metadataService(f.store), metadataService(f.store)]
        const spaces = await Promise.all(Array.from({length: 12}, (_, i) =>
          services[i % 2].createSpace('owner', {kind, ref: 'ref', title: 'Files'})))
        expect(new Set(spaces.map(s => s.id)).size).toBe(1)
        expect(await services[0].listSpaces('owner')).toHaveLength(1)
        expect(await services[1].createSpace('owner', {kind, ref: 'ref', title: 'Changed'})).toEqual(spaces[0])
        expect((await services[0].createSpace('other', {kind, ref: 'ref', title: 'Files'})).id).not.toBe(spaces[0].id)
        expect((await services[0].createSpace('owner', {kind, ref: 'other', title: 'Files'})).id).not.toBe(spaces[0].id)
        const absent = await services[0].createSpace('owner', {kind, title: 'No ref'})
        expect((await services[1].createSpace('owner', {kind, ref: null, title: 'No ref'})).id).toBe(absent.id)
        expect((await services[0].createSpace('owner', {kind, ref: '', title: 'Empty ref'})).id).not.toBe(absent.id)
        await services[0].deleteSpace('owner', spaces[0].id)
        expect((await services[1].createSpace('owner', {kind, ref: 'ref', title: 'Recreated'})).id).not.toBe(spaces[0].id)
      } finally { await f.close() }
    })
    it('keeps kinds separate and personal spaces independent', async () => {
      const f = await factory()
      try {
        const service = metadataService(f.store)
        const spaces = await Promise.all((['chat', 'make-project', 'personal', 'personal'] as const)
          .map(kind => service.createSpace('owner', {kind, ref: 'ref', title: 'Files'})))
        expect(new Set(spaces.map(s => s.id)).size).toBe(4)
      } finally { await f.close() }
    })
    it('lists legacy duplicates and adopts the oldest without changing its data', async () => {
      const f = await factory()
      try {
        const old: StoredSpace = {id: 'old', ownerId: 'owner', kind: 'make-project', ref: 'project', title: 'Original', createdAt: 1, updatedAt: 1}
        await f.store.transaction(async tx => {
          await tx.putSpace({...old, id: 'duplicate', createdAt: 2})
          await tx.putSpace(old)
          await tx.putEntry({spaceId: old.id, path: 'file', size: 7, mimeType: 'text/plain', revision: 1, updatedAt: 1, updatedBy: 'owner', nodeId: 'node', blobId: 'blob'})
        })
        const service = metadataService(f.store)
        expect(await service.listSpaces('owner')).toHaveLength(2)
        expect(await service.createSpace('owner', {kind: old.kind, ref: old.ref, title: 'New'}))
          .toMatchObject({...old, usedBytes: 7, fileCount: 1})
        expect(await service.listSpaces('owner')).toHaveLength(2)
      } finally { await f.close() }
    })
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


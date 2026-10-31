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
    it('persists upload reservations and rolls back their removal with file publication', async () => {
      const f = await factory()
      try {
        const upload = {uploadId: 'upload', partSize: 3, expiresAt: 100, path: 'a', size: 6,
          mimeType: 'text/plain', spaceId: 's', ownerId: 'o', userId: 'o', nodeId: 'n', blobId: 'blob'}
        await f.store.transaction(async tx => {
          await tx.putSpace({id: 's', ownerId: 'o', kind: 'personal', title: 'Files', ref: null, createdAt: 1, updatedAt: 1})
          await tx.putUpload(upload)
        })
        await expect(f.store.transaction(async tx => {
          await tx.deleteUpload(upload.uploadId)
          await tx.putEntry({spaceId: 's', path: 'a', size: 6, mimeType: 'text/plain', revision: 1,
            updatedAt: 2, updatedBy: 'o', nodeId: 'n', blobId: 'blob'})
          throw new Error('rollback')
        })).rejects.toThrow('rollback')
        expect(await f.store.transaction(tx => tx.listUploads())).toEqual([upload])
        expect(await f.store.transaction(tx => tx.listEntries('s'))).toEqual([])
        // Keep orphan reservations after a space deletion so cleanup can find their node parts.
        await f.store.transaction(tx => tx.deleteSpace('s'))
        expect(await f.store.transaction(tx => tx.listUploads())).toEqual([upload])
        await f.store.transaction(tx => tx.deleteUpload(upload.uploadId))
        expect(await f.store.transaction(tx => tx.listUploads())).toEqual([])
      } finally { await f.close() }
    })
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
        expect((await service.listSpaces('owner'))[0].id).toBe(old.id)
        expect(await service.createSpace('owner', {kind: old.kind, ref: old.ref, title: 'New'}))
          .toMatchObject({...old, usedBytes: 7, fileCount: 1})
        expect(await service.listSpaces('owner')).toHaveLength(2)
      } finally { await f.close() }
    })
    it.each(['chat', 'make-project'] as const)('previews and atomically merges legacy %s duplicates', async kind => {
      const f = await factory()
      try {
        const service = metadataService(f.store)
        const original = await service.createSpace('owner', {kind, ref: 'ref', title: 'Old'})
        const winner = {...original, id: 'winner', createdAt: original.createdAt + 1}
        const entry = {path: 'a', size: 7, mimeType: 'text/plain', revision: 2, updatedAt: 1, updatedBy: 'owner', nodeId: 'node', blobId: 'blob'}
        await f.store.transaction(async tx => {
          await tx.putSpace(winner)
          await tx.putSpace({...winner, id: 'empty'})
          await tx.putSpace({...winner, id: 'other-owner', ownerId: 'other'})
          await tx.putSpace({...winner, id: 'other-ref', ref: 'other'})
          await tx.putEntry({...entry, spaceId: original.id})
          await tx.putEntry({...entry, spaceId: winner.id, path: 'b'})
          await tx.putEntry({...entry, spaceId: winner.id, path: 'c'})
        })
        const share = await service.createShare('owner', original.id, {permission: 'write'})
        await service.acceptLink('reader', share.audience.kind === 'link' ? share.audience.token : '')
        for (const user of ['reader', 'none']) {
          await expect(service.mergeDuplicates(user, original.id)).rejects.toMatchObject({code: 'forbidden'})
        }
        const preview = await service.mergeDuplicates('owner', original.id)
        expect(preview).toMatchObject({dryRun: true, keepSpaceId: winner.id,
          moves: [{fromSpaceId: original.id, path: 'a'}], conflicts: [], revokedShareIds: [share.id]})
        expect(preview.deleteSpaceIds).toEqual(expect.arrayContaining([original.id, 'empty']))
        expect(await service.getSpace('owner', original.id)).toBeTruthy()
        await expect(service.mergeDuplicates('owner', original.id, {dryRun: false})).rejects.toMatchObject({code: 'revision_conflict'})
        await service.updateSpace('owner', winner.id, {title: 'Changed'})
        await expect(service.mergeDuplicates('owner', original.id, {dryRun: false, previewToken: preview.previewToken})).rejects.toMatchObject({code: 'revision_conflict'})
        const fresh = await service.mergeDuplicates('owner', original.id)
        await service.mergeDuplicates('owner', original.id, {dryRun: false, previewToken: fresh.previewToken})
        expect((await service.listEntries('owner', winner.id)).entries.map(e => e.path)).toEqual(['a', 'b', 'c'])
        expect(await service.usage('owner')).toMatchObject({usedBytes: 21, fileCount: 3})
        expect(await f.store.transaction(tx => tx.getSpace(original.id))).toBeNull()
        expect(await f.store.transaction(tx => tx.listAcceptances('reader'))).toEqual([])
        expect((await service.createSpace('owner', {kind, ref: 'ref', title: 'Again'})).id).toBe(winner.id)
        expect((await service.listSpaces('owner')).map(s => s.id).sort()).toEqual(['other-ref', 'winner'])
        expect(await service.mergeDuplicates('owner', winner.id)).toMatchObject({deleteSpaceIds: [], moves: []})
      } finally { await f.close() }
    })
    it('preserves conflicting versions and applies a token without a dryRun flag', async () => {
      const f = await factory()
      try {
        const service = metadataService(f.store)
        const space = await service.createSpace('owner', {kind: 'chat', ref: 'r', title: 'Chat'})
        await f.store.transaction(async tx => {
          await tx.putSpace({...space, id: 'duplicate'})
          for (const id of [space.id, 'duplicate']) await tx.putEntry({spaceId: id, path: 'a', size: 1,
            mimeType: 'text/plain', revision: 1, updatedAt: 1, updatedBy: 'owner', nodeId: 'node', blobId: id})
        })
        const preview = await service.mergeDuplicates('owner', space.id)
        expect(preview.conflicts).toHaveLength(1)
        expect(await service.mergeDuplicates('owner', space.id, {dryRun: true, previewToken: preview.previewToken})).toMatchObject({dryRun: true})
        expect(await service.listSpaces('owner')).toHaveLength(2)
        expect(await service.mergeDuplicates('owner', space.id, {previewToken: preview.previewToken})).toMatchObject({dryRun: false})
        expect(await service.listSpaces('owner')).toHaveLength(1)
        const entries = await f.store.transaction(tx => tx.listEntries(preview.keepSpaceId))
        expect(entries.map(e => e.blobId).sort()).toEqual(['duplicate', space.id].sort())
        expect(entries.filter(e => e.path.startsWith('.duplicates/'))).toHaveLength(1)
        expect(await service.usage('owner')).toMatchObject({fileCount: 2})
      } finally { await f.close() }
    })
    it('keeps maximum-length conflicting paths addressable', async () => {
      const f = await factory()
      try {
        const service = metadataService(f.store)
        const space = await service.createSpace('owner', {kind: 'chat', ref: 'long', title: 'Files'})
        const path = 'a'.repeat(1024)
        await f.store.transaction(async tx => {
          await tx.putSpace({...space, id: 'duplicate'})
          for (const id of [space.id, 'duplicate']) await tx.putEntry({spaceId: id, path, size: 1,
            mimeType: 'text/plain', revision: 1, updatedAt: 1, updatedBy: 'owner', nodeId: 'node', blobId: id})
        })
        const preview = await service.mergeDuplicates('owner', space.id)
        expect(preview.conflicts[0].toPath!.length).toBeLessThanOrEqual(1024)
        await service.mergeDuplicates('owner', space.id, {previewToken: preview.previewToken})
        expect((await service.listEntries('owner', preview.keepSpaceId)).entries).toHaveLength(2)
      } finally { await f.close() }
    })
    it('lists the registered canonical space before older legacy duplicates', async () => {
      const f = await factory()
      try {
        const service = metadataService(f.store)
        const canonical = await service.createSpace('owner', {kind: 'make-project', ref: 'p', title: 'Project'})
        await f.store.transaction(tx => tx.putSpace({...canonical, id: 'legacy', createdAt: 0}))
        expect((await service.listSpaces('owner'))[0].id).toBe(canonical.id)
        expect((await service.createSpace('owner', {kind: 'make-project', ref: 'p', title: 'Again'})).id).toBe(canonical.id)
      } finally { await f.close() }
    })
    it('keeps newest bytes at original paths and avoids archive collisions across three spaces', async () => {
      const f = await factory()
      try {
        const service = metadataService(f.store)
        const space = await service.createSpace('owner', {kind: 'make-project', ref: 'p', title: 'Проект 2'})
        const entry = {size: 1, mimeType: 'text/plain', revision: 1, updatedAt: 1, updatedBy: 'owner', nodeId: 'node'}
        await f.store.transaction(async tx => {
          for (const id of ['second', 'third']) await tx.putSpace({...space, id})
          await tx.putEntry({...entry, spaceId: space.id, path: 'index.html', blobId: 'old', revision: 9})
          await tx.putEntry({...entry, spaceId: space.id, path: 'app.js', blobId: 'app'})
          await tx.putEntry({...entry, spaceId: space.id, path: `.duplicates/${space.id}/index.html`, blobId: 'archive'})
          await tx.putEntry({...entry, spaceId: 'second', path: 'index.html', blobId: 'new', updatedAt: 3})
          await tx.putEntry({...entry, spaceId: 'third', path: 'index.html', blobId: 'middle', updatedAt: 2})
          await tx.putEntry({...entry, spaceId: 'third', path: 'styles.css', blobId: 'styles'})
        })
        const preview = await service.mergeDuplicates('owner', space.id)
        expect(preview.keepSpaceId).toBe(space.id)
        expect(preview.conflicts).toEqual(expect.arrayContaining([
          {fromSpaceId: space.id, path: 'index.html', toPath: `.duplicates/${space.id}/1/index.html`},
          {fromSpaceId: 'third', path: 'index.html', toPath: '.duplicates/third/index.html'},
        ]))
        expect(await service.mergeDuplicates('owner', space.id)).toEqual(preview)
        await service.mergeDuplicates('owner', space.id, {previewToken: preview.previewToken})
        const entries = await f.store.transaction(tx => tx.listEntries(space.id))
        expect(entries.find(e => e.path === 'index.html')).toMatchObject({blobId: 'new', revision: 1})
        expect(entries.map(e => e.blobId).sort()).toEqual(['app', 'archive', 'middle', 'new', 'old', 'styles'])
        expect(entries.filter(e => !e.path.startsWith('.')).map(e => e.path).sort()).toEqual(['app.js', 'index.html', 'styles.css'])
        expect(await service.listSpaces('owner')).toHaveLength(1)
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

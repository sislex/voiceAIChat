import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { StorageNodeInfo } from '@voicechat/shared/fileStorage'
import { createFileStorageService, type FileStoragePorts } from './service.js'
import { createMemoryMetadataStore, type StorageMetadataStore } from './metadata.js'
import { StorageServiceError } from './errors.js'
import type { StorageNodeClient } from './client.js'

const data = (value: string) => new TextEncoder().encode(value)
function fixture(quota = 100, capacities = [10e9, 60e9]) {
  const info: StorageNodeInfo[] = capacities.map((capacityBytes, i) => ({
    id: 'node-' + i, capacityBytes, usedBytes: 0, online: true, lastSeenAt: 1,
  }))
  const blobs = info.map(() => new Map<string, Uint8Array>())
  const clients: StorageNodeClient[] = info.map((node, i) => ({
    id: node.id,
    health: vi.fn(async () => ({ nodeId: node.id, capacityBytes: node.capacityBytes,
      usedBytes: node.usedBytes, freeBytes: node.capacityBytes - node.usedBytes })),
    put: vi.fn(async (id, bytes) => {
      if (!node.online) throw new Error('offline')
      if (node.usedBytes - (blobs[i].get(id)?.length ?? 0) + bytes.length > node.capacityBytes)
        throw new StorageServiceError('storage_full')
      node.usedBytes += bytes.length - (blobs[i].get(id)?.length ?? 0)
      blobs[i].set(id, bytes.slice())
    }),
    get: vi.fn(async id => {
      if (!node.online) throw new Error('offline')
      const bytes = blobs[i].get(id)
      if (!bytes) throw new StorageServiceError('not_found')
      return bytes.slice()
    }),
    delete: vi.fn(async id => {
      if (!node.online) throw new Error('offline')
      node.usedBytes -= blobs[i].get(id)?.length ?? 0
      blobs[i].delete(id)
    }),
  }))
  const metadata = createMemoryMetadataStore()
  const ports: FileStoragePorts = { metadata, nodes: () => clients, nodeInfo: () => info,
    quota: vi.fn(async () => quota), now: () => 100, newId: randomUUID, onCleanupError: vi.fn() }
  const service = createFileStorageService(ports)
  return { service, ports, info, blobs, clients, metadata,
    space: (owner = 'owner') => service.createSpace(owner, { kind: 'personal', title: 'Files' }) }
}
describe('file storage coordinator', () => {
  it('pools 10 + 60 GB, places on the freest node, removes offline capacity and rejects offline reads', async () => {
    const f = fixture()
    expect(await f.service.cluster('owner')).toMatchObject({ capacityBytes: 70e9 })
    const space = await f.space()
    await f.service.writeFile('owner', space.id, 'file', data('hello'))
    expect(f.clients[1].put).toHaveBeenCalledOnce()
    f.info[1].online = false
    expect(await f.service.cluster('owner')).toMatchObject({ capacityBytes: 10e9 })
    await expect(f.service.readFile('owner', space.id, 'file')).rejects.toMatchObject({ code: 'node_unavailable' })
  })
  it('charges collaborators to the owner and applies replacement quota deltas', async () => {
    const f = fixture(6)
    const space = await f.space()
    await f.service.createShare('owner', space.id, { userId: 'writer', permission: 'write' })
    await f.service.writeFile('writer', space.id, 'a', data('123456'))
    expect(await f.service.usage('owner')).toMatchObject({ usedBytes: 6, fileCount: 1 })
    expect(await f.service.usage('writer')).toMatchObject({ usedBytes: 0, fileCount: 0 })
    await expect(f.service.writeFile('writer', space.id, 'b', data('x'))).rejects.toMatchObject({ code: 'quota_exceeded' })
    expect(f.ports.quota).toHaveBeenLastCalledWith('owner')
    await f.service.writeFile('writer', space.id, 'a', data('12'))
    expect(await f.service.usage('owner')).toMatchObject({ usedBytes: 2 })
    expect((await f.service.getSpace('writer', space.id)).access).toBe('write')
  })
  it('reports full nodes even when aggregate free space could fit a file', async () => {
    const f = fixture(100, [4, 6])
    const space = await f.space()
    await expect(f.service.writeFile('owner', space.id, 'a', data('1234567'))).rejects.toMatchObject({ code: 'storage_full' })
    expect(await f.service.usage('owner')).toMatchObject({ usedBytes: 0 })
  })
  it('enforces read/write grants and owner-only administration, then revokes immediately', async () => {
    const f = fixture(), s = await f.space()
    await f.service.writeFile('owner', s.id, 'dir/a', data('a'))
    const read = await f.service.createShare('owner', s.id, { userId: 'reader', permission: 'read' })
    expect((await f.service.listEntries('reader', s.id, 'dir')).entries).toHaveLength(1)
    expect((await f.service.readFile('reader', s.id, 'dir/a')).bytes).toEqual(data('a'))
    for (const op of [
      () => f.service.writeFile('reader', s.id, 'b', data('b')),
      () => f.service.move('reader', s.id, 'dir/a', 'b'),
      () => f.service.deleteFile('reader', s.id, 'dir/a'),
      () => f.service.deleteSpace('reader', s.id),
      () => f.service.createShare('reader', s.id, { permission: 'write' }),
      () => f.service.listShares('reader', s.id),
    ]) await expect(op()).rejects.toMatchObject({ code: 'forbidden' })
    const write = await f.service.createShare('owner', s.id, { userId: 'reader', permission: 'write' })
    expect((await f.service.getSpace('reader', s.id)).access).toBe('write')
    await f.service.writeFile('reader', s.id, 'b', data('b'))
    await f.service.move('reader', s.id, 'b', 'c')
    await f.service.deleteFile('reader', s.id, 'c')
    await expect(f.service.revokeShare('reader', s.id, read.id)).rejects.toMatchObject({ code: 'forbidden' })
    await f.service.revokeShare('owner', s.id, write.id)
    expect((await f.service.getSpace('reader', s.id)).access).toBe('read')
    await f.service.revokeShare('owner', s.id, read.id)
    expect(await f.service.listSpaces('reader')).toEqual([])
    await expect(f.service.readFile('reader', s.id, 'dir/a')).rejects.toMatchObject({ code: 'forbidden' })
  })
  it('requires a signed-in identity to describe/accept links; revoked links invalidate acceptances', async () => {
    const f = fixture(), s = await f.space()
    const share = await f.service.createShare('owner', s.id, { permission: 'write' })
    if (share.audience.kind !== 'link') throw new Error('expected link')
    const token = share.audience.token
    await expect(f.service.describeLink('', token)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(f.service.acceptLink(' ', token)).rejects.toMatchObject({ code: 'forbidden' })
    expect(await f.service.describeLink('user', token)).toMatchObject({ permission: 'write', space: { id: s.id } })
    expect(await f.service.listSpaces('user')).toEqual([])
    await f.service.acceptLink('user', token)
    await f.service.acceptLink('user', token)
    expect(await f.service.listSpaces('user')).toHaveLength(1)
    await f.service.writeFile('user', s.id, 'a', data('a'))
    await f.service.revokeShare('owner', s.id, share.id)
    await expect(f.service.getSpace('user', s.id)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(f.service.acceptLink('user', token)).rejects.toMatchObject({ code: 'not_found' })
  })
  it('checks revisions and create-only atomically across coordinators', async () => {
    const f = fixture(), s = await f.space()
    const second = createFileStorageService(f.ports)
    const first = await f.service.writeFile('owner', s.id, 'a', data('old'), { createOnly: true })
    expect(first.revision).toBe(1)
    const edits = await Promise.allSettled([
      f.service.writeFile('owner', s.id, 'a', data('new1'), { ifMatch: 1 }),
      second.writeFile('owner', s.id, 'a', data('new2'), { ifMatch: 1 }),
    ])
    expect(edits.filter(e => e.status === 'fulfilled')).toHaveLength(1)
    expect(edits.find(e => e.status === 'rejected')).toMatchObject({ reason: { code: 'revision_conflict' } })
    await expect(f.service.writeFile('owner', s.id, 'a', data('x'), { createOnly: true })).rejects.toMatchObject({ code: 'revision_conflict' })
    await expect(f.service.writeFile('owner', s.id, 'missing', data('x'), { ifMatch: 1 })).rejects.toMatchObject({ code: 'revision_conflict' })
    expect((await f.service.readFile('owner', s.id, 'a')).entry.revision).toBe(2)
  })
  it('serializes owner quota checks across spaces and coordinator instances', async () => {
    const f = fixture(5), a = await f.space(), b = await f.space()
    const second = createFileStorageService(f.ports)
    const writes = await Promise.allSettled([
      f.service.writeFile('owner', a.id, 'a', data('1234')),
      second.writeFile('owner', b.id, 'b', data('1234')),
    ])
    expect(writes.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(writes.find(r => r.status === 'rejected')).toMatchObject({ reason: { code: 'quota_exceeded' } })
  })
  it('keeps old blobs on failed upload, stores new before deleting old, and rolls back failed metadata', async () => {
    const f = fixture(), s = await f.space()
    await f.service.writeFile('owner', s.id, 'a', data('old'))
    const old = [...f.blobs[1].keys()][0]
    vi.mocked(f.clients[1].put).mockRejectedValueOnce(new Error('offline'))
    await expect(f.service.writeFile('owner', s.id, 'a', data('new'))).rejects.toMatchObject({ code: 'node_unavailable' })
    expect((await f.service.readFile('owner', s.id, 'a')).bytes).toEqual(data('old'))
    const put = f.clients[1].put
    vi.mocked(put).mockImplementationOnce(async (id, bytes) => {
      expect(f.blobs[1].has(old)).toBe(true)
      f.blobs[1].set(id, bytes)
      f.info[1].usedBytes += bytes.length
    })
    await f.service.writeFile('owner', s.id, 'a', data('new'))
    expect(f.blobs[1].has(old)).toBe(false)
    const failing: StorageMetadataStore = { transaction: fn => f.metadata.transaction(async tx => fn({
      ...tx, putEntry: async () => { throw new Error('metadata failed') },
    })) }
    const second = createFileStorageService({ ...f.ports, metadata: failing })
    await expect(second.writeFile('owner', s.id, 'a', data('lost'))).rejects.toThrow('metadata failed')
    expect((await f.service.readFile('owner', s.id, 'a')).bytes).toEqual(data('new'))
    expect(f.blobs[1].size).toBe(1)
  })
  it('reports cleanup failures separately after committing a replacement', async () => {
    const f = fixture(), s = await f.space()
    await f.service.writeFile('owner', s.id, 'a', data('old'))
    vi.mocked(f.clients[1].delete).mockRejectedValueOnce(new Error('offline'))
    await expect(f.service.writeFile('owner', s.id, 'a', data('new'))).resolves.toMatchObject({ revision: 2 })
    expect(f.ports.onCleanupError).toHaveBeenCalledOnce()
    expect((await f.service.readFile('owner', s.id, 'a')).bytes).toEqual(data('new'))
  })
  it('validates paths, respects directory boundaries, prevents move overwrite and deletes all space metadata', async () => {
    const f = fixture(), s = await f.space()
    for (const path of ['../secret', 'a/../b', 'a\u0000b'])
      await expect(f.service.writeFile('owner', s.id, path, data('x'))).rejects.toMatchObject({ code: 'invalid_path' })
    await f.service.writeFile('owner', s.id, 'dir/a', data('a'))
    await f.service.writeFile('owner', s.id, 'directory/b', data('b'))
    expect((await f.service.listEntries('owner', s.id, 'dir')).entries.map(e => e.path)).toEqual(['dir/a'])
    await expect(f.service.move('owner', s.id, 'dir/a', 'directory/b')).rejects.toMatchObject({ code: 'revision_conflict' })
    expect(await f.service.move('owner', s.id, 'dir/a', 'new/a')).toMatchObject({ path: 'new/a', revision: 1 })
    await f.service.deleteSpace('owner', s.id)
    expect(await f.service.usage('owner')).toMatchObject({ usedBytes: 0, fileCount: 0 })
    expect(f.blobs[1].size).toBe(0)
    await expect(f.service.getSpace('owner', s.id)).rejects.toMatchObject({ code: 'not_found' })
  })
  it('rejects anonymous global operations, oversized files and writes without nodes', async () => {
    const f = fixture(), s = await f.space()
    for (const op of [() => f.service.cluster(''), () => f.service.usage(''), () => f.service.listSpaces(''), () => f.space('')])
      await expect(op()).rejects.toMatchObject({ code: 'forbidden' })
    await expect(f.service.writeFile('owner', s.id, 'a', new Uint8Array(64 * 1024 * 1024 + 1))).rejects.toMatchObject({ code: 'file_too_large' })
    const disabled = createFileStorageService({ ...f.ports, nodes: () => [] })
    await expect(disabled.writeFile('owner', s.id, 'a', data('a'))).rejects.toMatchObject({ code: 'storage_disabled' })
    f.info.forEach(n => { n.online = false })
    await expect(f.service.writeFile('owner', s.id, 'a', data('a'))).rejects.toMatchObject({ code: 'node_unavailable' })
  })
})

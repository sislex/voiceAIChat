import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StorageMigrationManager, type StorageMigrationDeps } from './manager.js'

function fixture() {
  const files = new Map<string, Buffer>([['/legacy/a.txt', Buffer.from('alpha')]])
  let failRename = false
  const fs: StorageMigrationDeps = {
    list: async (_machine, path) => ({ entries: [...files].filter(([name]) => name.startsWith(path + '/')).map(([name, data]) => ({ name: name.split('/').pop()!, kind: 'file' as const, size: data.length, mtime: 10 })) }),
    read: async (_machine, path) => { const data = files.get(path); if (!data) throw new Error('ENOENT'); return { dataBase64: data.toString('base64') } },
    write: async (_machine, path, data) => { files.set(path, Buffer.from(data, 'base64')) },
    mkdir: async () => undefined,
    rename: async (_machine, from, to) => { if (failRename) { failRename = false; throw new Error('crash') }; files.set(to, files.get(from)!); files.delete(from) },
    deleteFile: async (_machine, path) => { files.delete(path) }
  }
  const manager = new StorageMigrationManager(join(mkdtempSync(join(tmpdir(), 'migration-')), 'state.json'), fs)
  return { files, manager, failNextRename: () => { failRename = true } }
}

describe('StorageMigrationManager', () => {
  it('keeps dry-run mutation-free and excludes undefined items', async () => {
    const { files, manager } = fixture()
    const before = [...files]
    const plan = await manager.createDryRun({ actor: 'u1', machineId: 'm1', storageId: 's1', storageRoot: '/store', platform: 'linux', sources: [
      { path: '/legacy/a.txt', assignment: { kind: 'chat', conversationId: 'c1' } },
      { path: '/legacy/a.txt', assignment: { kind: 'undefined', reason: 'no domain link' } }
    ] })
    expect([...files]).toEqual(before)
    expect(plan.totalBytes).toBe(10)
    expect(plan.items.map((item) => item.status)).toEqual(['planned', 'undefined'])
    expect(manager.auditLog('u1', plan.id)[0]?.action).toBe('dry-run')
  })

  it('verifies copy, persists mapping and requires separate deletion', async () => {
    const { files, manager } = fixture()
    const plan = await manager.createDryRun({ actor: 'u1', machineId: 'm1', storageId: 's1', storageRoot: '/store', platform: 'linux', sources: [{ path: '/legacy/a.txt', assignment: { kind: 'chat', conversationId: 'c1' } }] })
    const copied = await manager.copy('u1', plan.id)
    expect(copied.items[0]?.verification?.verified).toBe(true)
    expect(files.has('/legacy/a.txt')).toBe(true)
    expect(manager.mappings('u1', 'm1')).toHaveLength(1)
    await manager.deleteVerified('u1', plan.id)
    expect(files.has('/legacy/a.txt')).toBe(false)
  })

  it('resumes after a publication failure without accepting a partial file', async () => {
    const { files, manager, failNextRename } = fixture()
    const plan = await manager.createDryRun({ actor: 'u1', machineId: 'm1', storageId: 's1', storageRoot: '/store', platform: 'linux', sources: [{ path: '/legacy/a.txt', assignment: { kind: 'chat', conversationId: 'c1' } }] })
    failNextRename()
    await expect(manager.copy('u1', plan.id)).rejects.toThrow('crash')
    expect(manager.get('u1', plan.id)?.status).toBe('copy-interrupted')
    const resumed = await manager.copy('u1', plan.id)
    expect(resumed.items[0]?.status).toBe('verified')
    expect([...files.keys()].filter((path) => path.endsWith('a.txt'))).toHaveLength(2)
  })

  it('blocks a source changed after dry-run and a different destination', async () => {
    const { files, manager } = fixture()
    const plan = await manager.createDryRun({ actor: 'u1', machineId: 'm1', storageId: 's1', storageRoot: '/store', platform: 'linux', sources: [{ path: '/legacy/a.txt', assignment: { kind: 'chat', conversationId: 'c1' } }] })
    files.set('/legacy/a.txt', Buffer.from('ALPHA'))
    const result = await manager.copy('u1', plan.id)
    expect(result.items[0]?.status).toBe('source-changed')
  })
})

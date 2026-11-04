import { expect, it, vi } from 'vitest'
import { VoiceChatDb } from '../db/database.js'
import { createStorageRuntime } from './runtime.js'
import { fileStorageConfig } from './config.js'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

it('validates public node configuration and loads its separate signing secret', async () => {
  const base = {id: 'node', url: 'http://localhost', tokenFile: 'unused'}
  const config = (extra: object) => fileStorageConfig({VC_FILE_STORAGE_MODE: 'embedded',
    VC_FILE_STORAGE_NODES: JSON.stringify([{...base, ...extra}])})
  for (const extra of [{publicUrl: 'https://node.example'},
    {publicUrl: 'https://user:pass@node.example', directSecretFile: 'secret'},
    {publicUrl: 'file:///data', directSecretFile: 'secret'}]) expect(() => config(extra)).toThrow()
  const root = await mkdtemp(join(tmpdir(), 'storage-direct-config-'))
  const secretFile = join(root, 'secret')
  const db = new VoiceChatDb(':memory:')
  const client = {id: 'node', health: async () => ({nodeId: 'node', capacityBytes: 100, usedBytes: 0, freeBytes: 100}),
    put: async () => {}, get: async () => new Uint8Array(), delete: async () => {}}
  try {
    await writeFile(secretFile, 'short')
    const c = config({publicUrl: 'https://node.example', directSecretFile: secretFile})
    await expect(createStorageRuntime(db, c, [client])).rejects.toThrow('32 characters')
    await writeFile(secretFile, 'test-direct-secret-32-characters-long')
    const runtime = await createStorageRuntime(db, c, [client])
    try {
      const space = await runtime.service.createSpace('owner', {kind: 'personal', title: 'Files'})
      await runtime.service.writeFile('owner', space.id, 'a', Buffer.from('abc'))
      const link = await runtime.service.fileUrl('owner', space.id, {operation: 'read', path: 'a'})
      expect(new URL(link.url).origin).toBe('https://node.example')
      expect(new URL(link.url).searchParams.has('sig')).toBe(true)
    } finally { await runtime.close() }
  } finally { await db.close(); await rm(root, {recursive: true, force: true}) }
})
it('validates config, falls back to host quota and marks offline after two failed polls', async () => {
  expect(fileStorageConfig({})).toMatchObject({mode:'off', defaultQuotaBytes:104857600, maxFileBytes: 1024 ** 3})
  expect(fileStorageConfig({VC_FILE_STORAGE_MAX_FILE_BYTES:'1234'}).maxFileBytes).toBe(1234)
  expect(fileStorageConfig({VC_FILE_STORAGE_MODE:'remote', VC_FILE_STORAGE_URL:'https://storage.example',
    VC_FILE_STORAGE_SERVICE_TOKEN_FILE:'/run/secrets/storage'})).toMatchObject({mode:'remote',url:'https://storage.example'})
  for (const env of [{VC_FILE_STORAGE_MODE:'bad'}, {VC_FILE_STORAGE_NODES:'{}'}, {VC_FILE_STORAGE_DEFAULT_QUOTA_BYTES:'-1'}, {VC_FILE_STORAGE_MAX_FILE_BYTES:'0'}])
    expect(() => fileStorageConfig(env)).toThrow()
  const db = new VoiceChatDb(':memory:')
  const health = vi.fn(async () => ({nodeId:'node', capacityBytes:10e9, usedBytes:0, freeBytes:10e9}))
  const runtime = await createStorageRuntime(db, {mode:'embedded', nodes:[], defaultQuotaBytes:42, maxFileBytes:3}, [{
    id:'node', health, put: async () => {}, get: async () => new Uint8Array(), delete: async () => {},
  }])
  try {
    expect((await runtime.service.usage('owner')).quotaBytes).toBe(42)
    const space = await runtime.service.createSpace('owner', {kind:'personal', title:'Files'})
    await expect(runtime.service.writeFile('owner', space.id, 'large', new Uint8Array(4)))
      .rejects.toMatchObject({code:'file_too_large'})
    const identity = db.identity as typeof db.identity & {getUserStorageQuota?: (id: string) => Promise<number>}
    identity.getUserStorageQuota = async id => { await db.settings.getSettings(id); return 7 }
    const results = await Promise.all([runtime.service.usage('owner'), db.settings.getSettings('owner')])
    expect(results[0].quotaBytes).toBe(7)
    health.mockRejectedValue(new Error('offline'))
    await runtime.poll()
    expect((await runtime.service.cluster('owner')).capacityBytes).toBe(10e9)
    await runtime.poll()
    expect((await runtime.service.cluster('owner')).capacityBytes).toBe(0)
    health.mockResolvedValue({nodeId:'node', capacityBytes:10e9, usedBytes:0, freeBytes:10e9})
    await runtime.poll()
    expect((await runtime.service.cluster('owner')).capacityBytes).toBe(10e9)
  } finally {await runtime.close(); await db.close()}
})

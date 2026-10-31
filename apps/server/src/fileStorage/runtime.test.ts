import { expect, it, vi } from 'vitest'
import { VoiceChatDb } from '../db/database.js'
import { createStorageRuntime } from './runtime.js'
import { fileStorageConfig } from './config.js'
it('requires a separate secret file and a safe public URL for direct nodes', () => {
  const node = { id: 'a', url: 'http://internal:8795', tokenFile: '/token', publicUrl: 'https://files.test', directSecretFile: '/direct-secret' }
  expect(fileStorageConfig({ VC_FILE_STORAGE_NODES: JSON.stringify([node]) }).nodes).toEqual([node])
  for (const override of [{ directSecretFile: undefined }, { publicUrl: 'https://user:pass@files.test' }, { publicUrl: 'file:///data' }, { publicUrl: 'https://files.test?secret=x' }])
    expect(() => fileStorageConfig({ VC_FILE_STORAGE_NODES: JSON.stringify([{ ...node, ...override }]) })).toThrow()
})
it('validates config, falls back to host quota and marks offline after two failed polls', async () => {
  expect(fileStorageConfig({})).toMatchObject({mode:'off', defaultQuotaBytes:104857600})
  for (const env of [{VC_FILE_STORAGE_MODE:'bad'}, {VC_FILE_STORAGE_NODES:'{}'}, {VC_FILE_STORAGE_DEFAULT_QUOTA_BYTES:'-1'}])
    expect(() => fileStorageConfig(env)).toThrow()
  const db = new VoiceChatDb(':memory:')
  const health = vi.fn(async () => ({nodeId:'node', capacityBytes:10e9, usedBytes:0, freeBytes:10e9}))
  const runtime = await createStorageRuntime(db, {mode:'embedded', nodes:[], defaultQuotaBytes:42}, [{
    id:'node', health, put: async () => {}, get: async () => new Uint8Array(), delete: async () => {},
  }])
  try {
    expect((await runtime.service.usage('owner')).quotaBytes).toBe(42)
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


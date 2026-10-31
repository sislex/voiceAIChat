import { expect, it, vi } from 'vitest'
import { VoiceChatDb } from '../db/database.js'
import { createStorageRuntime } from './runtime.js'
import { fileStorageConfig } from './config.js'
it('validates config, falls back to host quota and marks offline after two failed polls', async () => {
  expect(fileStorageConfig({})).toMatchObject({mode:'off', defaultQuotaBytes:104857600, maxFileBytes: 1024 ** 3})
  expect(fileStorageConfig({VC_FILE_STORAGE_MAX_FILE_BYTES:'1234'}).maxFileBytes).toBe(1234)
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


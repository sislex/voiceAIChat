import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { storageQuotaBytes, type StorageNodeInfo } from '@voicechat/shared/fileStorage'
import { createFileStorageService } from '../../../../packages/file-storage/src/service.js'
import { createStorageNodeClient, type StorageNodeClient } from '../../../../packages/file-storage/src/client.js'
import type { VoiceChatDb } from '../db/database.js'
import type { FileStorageConfig } from './config.js'
import { createThumbnailGenerator } from './thumbnail.js'

export async function createStorageRuntime(db: VoiceChatDb, config: FileStorageConfig, injected?: StorageNodeClient[]) {
  const clients = injected ?? await Promise.all(config.nodes.map(async node => createStorageNodeClient({
    id: node.id, url: node.url, token: (await readFile(node.tokenFile, 'utf8')).trim(),
  })))
  const info: StorageNodeInfo[] = clients.map(node => ({ id: node.id, capacityBytes: 0, usedBytes: 0, online: false, lastSeenAt: null }))
  const failures = new Map<string, number>()
  let pending: Promise<void> | undefined
  const poll = (): Promise<void> => pending ??= Promise.all(clients.map(async (client, i) => {
    try {
      const health = await client.health()
      Object.assign(info[i], { capacityBytes: health.capacityBytes, usedBytes: health.usedBytes, online: true, lastSeenAt: Date.now() })
      failures.set(client.id, 0)
    } catch {
      const failed = (failures.get(client.id) ?? 0) + 1
      failures.set(client.id, failed)
      if (failed >= 2) info[i].online = false
    }
  })).then(() => {}).finally(() => { pending = undefined })
  await poll()
  const timer = setInterval(() => { void poll() }, 15_000)
  timer.unref()
  const identity = db.identity as typeof db.identity & { getUserStorageQuota?: (userId: string) => Promise<number | null> }
  const service = createFileStorageService({
    maxFileBytes: config.maxFileBytes,
    metadata: db.storageMetadata(), nodes: () => clients, nodeInfo: () => structuredClone(info),
    quota: async userId => storageQuotaBytes(await identity.getUserStorageQuota?.(userId), config.defaultQuotaBytes),
    now: Date.now, newId: randomUUID, thumbnail: createThumbnailGenerator(),
  })
  return { service, poll, async close() { clearInterval(timer); await pending } }
}

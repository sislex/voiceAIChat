import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STORAGE_QUOTA_BYTES,
  MAX_CHAT_UPLOAD_BYTES,
  CHAT_UPLOAD_METADATA_HEADERS,
  STORAGE_REST,
  fitsStorageQuota,
  isStorageBlobId,
  normalizeStoragePath,
  normalizeStoragePrefix,
  pickStorageNode,
  storageAllows,
  storageQuotaBytes,
  strongestStorageAccess,
  summarizeStorageCluster,
  type StorageNodeInfo,
} from './fileStorage'

const node = (id: string, capacityGb: number, usedGb: number, online = true): StorageNodeInfo => ({
  id,
  capacityBytes: capacityGb * 1e9,
  usedBytes: usedGb * 1e9,
  online,
  lastSeenAt: 1,
})

describe('file storage contract', () => {
  it('keeps the chat limit and metadata names stable for raw and multipart clients', () => {
    expect(MAX_CHAT_UPLOAD_BYTES).toBe(32 * 1024 * 1024)
    expect(CHAT_UPLOAD_METADATA_HEADERS).toEqual({
      name: 'name', conversationId: 'conversationid', agentId: 'agentid', mimeType: 'mimetype',
    })
  })
  it('normalizes space-relative paths and rejects traversal', () => {
    expect(normalizeStoragePath('/a//b\\c.txt')).toBe('a/b/c.txt')
    expect(normalizeStoragePath('docs/../secret')).toBeNull()
    expect(normalizeStoragePath('./a')).toBeNull()
    expect(normalizeStoragePath('')).toBeNull()
    expect(normalizeStoragePath('a\u0000b')).toBeNull()
    expect(normalizeStoragePath('x'.repeat(1025))).toBeNull()
    expect(normalizeStoragePrefix(undefined)).toBe('')
    expect(normalizeStoragePrefix('/')).toBe('')
    expect(normalizeStoragePrefix('img/')).toBe('img/')
    expect(normalizeStoragePrefix('../x')).toBeNull()
  })

  it('orders permissions like Google Docs: owner > write > read', () => {
    expect(storageAllows('read', 'read')).toBe(true)
    expect(storageAllows('read', 'write')).toBe(false)
    expect(storageAllows('write', 'write')).toBe(true)
    expect(storageAllows('owner', 'write')).toBe(true)
    expect(storageAllows(null, 'read')).toBe(false)
    expect(strongestStorageAccess(['read', null, 'write'])).toBe('write')
    expect(strongestStorageAccess(['read', 'owner'])).toBe('owner')
    expect(strongestStorageAccess([undefined])).toBeNull()
  })

  it('uses the Identity quota or the 100 MB default', () => {
    expect(storageQuotaBytes(null)).toBe(DEFAULT_STORAGE_QUOTA_BYTES)
    expect(storageQuotaBytes(-1)).toBe(DEFAULT_STORAGE_QUOTA_BYTES)
    expect(storageQuotaBytes(5e8)).toBe(5e8)
    expect(storageQuotaBytes(0)).toBe(0)
    const usage = { usedBytes: 90, quotaBytes: 100 }
    expect(fitsStorageQuota(usage, 10)).toBe(true)
    expect(fitsStorageQuota(usage, 11)).toBe(false)
    expect(fitsStorageQuota(usage, 20, 15)).toBe(true)
  })

  it('pools node capacity and places files on the freest online node', () => {
    const nodes = [node('a', 10, 1), node('b', 60, 30), node('c', 100, 0, false)]
    const cluster = summarizeStorageCluster(nodes)
    expect(cluster.capacityBytes).toBe(70e9)
    expect(cluster.usedBytes).toBe(31e9)
    expect(cluster.freeBytes).toBe(39e9)
    expect(pickStorageNode(nodes, 1e9)?.id).toBe('b')
    expect(pickStorageNode(nodes, 35e9)).toBeNull()
    expect(pickStorageNode([node('a', 10, 1), node('b', 60, 55)], 8e9)?.id).toBe('a')
  })

  it('encodes REST paths and validates blob ids', () => {
    expect(STORAGE_REST.file('s 1')).toBe('/api/storage/spaces/s%201/file')
    expect(STORAGE_REST.link('t/x')).toBe('/api/storage/links/t%2Fx')
    expect(isStorageBlobId('abcDEF12_-')).toBe(true)
    expect(isStorageBlobId('../../etc')).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  MAX_STORAGE_BATCH_OPERATIONS, MAX_STORAGE_INLINE_BYTES, isStorageSmallText, FILE_STORAGE_NODE_PATHS,
  STORAGE_COMPRESSION_MIN_BYTES, isStorageCompressible, storageContentEncoding,
  MAX_CHAT_UPLOAD_BYTES,
  CHAT_UPLOAD_METADATA_HEADERS,
  DEFAULT_STORAGE_QUOTA_BYTES, MAX_STORAGE_FILE_BYTES, MAX_STORAGE_PART_BYTES, MAX_STORAGE_BATCH_BYTES, storageMaxFileBytes,
  STORAGE_ERROR_STATUS,
  STORAGE_REST,
  DEFAULT_STORAGE_PART_SIZE,
  MAX_STORAGE_UPLOAD_PARTS,
  STORAGE_UPLOAD_TTL_MS,
  STORAGE_THUMBNAIL_SIZES,
  fitsStorageQuota,
  isStorageBlobId,
  normalizeStoragePath,
  normalizeStoragePrefix,
  pickStorageNode,
  storageAllows,
  storageQuotaBytes,
  storageFileEtag,
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

it('defines storage transfer compression policy and negotiates encodings', () => {
  expect(STORAGE_COMPRESSION_MIN_BYTES).toBe(1024)
  for (const mime of ['text/plain; charset=utf-8', 'application/json', 'application/javascript',
    'image/svg+xml', 'application/xml', 'application/manifest+json', 'application/wasm'])
    expect(isStorageCompressible(mime)).toBe(true)
  for (const mime of ['image/png', 'video/mp4', 'audio/mpeg', 'application/zip', 'application/octet-stream'])
    expect(isStorageCompressible(mime)).toBe(false)
  expect(storageContentEncoding('gzip;q=1, br;q=0.5')).toBe('gzip')
  expect(storageContentEncoding('gzip, br')).toBe('br')
  expect(storageContentEncoding('br;q=0, *;q=.4')).toBe('gzip')
  expect(storageContentEncoding('br;q=0, gzip;q=0')).toBeUndefined()
})

it('defines batch paths and the exact small-text content boundary', () => {
  expect(STORAGE_REST.batch('a/b')).toBe('/api/storage/spaces/a%2Fb/batch')
  expect(FILE_STORAGE_NODE_PATHS.copy('a/b')).toBe('/v1/blobs/a%2Fb/copy')
  expect(MAX_STORAGE_BATCH_OPERATIONS).toBe(500)
  expect(MAX_STORAGE_INLINE_BYTES).toBe(262144)
  expect(isStorageSmallText({ size: 262144, mimeType: 'text/plain; charset=utf-8' })).toBe(true)
  expect(isStorageSmallText({ size: 262145, mimeType: 'text/plain' })).toBe(false)
  expect(isStorageSmallText({ size: 1, mimeType: 'application/octet-stream' })).toBe(false)
  expect(isStorageSmallText({ size: 1, mimeType: 'application/manifest+json' })).toBe(true)
})

it('defines revision validators and range error status', () => {
  expect(storageFileEtag('space/id', 7)).toBe('"space/id:7"')
  expect(STORAGE_ERROR_STATUS.range_not_satisfiable).toBe(416)
})

it('defines resumable upload URLs and limits without changing file URLs', () => {
  expect(DEFAULT_STORAGE_PART_SIZE).toBe(8 * 1024 * 1024)
  expect(MAX_STORAGE_UPLOAD_PARTS).toBe(10_000)
  expect(STORAGE_UPLOAD_TTL_MS).toBe(86_400_000)
  const base = '/api/storage/spaces/s%2F1/uploads'
  expect(STORAGE_REST.uploads('s/1')).toBe(base)
  expect(STORAGE_REST.upload('s/1', 'u/2')).toBe(base + '/u%2F2')
  expect(STORAGE_REST.uploadPart('s/1', 'u/2', 0)).toBe(base + '/u%2F2/parts/0')
  expect(STORAGE_REST.uploadComplete('s/1', 'u/2')).toBe(base + '/u%2F2/complete')
})

describe('file storage contract', () => {
  it('keeps the chat limit and metadata names stable for raw and multipart clients', () => {
    expect(MAX_CHAT_UPLOAD_BYTES).toBe(32 * 1024 * 1024)
    expect(CHAT_UPLOAD_METADATA_HEADERS).toEqual({
      name: 'name', conversationId: 'conversationid', agentId: 'agentid', mimeType: 'mimetype',
    })
  })
  it('defaults streaming files to 1 GiB and validates configured limits', () => {
    expect(MAX_STORAGE_FILE_BYTES).toBe(1024 ** 3)
    expect(MAX_STORAGE_PART_BYTES).toBe(64 * 1024 ** 2)
    expect(MAX_STORAGE_BATCH_BYTES).toBe(MAX_STORAGE_PART_BYTES)
    expect(storageMaxFileBytes()).toBe(MAX_STORAGE_FILE_BYTES)
    expect(storageMaxFileBytes('209715200')).toBe(209715200)
    for (const value of ['', '0', '-1', '1.5', 'Infinity', 'NaN', '9007199254740992'])
      expect(() => storageMaxFileBytes(value)).toThrow('VC_FILE_STORAGE_MAX_FILE_BYTES')
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

  it('publishes the thumbnail route, supported sizes and HTTP media error', () => {
    expect(STORAGE_REST.thumbnail('space / one')).toBe('/api/storage/spaces/space%20%2F%20one/thumbnail')
    expect(STORAGE_THUMBNAIL_SIZES).toEqual([128, 256, 512])
    expect(STORAGE_ERROR_STATUS.unsupported_media_type).toBe(415)
  })
})

it('exposes encoded direct URL and commit routes', () => {
  expect(STORAGE_REST.fileUrl('a/b')).toBe('/api/storage/spaces/a%2Fb/file/url')
  expect(STORAGE_REST.fileCommit('a/b')).toBe('/api/storage/spaces/a%2Fb/file/commit')
})

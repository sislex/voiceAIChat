import Fastify from 'fastify'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createFileStorageService } from '../../../../packages/file-storage/src/service.js'
import { StorageServiceError } from '../../../../packages/file-storage/src/errors.js'
import { registerFileStorageRoutes } from './routes.js'
import { VoiceChatDb } from '../db/database.js'
import sharp from 'sharp'
import { createThumbnailGenerator } from './thumbnail.js'
import { Readable } from 'node:stream'
import { brotliDecompressSync, gzipSync } from 'node:zlib'

let db: VoiceChatDb
let app: import('fastify').FastifyInstance
let capacity = 60e9
let quota = 100
let nodeOpens = 0
const generateThumbnail = vi.fn(createThumbnailGenerator())
const blobs = new Map<string, Uint8Array>()
beforeEach(async () => {
  db = new VoiceChatDb(':memory:'); await db.ready
  capacity = 60e9; quota = 100; nodeOpens = 0; blobs.clear(); generateThumbnail.mockClear()
  const service = createFileStorageService({metadata: db.storageMetadata(), now: Date.now, newId: randomUUID,
    quota: async () => quota,
    nodeInfo: () => [10e9, capacity].map((capacityBytes, i) => ({id: String(i), capacityBytes, usedBytes: 0, online: true, lastSeenAt: 1})),
    nodes: () => [0, 1].map(i => ({id: String(i), health: async () => { throw Error('unused') },
      copy: async (source, target) => { const bytes = blobs.get(source); if (!bytes) throw new StorageServiceError('not_found'); blobs.set(target, bytes.slice()) },
      put: async (id, bytes) => { if (bytes.length > capacity) throw new StorageServiceError('storage_full'); blobs.set(id, bytes) },
      get: async id => { const value = blobs.get(id); if (!value) throw new StorageServiceError('not_found'); return value },
      open: async (id, range) => {
        nodeOpens++
        const value = blobs.get(id); if (!value) throw new StorageServiceError('not_found')
        let start = 0, end = value.length - 1
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range)!
          if (match[1] === '') start = Math.max(0, value.length - Number(match[2]))
          else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])) }
        }
        const bytes = value.slice(start, end + 1)
        return {stream: Readable.from(bytes), contentLength: bytes.length,
          ...(range ? {contentRange: `bytes ${start}-${end}/${value.length}`} : {})}
      },
      delete: async id => {blobs.delete(id)} })),
    thumbnail: generateThumbnail,
  })
  app = Fastify()
  app.addHook('onRequest', async req => {
    const name = req.headers.authorization
    if (name) req.user = {name, role: name === 'owner' ? 'admin' : 'developer'}
  })
  registerFileStorageRoutes(app, service)
  await app.ready()
})
afterEach(async () => {await app.close(); await db.close()})
const call = (method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE', url: string, user = 'owner', payload?: object|string, headers = {}) =>
  app.inject({method, url, payload, headers: {...(user ? {authorization: user} : {}), ...headers}})
const space = async () => (await call('POST', '/api/storage/spaces', 'owner', {kind: 'personal', title: 'Files'})).json().id as string

it('revalidates revisions without reading the node and streams single byte ranges', async () => {
  const id = await space(), base = `/api/storage/spaces/${id}/file?path=video.mp4`
  await call('PUT', base, 'owner', '0123456789', {'content-type': 'video/mp4'})
  const first = await call('GET', base)
  expect(first.statusCode).toBe(200)
  expect(first.headers).toMatchObject({etag: `"${id}:1"`, 'accept-ranges': 'bytes',
    'cache-control': 'private, no-cache', 'content-type': 'video/mp4', 'content-length': '10'})
  expect(first.headers['last-modified']).toBeTruthy()
  const opens = nodeOpens
  const cached = await call('GET', base, 'owner', undefined, {'if-none-match': first.headers.etag})
  expect(cached.statusCode).toBe(304)
  expect(cached.rawPayload).toHaveLength(0)
  expect(nodeOpens).toBe(opens)
  const dated = await call('GET', base, 'owner', undefined, {'if-modified-since': first.headers['last-modified']})
  expect(dated.statusCode).toBe(304)
  const range = await call('GET', base, 'owner', undefined, {range: 'bytes=3-6'})
  expect(range.statusCode).toBe(206)
  expect(range.body).toBe('3456')
  expect(range.headers).toMatchObject({'content-range': 'bytes 3-6/10', 'content-length': '4', 'accept-ranges': 'bytes'})
  const unsatisfied = await call('GET', base, 'owner', undefined, {range: 'bytes=10-'})
  expect(unsatisfied.statusCode).toBe(416)
  expect(unsatisfied.headers['content-range']).toBe('bytes */10')
  await call('PUT', base, 'owner', 'next', {'content-type': 'video/mp4'})
  const changed = await call('GET', base, 'owner', undefined, {'if-none-match': first.headers.etag})
  expect(changed.statusCode).toBe(200)
  expect(changed.headers.etag).toBe(`"${id}:2"`)
})

it('compresses eligible full file responses and leaves binary and ranges untouched', async () => {
  quota = 100_000
  const id = await space(), base = `/api/storage/spaces/${id}/file?path=`
  const text = 'compressible text '.repeat(300)
  await call('PUT', base + 'notes.txt', 'owner', text, {'content-type': 'text/plain'})
  const compressed = await call('GET', base + 'notes.txt', 'owner', undefined, {'accept-encoding': 'gzip;q=.5, br'})
  expect(compressed.headers).toMatchObject({'content-encoding': 'br', vary: 'Accept-Encoding'})
  expect(compressed.headers['content-length']).toBeUndefined()
  expect(brotliDecompressSync(compressed.rawPayload).toString()).toBe(text)

  const range = await call('GET', base + 'notes.txt', 'owner', undefined, {range: 'bytes=0-15', 'accept-encoding': 'br'})
  expect(range.headers['content-encoding']).toBeUndefined()
  expect(range.headers.vary).toBe('Accept-Encoding')
  expect(range.body).toBe(text.slice(0, 16))

  const binary = Buffer.alloc(4096, 7)
  await call('PUT', base + 'photo.png', 'owner', binary as unknown as object, {'content-type': 'image/png'})
  const untouched = await call('GET', base + 'photo.png', 'owner', undefined, {'accept-encoding': 'br'})
  expect(untouched.headers['content-encoding']).toBeUndefined()
  expect(untouched.rawPayload).toEqual(binary)
})

it('accepts compressed uploads and limits their decompressed size', async () => {
  quota = 100_000
  const id = await space(), url = `/api/storage/spaces/${id}/file?path=compressed.txt`
  const text = 'uploaded text '.repeat(300)
  const accepted = await app.inject({method: 'PUT', url, headers: {authorization: 'owner',
    'content-type': 'text/plain', 'content-encoding': 'gzip'}, payload: gzipSync(text)})
  expect(accepted.statusCode, accepted.body).toBe(200)
  expect((await call('GET', url)).body).toBe(text)

  const oversized = await app.inject({method: 'PUT', url, headers: {authorization: 'owner',
    'content-type': 'text/plain', 'content-encoding': 'gzip'}, payload: gzipSync(Buffer.alloc(64 * 1024 * 1024 + 1))})
  expect(oversized.statusCode).toBe(413)
  expect(oversized.json().error).toBe('file_too_large')
})

const batch = (base: string, operations: unknown[], payloads: unknown[] = [], user = 'owner') =>
  call('POST', base + '/batch', user, [{ operations }, ...payloads].map(p => JSON.stringify(p)).join('\n'), { 'content-type': 'application/x-ndjson' })
const results = (body: string) => body.split('\r\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line))
it('executes mixed batches in order, reports independent failures and inlines small text', async () => {
  const base = '/api/storage/spaces/' + await space()
  const response = await batch(base, [
    { op: 'write', path: 'a', bodyRef: 'a', createOnly: true },
    { op: 'copy', path: 'a', to: 'b', createOnly: true },
    { op: 'write', path: 'a', bodyRef: 'a', ifMatch: 9 },
    { op: 'read', path: 'missing' },
    { op: 'move', path: 'b', to: 'c' },
    { op: 'read', path: 'c' },
    { op: 'delete', path: 'a', ifMatch: 9 },
    { op: 'delete', path: 'a', ifMatch: 1 },
  ], [{ bodyRef: 'a', base64: 'aGk=', mimeType: 'text/plain' }])
  expect(response.statusCode).toBe(200)
  expect(response.headers['content-type']).toContain('multipart/mixed')
  const rows = results(response.body)
  expect(rows.map(r => r.status)).toEqual([200, 200, 409, 404, 200, 200, 409, 204])
  expect(rows[5].content).toEqual({ encoding: 'base64', data: 'aGk=' })
  expect((await call('GET', base + '/files?withContent=small')).json().entries).toEqual([
    expect.objectContaining({ path: 'c', content: { encoding: 'base64', data: 'aGk=' } }),
  ])
  expect((await call('GET', base + '/files')).json().entries[0].content).toBeUndefined()
})

it('compresses eligible inline batch reads and declares the representation', async () => {
  quota = 100_000
  const base = '/api/storage/spaces/' + await space()
  const text = 'batch text '.repeat(300)
  await call('PUT', base + '/file?path=large.txt', 'owner', text, {'content-type': 'text/plain'})
  const payload = JSON.stringify({operations: [{op: 'read', path: 'large.txt'}]})
  const response = await call('POST', base + '/batch', 'owner', payload,
    {'content-type': 'application/x-ndjson', 'accept-encoding': 'br'})
  expect(response.headers.vary).toBe('Accept-Encoding')
  const content = results(response.body)[0].content
  expect(content.contentEncoding).toBe('br')
  expect(brotliDecompressSync(Buffer.from(content.data, 'base64')).toString()).toBe(text)
})

it('prechecks quota before mutation and rejects malformed/oversized operation lists', async () => {
  const base = '/api/storage/spaces/' + await space()
  quota = 3
  expect((await batch(base, [{ op: 'write', path: 'a', bodyRef: 'a' }, { op: 'copy', path: 'a', to: 'b' }],
    [{ bodyRef: 'a', base64: 'aGk=', mimeType: 'text/plain' }])).statusCode).toBe(413)
  expect((await call('GET', base + '/files')).json().entries).toEqual([])
  for (const operations of [[], Array.from({ length: 501 }, () => ({ op: 'read', path: 'a' }))])
    expect((await batch(base, operations)).statusCode).toBe(400)
  expect((await batch(base, [{ op: 'read', path: 'a' }], [{ bodyRef: 'x', base64: '!', mimeType: 'text/plain' }])).statusCode).toBe(400)
  expect((await batch(base, Array.from({ length: 500 }, () => ({ op: 'read', path: 'a' })))) .statusCode).toBe(200)
})

it('streams binary reads and enforces per-operation grants', async () => {
  const base = '/api/storage/spaces/' + await space()
  await call('PUT', base + '/file?path=bin', 'owner', 'binary', { 'content-type': 'application/octet-stream' })
  await call('POST', base + '/shares', 'owner', { userId: 'reader', permission: 'read' })
  const response = await batch(base, [{ op: 'read', path: 'bin' }, { op: 'delete', path: 'bin' }], [], 'reader')
  expect(results(response.body)).toEqual([
    expect.objectContaining({ status: 200, bodyRef: 'read-0' }),
    expect.objectContaining({ status: 403 }),
  ])
  expect(response.body).toContain('Content-Length: 6\r\n\r\nbinary\r\n')
  expect((await call('GET', base + '/files?withContent=small')).json().entries[0].content).toBeUndefined()
  expect((await batch(base, [{ op: 'read', path: 'bin' }], [], 'stranger')).statusCode).toBe(403)
})

it('registers every contract path with authentication, disabled errors and admin-only cluster', async () => {
  expect((await call('GET', '/api/storage/cluster')).json().capacityBytes).toBe(70e9)
  expect((await call('GET', '/api/storage/cluster', 'reader')).statusCode).toBe(403)
  for (const [method, url] of [
    ['GET','usage'], ['GET','cluster'], ['GET','spaces'], ['POST','spaces'],
    ['GET','spaces/s'], ['PATCH','spaces/s'], ['DELETE','spaces/s'], ['GET','spaces/s/files'], ['GET','spaces/s/file'],
    ['PUT','spaces/s/file'], ['DELETE','spaces/s/file'], ['POST','spaces/s/move'],
    ['GET','spaces/s/shares'], ['POST','spaces/s/shares'], ['DELETE','spaces/s/shares/a'],
    ['POST','spaces/s/merge-duplicates'],
    ['GET','links/token'], ['POST','links/token'],
  ] as const) expect((await call(method, '/api/storage/' + url, '')).statusCode).toBe(401)
  const disabled = Fastify()
  disabled.addHook('onRequest', async req => { req.user = {name: 'owner', role: 'admin'} })
  registerFileStorageRoutes(disabled)
  expect((await disabled.inject('/api/storage/usage')).json().error).toBe('storage_disabled')
  await disabled.close()
})

it('enforces owner/write/read/none on reads, mutations and share administration', async () => {
  const id = await space(), base = '/api/storage/spaces/' + id
  expect((await call('GET', '/api/storage/spaces')).json()).toHaveLength(1)
  expect((await call('GET', base)).json().access).toBe('owner')
  for (const user of ['reader', 'writer']) expect((await call('POST', base + '/shares', 'owner', {userId: user, permission: user === 'writer' ? 'write' : 'read'})).statusCode).toBe(200)
  for (const user of ['owner', 'writer', 'reader', 'none']) {
    const canRead = user !== 'none', canWrite = user === 'owner' || user === 'writer'
    expect((await call('PUT', base + '/file?path=a', user, 'hello', {'content-type':'text/plain'})).statusCode).toBe(canWrite ? 200 : 403)
    expect((await call('GET', base + '/files', user)).statusCode).toBe(canRead ? 200 : 403)
    expect((await call('GET', base + '/file?path=a', user)).statusCode).toBe(canRead ? 200 : 403)
    expect((await call('GET', base + '/shares', user)).statusCode).toBe(user === 'owner' ? 200 : 403)
    expect((await call('POST', base + '/move', user, {from: 'a', to: 'b'})).statusCode).toBe(canWrite ? 200 : 403)
    if (canWrite) await call('POST', base + '/move', user, {from: 'b', to: 'a'})
    expect((await call('DELETE', base + '/file?path=a', user)).statusCode).toBe(canWrite ? 204 : 403)
    if (canWrite) await call('PUT', base + '/file?path=a', user, 'hello', {'content-type':'text/plain'})
    if (user !== 'owner') {
      expect((await call('DELETE', base, user)).statusCode).toBe(403)
      expect((await call('POST', base + '/shares', user, {permission:'read'})).statusCode).toBe(403)
    }
  }
  expect((await call('DELETE', base)).statusCode).toBe(204)
  expect((await call('GET', base)).statusCode).toBe(404)
})

it('renames only as owner, preserving files, identity, ref and shares', async () => {
  const original = (await call('POST', '/api/storage/spaces', 'owner', { kind: 'make-project', ref: 'conversation', title: 'Before' })).json()
  const base = '/api/storage/spaces/' + original.id
  await call('PUT', base + '/file?path=index.html', 'owner', 'hello', { 'content-type': 'text/plain' })
  await call('POST', base + '/shares', 'owner', { userId: 'writer', permission: 'write' })
  await call('POST', base + '/shares', 'owner', { userId: 'reader', permission: 'read' })
  expect((await call('PATCH', base, 'reader', { title: 'Forbidden' })).statusCode).toBe(403)
  expect((await call('PATCH', base, 'owner', { title: 'x'.repeat(201) })).statusCode).toBe(400)
  expect((await call('PATCH', base, 'owner', { title: ' ' + 'x'.repeat(200) + ' ' })).statusCode).toBe(200)
  expect((await call('PATCH', base, 'owner', { title: 'x' })).statusCode).toBe(200)
  expect((await call('PATCH', base, 'writer', { title: 'Forbidden' })).statusCode).toBe(403)
  expect((await call('PATCH', base, 'other', { title: 'Forbidden' })).statusCode).toBe(403)
  expect((await call('PATCH', base, 'owner', { title: ' ' })).statusCode).toBe(400)
  expect((await call('PATCH', base, 'owner', { title: 1 })).statusCode).toBe(400)
  const updated = await call('PATCH', base, 'owner', { title: ' Renamed ', ref: 'forged', ownerId: 'other' })
  expect(updated.statusCode).toBe(200)
  expect(updated.json()).toMatchObject({ id: original.id, ownerId: 'owner', ref: 'conversation', title: 'Renamed', fileCount: 1 })
  expect((await call('GET', base + '/file?path=index.html', 'writer')).body).toBe('hello')
  expect((await call('GET', '/api/storage/spaces')).json()[0].title).toBe('Renamed')
})

it('exposes owner-only duplicate previews and validates apply requests', async () => {
  const original = (await call('POST', '/api/storage/spaces', 'owner', {kind: 'chat', ref: 'r', title: 'Chat'})).json()
  const base = '/api/storage/spaces/' + original.id
  for (const permission of ['read', 'write']) {
    await call('POST', base + '/shares', 'owner', {permission, userId: permission})
  }
  for (const user of ['read', 'write', 'none'])
    expect((await call('POST', base + '/merge-duplicates', user, {})).statusCode).toBe(403)
  const preview = await call('POST', base + '/merge-duplicates', 'owner', {})
  expect(preview.statusCode).toBe(200)
  expect(preview.json()).toMatchObject({dryRun: true, keepSpaceId: original.id})
  expect((await call('POST', base + '/merge-duplicates', 'owner', {dryRun: 'false'})).statusCode).toBe(400)
  expect((await call('POST', base + '/merge-duplicates', 'owner', {dryRun: false})).statusCode).toBe(409)
  expect((await call('POST', base + '/merge-duplicates', 'owner', {previewToken: preview.json().previewToken})).json()).toMatchObject({dryRun: false})
  expect((await call('POST', '/api/storage/spaces/' + await space() + '/merge-duplicates', 'owner', {})).statusCode).toBe(400)
})

it('merges three conflicting project spaces through HTTP and preserves every version', async () => {
  const original = (await call('POST', '/api/storage/spaces', 'owner', {kind: 'make-project', ref: 'cf2fda81', title: 'Проект 2'})).json()
  await db.storageMetadata().transaction(async tx => {
    for (const id of ['second', 'third']) await tx.putSpace({...original, id, createdAt: 0})
  })
  expect((await call('GET', '/api/storage/spaces')).json()[0].id).toBe(original.id)
  const put = async (id: string, path: string, bytes: string) => {
    expect((await call('PUT', '/api/storage/spaces/' + id + '/file?path=' + encodeURIComponent(path),
      'owner', bytes, {'content-type': 'text/plain'})).statusCode).toBe(200)
  }
  await put(original.id, 'app.js', 'app')
  await put(original.id, 'index.html', 'old')
  await put('second', 'index.html', 'new')
  await put('third', 'index.html', 'middle')
  await put('third', 'styles.css', 'styles')
  await db.storageMetadata().transaction(async tx => {
    for (const [id, updatedAt] of [[original.id, 1], ['second', 3], ['third', 2]] as const) {
      const entry = (await tx.getEntry(id, 'index.html'))!
      await tx.putEntry({...entry, updatedAt})
    }
  })
  const url = '/api/storage/spaces/' + original.id + '/merge-duplicates'
  const preview = (await call('POST', url, 'owner', {})).json()
  const applied = await call('POST', url, 'owner', {previewToken: preview.previewToken})
  expect(applied.statusCode, applied.body).toBe(200)
  expect(applied.json().dryRun).toBe(false)
  const spaces = (await call('GET', '/api/storage/spaces')).json()
  expect(spaces).toHaveLength(1)
  expect(spaces[0]).toMatchObject({id: preview.keepSpaceId, title: 'Проект 2', fileCount: 5})
  const base = '/api/storage/spaces/' + preview.keepSpaceId
  const entries = (await call('GET', base + '/files')).json().entries as {path: string}[]
  expect(entries.filter(e => !e.path.startsWith('.')).map(e => e.path)).toEqual(['app.js', 'index.html', 'styles.css'])
  expect((await call('GET', base + '/file?path=index.html')).body).toBe('new')
  const archived = await Promise.all(entries.filter(e => e.path.startsWith('.duplicates/'))
    .map(async e => (await call('GET', base + '/file?path=' + encodeURIComponent(e.path))).body))
  expect(archived.sort()).toEqual(['middle', 'old'])
  expect((await call('POST', '/api/storage/spaces', 'owner', {kind: 'make-project', ref: 'cf2fda81', title: 'Ignored'})).json().id).toBe(preview.keepSpaceId)
})

it('supports raw JSON bytes, conditional writes/downloads, quota and node exhaustion', async () => {
  const base = '/api/storage/spaces/' + await space()
  const file = base + '/file?path=a'
  expect((await call('PUT', file, 'owner', '{"a":1}', {'content-type':'application/json','if-none-match':'*'})).json().revision).toBe(1)
  expect((await call('GET', file)).body).toBe('{"a":1}')
  expect((await call('GET', file, 'owner', undefined, {'if-none-match':`"${base.split('/').at(-1)}:1"`})).statusCode).toBe(304)
  expect((await call('PUT', file, 'owner', 'x', {'content-type':'text/plain','if-none-match':'*'})).json().error).toBe('revision_conflict')
  expect((await call('PUT', file, 'owner', 'x', {'content-type':'text/plain','if-match':'"2"'})).json().error).toBe('revision_conflict')
  expect((await call('PUT', file, 'owner', 'x', {'content-type':'text/plain','if-match':'"1"'})).json().revision).toBe(2)
  quota = 1
  expect((await call('PUT', file + 'b', 'owner', 'xx', {'content-type':'text/plain'})).json().error).toBe('quota_exceeded')
  quota = 100; capacity = 1
  expect((await call('PUT', file + 'b', 'owner', 'xx', {'content-type':'text/plain'})).json().error).toBe('storage_full')
  expect((await call('GET', '/api/storage/usage')).json().usedBytes).toBe(1)
})

it('generates sized image thumbnails, caches them by revision and excludes them from quota', async () => {
  quota = 1_000_000
  const id = await space()
  const base = '/api/storage/spaces/' + id
  const file = base + '/file?path=photo.png'
  const source = await sharp({create:{width:800,height:400,channels:4,background:'#ff0000'}}).png().toBuffer()
  expect((await call('PUT', file, 'owner', source as unknown as object, {'content-type':'image/png'})).statusCode).toBe(200)
  const usage = (await call('GET', '/api/storage/usage')).json().usedBytes
  const url = base + '/thumbnail?path=photo.png&size=128'
  const first = await call('GET', url)
  expect(first.statusCode).toBe(200)
  expect(first.headers['content-type']).toContain('image/webp')
  expect(await sharp(first.rawPayload).metadata()).toMatchObject({width:128,height:64})
  const count = blobs.size
  expect((await call('GET', url)).rawPayload).toEqual(first.rawPayload)
  expect(blobs.size).toBe(count)
  expect(generateThumbnail).toHaveBeenCalledTimes(1)
  expect(first.headers['cache-control']).toBe('private, no-cache')
  for (const validator of [first.headers.etag, '*', `"other", W/${first.headers.etag}`]) {
    const cached = await call('GET', url, 'owner', undefined, {'if-none-match': validator})
    expect(cached.statusCode).toBe(304)
    expect(cached.headers.etag).toBe(first.headers.etag)
  }
  expect((await call('GET', url, 'owner', undefined, {'if-modified-since': first.headers['last-modified']})).statusCode).toBe(304)
  expect((await call('GET', url, 'owner', undefined, {'if-none-match': '"other"', 'if-modified-since': first.headers['last-modified']})).statusCode).toBe(200)
  expect((await call('GET', url, 'stranger', undefined, {'if-none-match': '*'})).statusCode).toBe(403)
  for (const size of [256, 512]) {
    const preview = await call('GET', base + '/thumbnail?path=photo.png&size=' + size)
    expect(preview.statusCode).toBe(200)
    expect(await sharp(preview.rawPayload).metadata()).toMatchObject({width: size, height: size / 2})
    expect(preview.headers.etag).not.toBe(first.headers.etag)
  }
  expect(generateThumbnail).toHaveBeenCalledTimes(3)
  const oldBlobIds = [...blobs.keys()]
  expect((await call('GET', '/api/storage/usage')).json().usedBytes).toBe(usage)
  const replacement = await sharp({create:{width:200,height:800,channels:4,background:'#00ff00'}}).png().toBuffer()
  await call('PUT', file, 'owner', replacement as unknown as object, {'content-type':'image/png'})
  expect(oldBlobIds.every(id => !blobs.has(id))).toBe(true)
  const changed = await call('GET', url)
  expect(generateThumbnail).toHaveBeenCalledTimes(4)
  expect(changed.headers.etag).not.toBe(first.headers.etag)
  expect(await sharp(changed.rawPayload).metadata()).toMatchObject({width:32,height:128})
  expect((await call('GET', base + '/thumbnail?path=photo.png&size=42')).statusCode).toBe(400)
  expect((await call('DELETE', file)).statusCode).toBe(204)
  expect(blobs.size).toBe(0)
})

it('rejects thumbnails for non-images', async () => {
  const base = '/api/storage/spaces/' + await space()
  await call('PUT', base + '/file?path=notes.txt', 'owner', 'hello', {'content-type':'text/plain'})
  expect((await call('GET', base + '/thumbnail?path=notes.txt&size=128')).statusCode).toBe(415)
})

it('caches JPEG fallback when the WebP encoder fails', async () => {
  quota = 1_000_000
  const base = '/api/storage/spaces/' + await space()
  const bytes = await sharp({create: {width: 300, height: 150, channels: 3, background: 'red'}}).png().toBuffer()
  await call('PUT', base + '/file?path=image', 'owner', bytes as unknown as object, {'content-type': 'image/png'})
  const encoder = vi.spyOn(sharp.prototype, 'webp').mockImplementationOnce(() => { throw new Error('WebP unavailable') })
  try {
    const url = base + '/thumbnail?path=image&size=128'
    const response = await call('GET', url)
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('image/jpeg')
    expect(await sharp(response.rawPayload).metadata()).toMatchObject({format: 'jpeg', width: 128, height: 64})
    expect((await call('GET', url)).rawPayload).toEqual(response.rawPayload)
    expect(generateThumbnail).toHaveBeenCalledTimes(1)
    await call('DELETE', base + '/file?path=image')
    expect(blobs.size).toBe(0)
  } finally { encoder.mockRestore() }
})

it('rejects corrupt and disguised unsupported images with 415', async () => {
  quota = 1_000_000
  const base = '/api/storage/spaces/' + await space()
  for (const bytes of [Buffer.from('not an image'), await sharp({create: {width: 10, height: 10, channels: 3, background: 'red'}}).tiff().toBuffer()]) {
    await call('PUT', base + '/file?path=fake.png', 'owner', bytes as unknown as object, {'content-type': 'image/png'})
    expect((await call('GET', base + '/thumbnail?path=fake.png&size=128')).statusCode).toBe(415)
    expect(blobs.size).toBe(1)
  }
})

it('accepts JPEG, WebP and GIF sources', async () => {
  quota = 1_000_000
  const base = '/api/storage/spaces/' + await space()
  for (const format of ['jpeg', 'webp', 'gif'] as const) {
    const bytes = await sharp({create: {width: 300, height: 600, channels: 3, background: 'blue'}}).toFormat(format).toBuffer()
    await call('PUT', base + '/file?path=image', 'owner', bytes as unknown as object, {'content-type': 'image/' + format})
    const response = await call('GET', base + '/thumbnail?path=image&size=256')
    expect(response.statusCode).toBe(200)
    expect(await sharp(response.rawPayload).metadata()).toMatchObject({width: 128, height: 256})
  }
})

it('rejects oversized raw bodies with the contract error', async () => {
  const id = await space()
  const response = await app.inject({method:'PUT', url:'/api/storage/spaces/' + id + '/file?path=large',
    headers:{authorization:'owner', 'content-type':'application/octet-stream'}, payload:Buffer.alloc(64 * 1024 * 1024 + 1)})
  expect(response.statusCode).toBe(413)
  expect(response.json().error).toBe('file_too_large')
})

it('accepts links only for signed-in users and revokes access immediately', async () => {
  const base = '/api/storage/spaces/' + await space()
  const share = (await call('POST', base + '/shares', 'owner', {permission:'write'})).json()
  const link = '/api/storage/links/' + share.audience.token
  expect((await call('GET', link, 'reader')).json().permission).toBe('write')
  expect((await call('POST', link, '')).statusCode).toBe(401)
  expect((await call('POST', link, 'reader')).json().access).toBe('write')
  expect((await call('GET', '/api/storage/spaces', 'reader')).json()).toHaveLength(1)
  expect((await call('DELETE', base + '/shares/' + share.id, 'reader')).statusCode).toBe(403)
  expect((await call('DELETE', base + '/shares/' + share.id)).statusCode).toBe(204)
  expect((await call('GET', base, 'reader')).statusCode).toBe(403)
  expect((await call('POST', link, 'reader')).statusCode).toBe(404)
})

import Fastify from 'fastify'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createFileStorageService } from '../../../../packages/file-storage/src/service.js'
import { StorageServiceError } from '../../../../packages/file-storage/src/errors.js'
import { registerFileStorageRoutes } from './routes.js'
import { VoiceChatDb } from '../db/database.js'

let db: VoiceChatDb
let app: import('fastify').FastifyInstance
let capacity = 60e9
let quota = 100
let direct = false
const blobs = new Map<string, Uint8Array>()
beforeEach(async () => {
  db = new VoiceChatDb(':memory:'); await db.ready
  capacity = 60e9; quota = 100; direct = false; blobs.clear()
  const service = createFileStorageService({metadata: db.storageMetadata(), now: Date.now, newId: randomUUID,
    quota: async () => quota,
    directNode: () => direct ? { publicUrl: 'https://node.test', secret: 's'.repeat(32) } : undefined,
    nodeInfo: () => [10e9, capacity].map((capacityBytes, i) => ({id: String(i), capacityBytes, usedBytes: 0, online: true, lastSeenAt: 1})),
    nodes: () => [0, 1].map(i => ({id: String(i), health: async () => { throw Error('unused') },
      put: async (id, bytes) => { if (bytes.length > capacity) throw new StorageServiceError('storage_full'); blobs.set(id, bytes) },
      stat: async id => { const b = blobs.get(id); if (!b) throw new StorageServiceError('not_found'); return { size: b.length } },
      get: async id => blobs.get(id)!, delete: async id => {blobs.delete(id)} })),
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

it('persists direct reservations in SQL and exposes bytes only after authenticated commit', async () => {
  direct = true
  quota = 5
  const id = await space(), base = '/api/storage/spaces/' + id
  const request = { operation: 'write', path: 'a', size: 5, mimeType: 'text/plain', createOnly: true }
  expect((await call('POST', base + '/file/url', 'none', request)).statusCode).toBe(403)
  const response = await call('POST', base + '/file/url', 'owner', request)
  expect(response.statusCode).toBe(200)
  expect(response.headers['cache-control']).toBe('no-store')
  const { reservationId } = response.json()
  expect(await db.storageMetadata().transaction(tx => tx.listReservations())).toHaveLength(1)
  expect((await call('GET', base + '/files')).json().entries).toEqual([])
  expect((await call('POST', base + '/file/url', 'owner', { ...request, path: 'b' })).statusCode).toBe(413)
  expect((await call('POST', base + '/file/commit', 'owner', { reservationId })).statusCode).toBe(404)
  blobs.set(reservationId, Buffer.from('hello'))
  expect((await call('POST', base + '/file/commit', 'none', { reservationId })).statusCode).toBe(403)
  const committed = await call('POST', base + '/file/commit', 'owner', { reservationId })
  expect(committed.statusCode).toBe(200)
  expect(committed.json()).toMatchObject({ path: 'a', revision: 1, size: 5 })
  expect((await call('GET', base + '/file?path=a')).body).toBe('hello')
  expect(await db.storageMetadata().transaction(tx => tx.listReservations())).toEqual([])
})
it('returns an authenticated Core fallback URL which commits via the existing PUT', async () => {
  const id = await space(), base = '/api/storage/spaces/' + id
  const response = await call('POST', base + '/file/url', 'owner', { operation: 'write', path: 'a', size: 5, mimeType: 'text/plain', createOnly: true })
  const u = response.json()
  expect(u).toMatchObject({ url: base + '/file?path=a', method: 'PUT', headers: { 'if-none-match': '*' } })
  expect(u.reservationId).toBeUndefined()
  expect((await call('PUT', u.url, 'owner', 'hello', u.headers)).statusCode).toBe(200)
  expect((await call('PUT', u.url, 'owner', 'hello', u.headers)).statusCode).toBe(409)
  expect((await call('POST', base + '/file/url', 'owner', { operation: 'read', path: 'a' })).json()).toMatchObject({ url: u.url, method: 'GET' })
})
it('registers every contract path with authentication, disabled errors and admin-only cluster', async () => {
  expect((await call('GET', '/api/storage/cluster')).json().capacityBytes).toBe(70e9)
  expect((await call('GET', '/api/storage/cluster', 'reader')).statusCode).toBe(403)
  for (const [method, url] of [
    ['GET','usage'], ['GET','cluster'], ['GET','spaces'], ['POST','spaces'],
    ['GET','spaces/s'], ['PATCH','spaces/s'], ['DELETE','spaces/s'], ['GET','spaces/s/files'], ['GET','spaces/s/file'],
    ['PUT','spaces/s/file'], ['DELETE','spaces/s/file'], ['POST','spaces/s/move'],
    ['GET','spaces/s/shares'], ['POST','spaces/s/shares'], ['DELETE','spaces/s/shares/a'],
    ['POST','spaces/s/merge-duplicates'], ['POST','spaces/s/file/url'], ['POST','spaces/s/file/commit'],
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
  expect((await call('GET', file, 'owner', undefined, {'if-none-match':'"1"'})).statusCode).toBe(304)
  expect((await call('PUT', file, 'owner', 'x', {'content-type':'text/plain','if-none-match':'*'})).json().error).toBe('revision_conflict')
  expect((await call('PUT', file, 'owner', 'x', {'content-type':'text/plain','if-match':'"2"'})).json().error).toBe('revision_conflict')
  expect((await call('PUT', file, 'owner', 'x', {'content-type':'text/plain','if-match':'"1"'})).json().revision).toBe(2)
  quota = 1
  expect((await call('PUT', file + 'b', 'owner', 'xx', {'content-type':'text/plain'})).json().error).toBe('quota_exceeded')
  quota = 100; capacity = 1
  expect((await call('PUT', file + 'b', 'owner', 'xx', {'content-type':'text/plain'})).json().error).toBe('storage_full')
  expect((await call('GET', '/api/storage/usage')).json().usedBytes).toBe(1)
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


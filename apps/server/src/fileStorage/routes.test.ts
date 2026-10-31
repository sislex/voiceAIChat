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
const blobs = new Map<string, Uint8Array>()
beforeEach(async () => {
  db = new VoiceChatDb(':memory:'); await db.ready
  capacity = 60e9; quota = 100; blobs.clear()
  const service = createFileStorageService({metadata: db.storageMetadata(), now: Date.now, newId: randomUUID,
    quota: async () => quota,
    nodeInfo: () => [10e9, capacity].map((capacityBytes, i) => ({id: String(i), capacityBytes, usedBytes: 0, online: true, lastSeenAt: 1})),
    nodes: () => [0, 1].map(i => ({id: String(i), health: async () => { throw Error('unused') },
      put: async (id, bytes) => { if (bytes.length > capacity) throw new StorageServiceError('storage_full'); blobs.set(id, bytes) },
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

it('registers every contract path with authentication, disabled errors and admin-only cluster', async () => {
  expect((await call('GET', '/api/storage/cluster')).json().capacityBytes).toBe(70e9)
  expect((await call('GET', '/api/storage/cluster', 'reader')).statusCode).toBe(403)
  for (const [method, url] of [
    ['GET','usage'], ['GET','cluster'], ['GET','spaces'], ['POST','spaces'],
    ['GET','spaces/s'], ['PATCH','spaces/s'], ['DELETE','spaces/s'], ['GET','spaces/s/files'], ['GET','spaces/s/file'],
    ['PUT','spaces/s/file'], ['DELETE','spaces/s/file'], ['POST','spaces/s/move'],
    ['GET','spaces/s/shares'], ['POST','spaces/s/shares'], ['DELETE','spaces/s/shares/a'],
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


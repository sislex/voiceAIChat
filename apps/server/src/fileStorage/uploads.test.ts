import { signDirect, verifyDirect } from '../../../../packages/file-storage/src/direct.js'
import { STORAGE_REST } from '@voicechat/shared/fileStorage'
import Fastify from 'fastify'
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createStorageNodeServer } from '../../../../packages/file-storage/src/node/server.js'
import { createStorageNodeClient } from '../../../../packages/file-storage/src/client.js'
import { createFileStorageService } from '../../../../packages/file-storage/src/service.js'
import { VoiceChatDb } from '../db/database.js'
import { registerFileStorageRoutes } from './routes.js'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn() })
async function fixture(quota = 100, direct = false) {
  const root = await mkdtemp(join(tmpdir(), 'storage-upload-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const tokenFile = join(root, 'token'); await writeFile(tokenFile, 'test')
  const secret = 'test-direct-secret-32-characters-long'
  const options = {directSecret: secret, allowedOrigins: ['https://ui.example'], nodeId: 'node', directory: join(root, 'blobs'), tokenFile, capacityBytes: 1000}
  let node = await createStorageNodeServer(options)
  cleanups.push(() => node.close())
  const client = createStorageNodeClient({id: 'node', url: 'http://localhost', token: 'test',
    fetchImpl: async (url, init) => {
      const response = await node.inject({method: init!.method as 'GET' | 'POST' | 'PUT' | 'DELETE',
        url: new URL(String(url)).pathname, headers: init!.headers as Record<string, string>, payload: init!.body as Buffer})
      return new Response(response.statusCode === 204 ? null : response.rawPayload, {status: response.statusCode})
    },
  })
  const db = new VoiceChatDb(':memory:'); await db.ready
  cleanups.push(() => db.close())
  let now = Date.now()
  const ports = {directNode: () => direct ? {publicUrl: 'https://node.example', secret} : undefined, metadata: db.storageMetadata(), nodes: () => [client],
    nodeInfo: () => [{id: 'node', online: true, capacityBytes: 1000, usedBytes: 0, lastSeenAt: now}],
    quota: async () => quota, now: () => now, newId: randomUUID, partSize: 3}
  let service = createFileStorageService(ports)
  const space = await service.createSpace('owner', {kind: 'personal', title: 'Test'})
  const app = Fastify()
  app.addHook('onRequest', async req => { if (req.headers.authorization) req.user = {name: req.headers.authorization, role: 'admin'} })
  registerFileStorageRoutes(app, service)
  cleanups.push(() => app.close())
  const call = (method: 'GET'|'POST'|'PUT'|'DELETE', suffix: string, payload?: object | string, user = 'owner') =>
    app.inject({method, url: `/api/storage/spaces/${space.id}/uploads${suffix}`, payload,
      headers: {authorization: user, ...(typeof payload === 'string' ? {'content-type': 'application/octet-stream'} : {})}})
  const create = async (size = 8) => {
    const r = await call('POST', '', {path: 'file', size, mimeType: 'text/plain'})
    expect(r.statusCode).toBe(200)
    return r.json().uploadId as string
  }
  const fileUrl = (operation: 'read' | 'write', extra = {}, user = 'owner') => app.inject({
    method: 'POST', url: STORAGE_REST.fileUrl(space.id), headers: {authorization: user},
    payload: {operation, path: 'file', ...(operation === 'write' ? {size: 3, mimeType: 'text/plain'} : {}), ...extra},
  })
  const commit = (uploadId: string, user = 'owner') => app.inject({
    method: 'POST', url: STORAGE_REST.fileCommit(space.id), headers: {authorization: user}, payload: {uploadId},
  })
  const transfer = (url: string, method: 'GET' | 'PUT' | 'OPTIONS', payload?: string, headers = {}) => {
    const parsed = new URL(url)
    return node.inject({method, url: parsed.pathname + parsed.search, payload,
      headers: {'content-type': 'text/plain', origin: 'https://ui.example', ...headers}})
  }
  return {root, db, call, create, client, space, fileUrl, commit, transfer, secret, get service() { return service }, advance() { now += 86_400_001 },
    async restart() { await node.close(); node = await createStorageNodeServer(options); service = createFileStorageService(ports) }}
}

it('resumes persisted sessions across node/coordinator restart, accepts parallel out-of-order parts and publishes atomically', async () => {
  const f = await fixture(); const id = await f.create()
  expect((await f.call('PUT', `/${id}/parts/2`, 'gh')).statusCode).toBe(204)
  expect((await f.service.listEntries('owner', f.space.id)).entries).toEqual([])
  expect((await f.call('POST', `/${id}/complete`)).statusCode).toBe(409)
  await f.restart()
  expect((await f.service.getUpload('owner', f.space.id, id)).receivedParts).toEqual([2])
  const replies = await Promise.all([f.call('PUT', `/${id}/parts/1`, 'def'), f.call('PUT', `/${id}/parts/0`, 'abc')])
  expect(replies.map(r => r.statusCode)).toEqual([204, 204])
  expect((await f.call('PUT', `/${id}/parts/0`, 'abc')).statusCode).toBe(204)
  expect((await f.call('GET', `/${id}`)).json().receivedParts).toEqual([0, 1, 2])
  expect((await f.call('POST', `/${id}/complete`)).statusCode).toBe(200)
  expect(Buffer.from((await f.service.readFile('owner', f.space.id, 'file')).bytes).toString()).toBe('abcdefgh')
  expect(await readdir(join(f.root, 'blobs', '.uploads'))).toEqual([])
  expect((await f.client.health()).usedBytes).toBe(8)
})

it('reserves node capacity before receiving bytes and rejects oversized session manifests', async () => {
  const f = await fixture(2000)
  expect((await f.call('POST', '', {path: 'large', size: 501, mimeType: 'text/plain'})).statusCode).toBe(507)
  expect((await f.call('POST', '', {path: 'many', size: 30_001, mimeType: 'text/plain'})).statusCode).toBe(400)
  const id = await f.create(500)
  expect((await f.client.health()).freeBytes).toBe(0)
  expect((await f.call('POST', '', {path: 'other', size: 1, mimeType: 'text/plain'})).statusCode).toBe(507)
  await f.call('DELETE', `/${id}`)
  expect((await f.client.health()).freeBytes).toBe(1000)
})

it('reserves quota at creation against other sessions and ordinary writes; abort releases parts and reservations', async () => {
  const f = await fixture(8); const id = await f.create()
  expect((await f.call('POST', '', {path: 'other', size: 1, mimeType: 'text/plain'})).statusCode).toBe(413)
  await expect(f.service.writeFile('owner', f.space.id, 'other', Buffer.from('a'))).rejects.toMatchObject({code: 'quota_exceeded'})
  await f.call('PUT', `/${id}/parts/0`, 'abc')
  expect((await f.call('DELETE', `/${id}`)).statusCode).toBe(204)
  expect((await f.client.health()).usedBytes).toBe(0)
  expect(await readdir(join(f.root, 'blobs', '.uploads'))).toEqual([])
  expect((await f.call('GET', `/${id}`)).statusCode).toBe(404)
  await f.create()
})

it('rejects foreign sessions, bad part lengths and stale revisions; expires sessions and handles empty files', async () => {
  const f = await fixture(); const id = await f.create()
  expect((await f.call('GET', `/${id}`, undefined, 'other')).statusCode).toBe(403)
  expect((await f.call('PUT', `/${id}/parts/0`, 'a')).statusCode).toBe(400)
  expect((await f.call('PUT', `/${id}/parts/-1`, 'abc')).statusCode).toBe(400)
  f.advance(); await f.service.expireUploads()
  expect((await f.client.health()).usedBytes).toBe(0)
  expect((await f.call('GET', `/${id}`)).statusCode).toBe(404)
  const empty = await fixture(); const emptyId = await empty.create(0)
  expect((await empty.call('POST', `/${emptyId}/complete`)).statusCode).toBe(200)
  expect((await empty.service.readFile('owner', empty.space.id, 'file')).bytes).toHaveLength(0)
  const r = await empty.call('POST', '', {path: 'file', size: 3, mimeType: 'text/plain', ifMatch: 1})
  const replacement = r.json().uploadId
  await empty.call('PUT', `/${replacement}/parts/0`, 'abc')
  await empty.service.writeFile('owner', empty.space.id, 'file', Buffer.from('new'))
  expect((await empty.call('POST', `/${replacement}/complete`)).statusCode).toBe(409)
})

it('direct PUT survives restart, stays invisible until commit, then reads ranges without Core bytes', async () => {
  const f = await fixture(100, true)
  const response = await f.fileUrl('write')
  expect(response.statusCode).toBe(200)
  const link = response.json()
  expect(link).toMatchObject({method: 'PUT', headers: {'content-type': 'text/plain'}})
  expect(link.expiresAt - Date.now()).toBeLessThanOrEqual(300_000)
  expect((await f.commit(link.uploadId)).statusCode).toBe(409)
  expect((await f.transfer(link.url, 'OPTIONS')).headers['access-control-allow-origin']).toBe('https://ui.example')
  expect((await f.transfer(link.url, 'PUT', 'abc')).statusCode).toBe(204)
  expect((await f.service.listEntries('owner', f.space.id)).entries).toEqual([])
  await f.restart()
  expect((await f.commit(link.uploadId, 'other')).statusCode).toBe(403)
  expect((await f.commit(link.uploadId)).json()).toMatchObject({path: 'file', size: 3, revision: 1})
  expect((await f.transfer(link.url, 'PUT', 'bad')).statusCode).toBe(404)
  const read = (await f.fileUrl('read')).json()
  const range = await f.transfer(read.url, 'GET', undefined, {range: 'bytes=1-2'})
  expect(range.statusCode).toBe(206)
  expect(range.body).toBe('bc')
  expect(range.headers['content-range']).toBe('bytes 1-2/3')
  expect(range.headers['content-type']).toContain('text/plain')
  expect((await f.client.health()).usedBytes).toBe(3)
})

it('direct URLs reject tampering, expiry, wrong method, MIME, origin and size', async () => {
  const f = await fixture(100, true)
  const link = (await f.fileUrl('write')).json()
  const parsed = new URL(link.url)
  const claims = verifyDirect(parsed.searchParams.get('sig')!, f.secret)
  const invalid = new URL(link.url)
  invalid.searchParams.set('sig', 'x' + parsed.searchParams.get('sig'))
  expect((await f.transfer(invalid.href, 'PUT', 'abc')).statusCode).toBe(403)
  invalid.searchParams.set('sig', signDirect({...claims, expiresAt: Date.now() - 1}, f.secret))
  expect((await f.transfer(invalid.href, 'PUT', 'abc')).statusCode).toBe(403)
  expect((await f.transfer(link.url.replace(claims.blobId, 'differentblob'), 'PUT', 'abc')).statusCode).toBe(403)
  expect((await f.transfer(link.url, 'GET')).statusCode).toBe(403)
  expect((await f.transfer(link.url, 'PUT', 'abc', {'content-type': 'image/png'})).statusCode).toBe(403)
  expect((await f.transfer(link.url, 'PUT', 'abc', {origin: 'https://evil.example'})).statusCode).toBe(403)
  expect((await f.transfer(link.url, 'PUT', 'ab')).statusCode).toBe(403)
  expect((await f.transfer(link.url, 'PUT', 'abcd')).statusCode).toBe(403)
  expect((await f.commit(link.uploadId)).statusCode).toBe(409)
})

it('direct reservations enforce quota and revision, expire and release capacity', async () => {
  const f = await fixture(3, true)
  const link = (await f.fileUrl('write')).json()
  expect((await f.fileUrl('write', {path: 'other', size: 1})).statusCode).toBe(413)
  await expect(f.service.writeFile('owner', f.space.id, 'other', Buffer.from('a'))).rejects.toMatchObject({code: 'quota_exceeded'})
  await f.transfer(link.url, 'PUT', 'abc')
  f.advance()
  await f.service.expireUploads()
  expect((await f.commit(link.uploadId)).statusCode).toBe(404)
  expect((await f.client.health()).usedBytes).toBe(0)
  const g = await fixture(100, true)
  const pending = (await g.fileUrl('write')).json()
  await g.transfer(pending.url, 'PUT', 'abc')
  await g.service.writeFile('owner', g.space.id, 'file', Buffer.from('new'))
  expect((await g.commit(pending.uploadId)).statusCode).toBe(409)
})

it('falls back to authenticated Core paths with write conditions and no reservation', async () => {
  const f = await fixture()
  const link = (await f.fileUrl('write', {createOnly: true})).json()
  expect(link).toMatchObject({url: STORAGE_REST.file(f.space.id) + '?path=file', method: 'PUT',
    headers: {'content-type': 'text/plain', 'if-none-match': '*'}})
  expect(link.uploadId).toBeUndefined()
  expect(await f.db.storageMetadata().transaction(tx => tx.listUploads())).toEqual([])
  expect((await f.fileUrl('write', {}, 'other')).statusCode).toBe(403)
  await f.service.writeFile('owner', f.space.id, 'file', Buffer.from('abc'))
  expect((await f.fileUrl('read')).json()).toMatchObject({url: link.url, method: 'GET'})
  expect((await f.fileUrl('write', {ifMatch: 7})).statusCode).toBe(409)
})

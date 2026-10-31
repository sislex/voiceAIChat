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
async function fixture(quota = 100) {
  const root = await mkdtemp(join(tmpdir(), 'storage-upload-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const tokenFile = join(root, 'token'); await writeFile(tokenFile, 'test')
  const options = {nodeId: 'node', directory: join(root, 'blobs'), tokenFile, capacityBytes: 1000}
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
  const ports = {metadata: db.storageMetadata(), nodes: () => [client],
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
  return {root, db, call, create, client, space, get service() { return service }, advance() { now += 86_400_001 },
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

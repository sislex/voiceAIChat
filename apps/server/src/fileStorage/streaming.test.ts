import Fastify from 'fastify'
import sharp from 'sharp'
import { createThumbnailGenerator } from './thumbnail.js'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
// Measure retained memory, excluding garbage awaiting V8's next collection.
setFlagsFromString('--expose-gc')
const collect: () => void = runInNewContext('gc')
import { afterEach, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import { request } from 'node:http'
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { createStorageNodeClient } from '../../../../packages/file-storage/src/client.js'
import { createStorageNodeServer } from '../../../../packages/file-storage/src/node/server.js'
import { createFileStorageService } from '../../../../packages/file-storage/src/service.js'
import { createMemoryMetadataStore } from '../../../../packages/file-storage/src/metadata.js'
import { registerFileStorageRoutes } from './routes.js'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
async function fixture(maxFileBytes = 1024 ** 3, quota = 1024 ** 3) {
  const root = await mkdtemp(join(tmpdir(), 'storage-stream-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const directory = join(root, 'blobs'), tokenFile = join(root, 'token')
  await writeFile(tokenFile, 'secret')
  const node = await createStorageNodeServer({ nodeId: 'node', directory, tokenFile, capacityBytes: 1024 ** 3, maxFileBytes })
  cleanups.push(async () => { node.server.closeAllConnections(); await node.close() })
  const sockets = new Set<unknown>()
  node.server.on('connection', socket => sockets.add(socket))
  const nodeUrl = await node.listen({ host: '127.0.0.1', port: 0 })
  const client = createStorageNodeClient({ id: 'node', url: nodeUrl, token: 'secret' })
  const service = createFileStorageService({ metadata: createMemoryMetadataStore(), maxFileBytes, thumbnail: createThumbnailGenerator(),
    nodes: () => [client], nodeInfo: () => [{ id: 'node', capacityBytes: 1024 ** 3, usedBytes: 0, online: true, lastSeenAt: 1 }],
    quota: async () => quota, now: Date.now, newId: randomUUID })
  const app = Fastify()
  app.addHook('onRequest', async req => { req.user = { name: 'owner', role: 'admin' } })
  registerFileStorageRoutes(app, service)
  cleanups.push(async () => { app.server.closeAllConnections(); await app.close() })
  const url = await app.listen({ host: '127.0.0.1', port: 0 })
  const space = await service.createSpace('owner', { kind: 'personal', title: 'Files' })
  return { client, sockets, service, directory, file: url + '/api/storage/spaces/' + space.id + '/file?path=test', space, nodeUrl }
}
async function upload(url: string, body: Readable, size?: number) {
  return new Promise<Response>((resolve, reject) => {
    const req = request(url, { method: 'PUT', headers: { 'content-type': 'application/octet-stream',
      ...(size === undefined ? {} : { 'content-length': String(size) }) } }, async response => {
      try {
        const chunks: Buffer[] = []
        for await (const chunk of response) chunks.push(chunk)
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode }))
      } catch (error) { reject(error) }
    })
    req.on('error', reject)
    body.on('error', error => req.destroy(error))
    body.pipe(req)
  })
}

it('streams 200 MiB through Core and node with bounded memory and exact content', async () => {
  const f = await fixture()
  const chunk = Buffer.alloc(64 * 1024, 37), size = 200 * 1024 ** 2
  const hash = createHash('sha256')
  collect()
  const baseline = process.memoryUsage()
  let peak = 0, nextSample = 0
  const sample = () => {
    if (Date.now() < nextSample) return
    nextSample = Date.now() + 100
    collect()
    const m = process.memoryUsage()
    peak = Math.max(peak, m.arrayBuffers - baseline.arrayBuffers + Math.max(0, m.heapUsed - baseline.heapUsed))
  }
  const timer = setInterval(sample, 5)
  try {
    const put = await upload(f.file, Readable.from((async function* () {
      for (let sent = 0; sent < size; sent += chunk.length) { hash.update(chunk); sample(); yield chunk }
    })()), size)
    expect(put.status).toBe(200)
    expect(await put.json()).toMatchObject({ size })
    const get = await fetch(f.file)
    expect(get.status).toBe(200)
    expect(get.headers.get('content-length')).toBe(String(size))
    let received = 0
    const downloaded = createHash('sha256')
    for await (const bytes of get.body!) { received += bytes.length; downloaded.update(bytes); sample() }
    expect(received).toBe(size)
    expect(downloaded.digest('hex')).toBe(hash.digest('hex'))
    expect(peak).toBeLessThan(64 * 1024 ** 2)
  } finally { clearInterval(timer) }
}, 60_000)

it('rejects known and chunked oversize bodies and rolls back blobs and metadata', async () => {
  const f = await fixture(128 * 1024)
  for (const size of [undefined, 256 * 1024]) {
    const response = await upload(f.file, Readable.from([Buffer.alloc(256 * 1024)]), size)
    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ error: 'file_too_large' })
    expect((await f.service.listEntries('owner', f.space.id)).entries).toEqual([])
    expect(await readdir(f.directory)).toEqual([])
  }
})

it('aborting an HTTP upload removes its temporary blob and leaves metadata unchanged', async () => {
  const f = await fixture()
  await new Promise<void>((resolve, reject) => {
    const req = request(f.file, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' } })
    req.on('error', () => resolve())
    req.write(Buffer.alloc(64 * 1024))
    const deadline = Date.now() + 5000
    const wait = async () => {
      if ((await readdir(f.directory)).some(name => name.startsWith('.tmp-'))) { req.destroy(); return }
      if (Date.now() > deadline) { req.destroy(); reject(new Error('Upload never reached node')); return }
      setTimeout(() => { void wait().catch(reject) }, 10)
    }
    void wait().catch(reject)
  })
  expect((await f.service.listEntries('owner', f.space.id)).entries).toEqual([])
  await expect.poll(() => readdir(f.directory)).toEqual([])
  expect((await f.service.listEntries('owner', f.space.id)).entries).toEqual([])
  expect((await f.client.health()).usedBytes).toBe(0)
})

it('generates and caches thumbnails with streaming HTTP node reads', async () => {
  const f = await fixture()
  const source = await sharp({ create: { width: 256, height: 128, channels: 3, background: 'red' } }).png().toBuffer()
  await f.service.writeFile('owner', f.space.id, 'test', source, { mimeType: 'image/png' })
  const url = f.file.replace('/file?', '/thumbnail?') + '&size=128'
  const first = await fetch(url)
  expect(first.status).toBe(200)
  expect(first.headers.get('content-type')).toBe('image/webp')
  const image = Buffer.from(await first.arrayBuffer())
  expect(await sharp(image).metadata()).toMatchObject({ width: 128, height: 64 })
  const cached = await fetch(url)
  expect(cached.status).toBe(200)
  expect(Buffer.from(await cached.arrayBuffer())).toEqual(image)
  expect(await readdir(f.directory)).toHaveLength(2)
})

it('node rejects chunked overflow without publishing a blob', async () => {
  const f = await fixture(128 * 1024)
  await expect(f.client.put('oversize_blob', Readable.from([Buffer.alloc(256 * 1024)])))
    .rejects.toMatchObject({ code: 'file_too_large' })
  await expect.poll(() => readdir(f.directory)).toEqual([])
  expect((await f.client.health()).usedBytes).toBe(0)
})

it('shares keep-alive connections between HTTP node clients', async () => {
  const f = await fixture()
  for (let i = 0; i < 12; i++) {
    const client = createStorageNodeClient({ id: 'node', url: f.nodeUrl, token: 'secret' })
    await client.health()
  }
  expect(f.sockets.size).toBeLessThanOrEqual(2)
})

it('counts unknown lengths against owner quota without replacing existing files', async () => {
  const f = await fixture(1024, 8)
  expect((await upload(f.file, Readable.from([Buffer.from('old')]))).status).toBe(200)
  const failed = await upload(f.file, Readable.from([Buffer.alloc(9)]))
  expect(await failed.json()).toMatchObject({ error: 'quota_exceeded' })
  expect(await (await fetch(f.file)).text()).toBe('old')
  expect((await f.service.usage('owner')).usedBytes).toBe(3)
  expect(await readdir(f.directory)).toHaveLength(1)
})


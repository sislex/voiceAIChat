import { afterAll, beforeAll, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { createRemoteStorageRuntime, withStorageTenant } from './remote.js'
import { limitUpload } from '../uploadBody.js'

let server: Server, root: string, runtime: Awaited<ReturnType<typeof createRemoteStorageRuntime>>
let usage = { userId: 'alice', usedBytes: 0, quotaBytes: 100 * 1024 * 1024, fileCount: 0 }
let imageSize = 1000
const roles: Array<string | undefined> = []
const json = (res: import('node:http').ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'remote-storage-errors-'))
  const tokenFile = join(root, 'token'); await writeFile(tokenFile, 'service-secret\n')
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://storage')
    if (req.method === 'PUT') { req.once('data', () => req.socket.destroy()); return } // refuses mid-stream, like a quota check
    req.resume()
    if (url.pathname.endsWith('/usage')) return json(res, 200, usage)
    if (url.pathname.endsWith('/cluster')) { roles.push(req.headers['x-sislexa-role'] as string | undefined); return json(res, 200, { nodes: [] }) }
    if (url.pathname.endsWith('/thumbnail')) return json(res, 500, { error: 'internal', message: 'spawn convert ENOENT' })
    if (url.pathname.endsWith('/files')) return json(res, 200, { entries: [{ path: 'pic.png', size: imageSize, mimeType: 'image/png', revision: 3, updatedAt: 1, updatedBy: 'alice' }] })
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': '4' }).end('PNG!')
  })
  await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  runtime = await createRemoteStorageRuntime({ mode: 'remote', url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, serviceTokenFile: tokenFile, nodes: [], defaultQuotaBytes: 1 })
})
afterAll(async () => { await runtime?.close(); await new Promise<void>(resolve => server?.close(() => resolve())); await rm(root, { recursive: true, force: true }) })

async function* chunks(count: number) { for (let index = 0; index < count; index++) yield Buffer.alloc(64 * 1024, 1) }

it('reports a quota refusal when the service drops a streamed upload that does not fit', async () => {
  usage = { ...usage, usedBytes: 99 * 1024 * 1024 }
  await expect(runtime.service.writeFile('alice', 'space', 'big.bin', Readable.from(chunks(64)), { createOnly: true }))
    .rejects.toMatchObject({ code: 'quota_exceeded', statusCode: 413, message: expect.stringContaining('занято 99.0 МБ из 100.0 МБ'),
      details: { usedBytes: 99 * 1024 * 1024, limitBytes: 100 * 1024 * 1024 } })
})

it('keeps an outage an outage when the upload would have fit', async () => {
  usage = { ...usage, usedBytes: 0 }
  await expect(runtime.service.writeFile('alice', 'space', 'small.bin', Readable.from(chunks(2)), { createOnly: true }))
    .rejects.toMatchObject({ code: 'storage_unavailable' })
})

it('reports the attachment size limit instead of an outage when the source stops the stream', async () => {
  usage = { ...usage, usedBytes: 0 }
  await expect(runtime.service.writeFile('alice', 'space', 'huge.bin', limitUpload(chunks(2), 10), { createOnly: true }))
    .rejects.toMatchObject({ code: 'file_too_large', statusCode: 413, details: { limitBytes: 10 } })
})

it('forwards the admin role so the service can authorize cluster requests', async () => {
  await withStorageTenant(undefined, () => runtime.service.cluster('alice'), 'admin')
  await withStorageTenant(undefined, () => runtime.service.cluster('bob'), 'user')
  expect(roles).toEqual(['admin', undefined])
})

it('serves a small image itself when the service cannot build a preview, and says so for a large one', async () => {
  imageSize = 1000
  const preview = await runtime.service.readThumbnail('alice', 'space', 'pic.png', 256)
  expect(preview.mimeType).toBe('image/png')
  expect(Buffer.from(preview.bytes).toString()).toBe('PNG!')
  imageSize = 3 * 1024 * 1024
  await expect(runtime.service.readThumbnail('alice', 'space', 'pic.png', 256)).rejects.toMatchObject({ code: 'preview_unavailable', statusCode: 501 })
})

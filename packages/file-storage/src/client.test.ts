import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createFileStorageService } from './service.js'
import { createMemoryMetadataStore } from './metadata.js'
import { createStorageNodeClient } from './client.js'
import { createStorageNodeServer } from './node/server.js'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
it('uploads and reads directly over HTTP while commit transfers only node metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'storage-direct-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const tokenFile = join(root, 'token'), secret = 's'.repeat(32)
  await writeFile(tokenFile, 'secret')
  const app = await createStorageNodeServer({ nodeId: 'a', directory: join(root, 'blobs'), capacityBytes: 100, tokenFile, directSecret: secret })
  cleanup.push(() => app.close())
  const url = await app.listen({ host: '127.0.0.1', port: 0 })
  const client = createStorageNodeClient({ id: 'a', url, token: 'secret' })
  const get = vi.spyOn(client, 'get'), put = vi.spyOn(client, 'put')
  const service = createFileStorageService({ metadata: createMemoryMetadataStore(), now: Date.now, newId: randomUUID,
    nodes: () => [client], nodeInfo: () => [{ id: 'a', capacityBytes: 100, usedBytes: 0, online: true, lastSeenAt: Date.now() }],
    quota: async () => 100, directNode: () => ({ publicUrl: url, secret }) })
  const space = await service.createSpace('owner', { kind: 'personal', title: 'Direct' })
  const write = await service.fileUrl('owner', space.id, { operation: 'write', path: 'a', size: 5, mimeType: 'text/plain' })
  const uploaded = await fetch(write.url, { method: write.method, headers: write.headers, body: 'hello' })
  expect(uploaded.status).toBe(204)
  expect((await service.listEntries('owner', space.id)).entries).toEqual([])
  await service.commitFile('owner', space.id, write.reservationId!)
  const read = await service.fileUrl('owner', space.id, { operation: 'read', path: 'a' })
  const response = await fetch(read.url, { headers: { range: 'bytes=1-3' } })
  expect(response.status).toBe(206)
  expect(await response.text()).toBe('ell')
  expect(get).not.toHaveBeenCalled()
  expect(put).not.toHaveBeenCalled()
})
it('round-trips binary data through a real HTTP node and maps its errors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'storage-client-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const tokenFile = join(root, 'token')
  await writeFile(tokenFile, 'secret')
  const app = await createStorageNodeServer({ nodeId: 'a', directory: join(root, 'blobs'), capacityBytes: 4, tokenFile })
  cleanup.push(() => app.close())
  const url = await app.listen({ host: '127.0.0.1', port: 0 })
  const client = createStorageNodeClient({ id: 'a', url, token: 'secret' })
  await client.put('abcdefgh', new Uint8Array([0, 255, 42]))
  expect(await client.stat!('abcdefgh')).toEqual({ size: 3 })
  expect(await client.get('abcdefgh')).toEqual(new Uint8Array([0, 255, 42]))
  expect(await client.health()).toMatchObject({ nodeId: 'a', usedBytes: 3 })
  await expect(client.put('other_id', new Uint8Array(3))).rejects.toMatchObject({ code: 'storage_full' })
  await client.delete('abcdefgh')
  await expect(client.get('abcdefgh')).rejects.toMatchObject({ code: 'not_found' })
  await expect(createStorageNodeClient({ id: 'a', url, token: 'wrong' }).health()).rejects.toMatchObject({ code: 'forbidden' })
  await app.close()
  await expect(client.health()).rejects.toMatchObject({ code: 'node_unavailable' })
})
it.each([[401, 'forbidden'], [404, 'not_found'], [413, 'file_too_large'], [507, 'storage_full'], [500, 'node_unavailable']])(
  'maps HTTP %s without a JSON error body', async (status, code) => {
    const client = createStorageNodeClient({ id: 'a', url: 'http://node', token: 'secret',
      fetchImpl: vi.fn(async () => new Response('bad', { status: Number(status) })) })
    await expect(client.get('abcdefgh')).rejects.toMatchObject({ code })
  })
it('rejects invalid IDs locally and maps malformed health and interrupted response bodies', async () => {
  const transport = vi.fn(async () => new Response('{}'))
  const client = createStorageNodeClient({ id: 'a', url: 'http://node', token: 'secret', fetchImpl: transport })
  await expect(client.get('../x')).rejects.toMatchObject({ code: 'invalid_path' })
  expect(transport).not.toHaveBeenCalled()
  await expect(client.health()).rejects.toMatchObject({ code: 'node_unavailable' })
  transport.mockImplementationOnce(async () => new Response(new ReadableStream({ start(c) { c.error(new Error('disconnected')) } })))
  await expect(client.get('abcdefgh')).rejects.toMatchObject({ code: 'node_unavailable' })
})
it('does not follow redirects with node credentials and sends a bounded request', async () => {
  const transport = vi.fn(async () => new Response(null, { status: 204 }))
  const client = createStorageNodeClient({ id: 'a', url: 'http://node', token: 'secret', fetchImpl: transport })
  await client.put('abcdefgh', new Uint8Array())
  expect(transport).toHaveBeenCalledWith(new URL('http://node/v1/blobs/abcdefgh'), expect.objectContaining({
    redirect: 'error', signal: expect.any(AbortSignal), headers: expect.objectContaining({ authorization: 'Bearer secret' }),
  }))
})

import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStorageNodeClient, storageBytes } from './client.js'
import { createStorageNodeServer } from './node/server.js'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
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
  expect(await storageBytes(await client.get('abcdefgh'))).toEqual(new Uint8Array([0, 255, 42]))
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
  await expect(client.get('abcdefgh').then(storageBytes)).rejects.toMatchObject({ code: 'node_unavailable' })
})
it('does not follow redirects with node credentials and sends a bounded request', async () => {
  const transport = vi.fn(async () => new Response(null, { status: 204 }))
  const client = createStorageNodeClient({ id: 'a', url: 'http://node', token: 'secret', fetchImpl: transport })
  await client.put('abcdefgh', new Uint8Array())
  expect(transport).toHaveBeenCalledWith(new URL('http://node/v1/blobs/abcdefgh'), expect.objectContaining({
    redirect: 'error', signal: expect.any(AbortSignal), headers: expect.objectContaining({ authorization: 'Bearer secret' }),
  }))
})

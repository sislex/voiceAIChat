import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { afterEach, expect, it, vi } from 'vitest'
import { registerHttpCompression } from './httpCompression.js'
import { registerStaticCompression, compressStatic } from './staticCompression.js'
import { registerApplicationFrontends } from './routes/applicationFrontends.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
const body = Buffer.from('window.panel = "Привет";\n'.repeat(4096))
async function fixture(custom = false, maxBytes?: number) {
  const root = await mkdtemp(join(tmpdir(), 'static-compression-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const directory = join(root, 'node_modules/@sislexa/make')
  await mkdir(join(directory, 'frontend'), { recursive: true })
  await mkdir(join(root, 'assets'))
  await writeFile(join(directory, 'package.json'), JSON.stringify({
    name: '@sislexa/make', exports: { './frontend/*': './frontend/*' }
  }))
  for (const ext of ['js', 'css', 'html', 'json', 'svg', 'map']) {
    await writeFile(join(directory, 'frontend/panel-abc.' + ext), body)
    await writeFile(join(root, 'assets/index-abc.' + ext), body)
  }
  const app = Fastify()
  cleanup.push(() => app.close())
  const compress = vi.fn(compressStatic)
  if (custom) registerStaticCompression(app, { compress, maxBytes })
  else await registerHttpCompression(app)
  registerApplicationFrontends(app, {}, root)
  await app.register(fastifyStatic, { root: join(root, 'assets'), prefix: '/assets/' })
  return { app, compress, root, directory }
}

it.each(['br', 'gzip'] as const)('round-trips actual static routes with %s and preserves identity', async encoding => {
  const { app } = await fixture()
  for (const prefix of ['/applications/make-ui/panel-abc.', '/assets/index-abc.']) {
    for (const ext of ['js', 'css', 'html', 'json', 'svg', 'map']) {
      const url = prefix + ext
      const response = await app.inject({ url, headers: { 'accept-encoding': encoding } })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-encoding']).toBe(encoding)
      expect(response.headers.vary).toMatch(/accept-encoding/i)
      expect(response.headers['content-length']).toBe(String(response.rawPayload.length))
      expect((encoding === 'br' ? brotliDecompressSync : gunzipSync)(response.rawPayload).equals(body)).toBe(true)
      const identity = await app.inject(url)
      expect(identity.rawPayload.equals(body)).toBe(true)
      expect(identity.headers['content-length']).toBe(String(body.length))
      expect(identity.headers['content-encoding']).toBeUndefined()
      expect(identity.headers.vary).toMatch(/accept-encoding/i)
    }
  }
})

it('reuses compressed bytes including concurrent requests, but invalidates changed content', async () => {
  const { app, compress, directory } = await fixture(true)
  const request = { url: '/applications/make-ui/panel-abc.js', headers: { 'accept-encoding': 'br' } }
  const responses = await Promise.all(Array.from({ length: 3 }, () => app.inject(request)))
  await app.inject(request)
  expect(compress).toHaveBeenCalledTimes(1)
  expect(responses[0].rawPayload).toEqual(responses[1].rawPayload)
  await writeFile(join(directory, 'frontend/panel-abc.js'), 'changed')
  const changed = await app.inject(request)
  expect(brotliDecompressSync(changed.rawPayload).toString()).toBe('changed')
  expect(compress).toHaveBeenCalledTimes(2)
})

it('evicts entries exceeding the configured cache budget', async () => {
  const { app, compress } = await fixture(true, 1)
  const request = { url: '/assets/index-abc.js', headers: { 'accept-encoding': 'gzip' } }
  await app.inject(request)
  await app.inject(request)
  expect(compress).toHaveBeenCalledTimes(2)
})

it('preserves Range and conditional static responses', async () => {
  const { app } = await fixture()
  const url = '/assets/index-abc.js'
  const partial = await app.inject({ url, headers: { range: 'bytes=0-9', 'accept-encoding': 'br' } })
  expect(partial.statusCode).toBe(206)
  expect(partial.rawPayload).toEqual(body.subarray(0, 10))
  expect(partial.headers['content-encoding']).toBeUndefined()
  const first = await app.inject(url)
  const unchanged = await app.inject({ url, headers: { 'if-none-match': String(first.headers.etag), 'accept-encoding': 'br' } })
  expect(unchanged.statusCode).toBe(304)
  expect(unchanged.body).toBe('')
})

it.each([
  ['br;q=0, gzip;q=1', 'gzip'], ['gzip;q=0.1, br;q=0.9', 'br'],
  ['br;q=0, gzip;q=0', undefined], ['identity;q=1, br;q=0.5', undefined],
  ['*;q=1, br;q=0', 'gzip']
])('negotiates %s', async (accept, expected) => {
  const { app } = await fixture()
  const response = await app.inject({ url: '/assets/index-abc.js', headers: { 'accept-encoding': accept! } })
  expect(response.headers['content-encoding']).toBe(expected)
})

import Fastify from 'fastify'
import { Readable } from 'node:stream'
import { brotliDecompressSync, gzipSync, gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { registerHttpCompression } from './httpCompression.js'

const large = { text: 'Привет! '.repeat(1024) }
const body = JSON.stringify(large)
const apps: ReturnType<typeof Fastify>[] = []
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())) })

async function fixture() {
  const app = Fastify()
  apps.push(app)
  await registerHttpCompression(app)
  app.get('/api/small-json', async () => ({ ok: true }))
  app.get('/api/json', async (_request, reply) => reply.header('content-length', Buffer.byteLength(body)).send(large))
  app.get('/api/text', async (_request, reply) => reply.type('text/plain').send(body))
  app.get('/api/stream', async (_request, reply) => reply.type('application/json')
    .header('content-length', Buffer.byteLength(body)).send(Readable.from([body])))
  app.get('/api/web-stream', async (_request, reply) => reply.type('text/plain')
    .send(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from(body)); controller.close() } })))
  app.get('/api/events', async (_request, reply) => reply.type('text/event-stream').send(body))
  app.get('/api/encoded', async (_request, reply) => reply.type('application/json')
    .header('content-encoding', 'gzip').send(gzipSync(body)))
  app.get('/api/partial', async (_request, reply) => reply.code(206).type('text/plain')
    .header('content-range', `bytes 0-${Buffer.byteLength(body) - 1}/${Buffer.byteLength(body)}`).send(body))
  app.get('/api/media/:kind', async (request, reply) => reply.type(
    ({ zip: 'application/zip', png: 'image/png', gzip: 'application/gzip', video: 'video/mp4' } as Record<string, string>)[
      (request.params as { kind: string }).kind]).send(Buffer.from(body)))
  for (const size of [32, 1024, 1025]) {
    app.get(`/api/size/${size}`, async (_request, reply) => reply.type('text/plain')
      .header('content-length', size).send('a'.repeat(size)))
  }
  for (const path of ['/api/preview/file', '/api/previews/file', '/api/tunnel/data', '/internal/machines/exec-stream', '/api/logs', '/asset']) {
    app.get(path, {
      onSend: async (_request, reply, payload) => { reply.header('x-route-hook', 'ran'); return payload },
    }, async (_request, reply) => reply.type('text/plain').header('content-length', Buffer.byteLength(body)).send(body))
  }
  await app.register(async child => {
    child.get('/api/nested', async () => large)
    child.get('/api/disabled', { compress: false }, async () => large)
  })
  return app
}

describe('API HTTP compression', () => {
  it.each(['br', 'gzip'])('leaves small JSON unchanged with %s', async encoding => {
    const app = await fixture()
    const response = await app.inject({ url: '/api/small-json', headers: { 'accept-encoding': encoding } })
    expect(response.headers['content-encoding']).toBeUndefined()
    expect(response.body).toBe('{"ok":true}')
    expect(response.headers['content-length']).toBe('11')
  })

  it.each(['br', 'gzip'] as const)('round-trips large JSON and text with %s', async encoding => {
    const app = await fixture()
    for (const url of ['/api/json', '/api/text', '/api/nested']) {
      const response = await app.inject({ url, headers: { 'accept-encoding': encoding } })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-encoding']).toBe(encoding)
      expect(response.headers['content-length']).toBeUndefined()
      expect(response.headers.vary).toContain('accept-encoding')
      expect(response.rawPayload.length).toBeLessThan(Buffer.byteLength(body))
      const decoded = (encoding === 'br' ? brotliDecompressSync : gunzipSync)(response.rawPayload).toString()
      expect(decoded).toBe(body)
      expect(JSON.parse(decoded)).toEqual(large)
    }
  })

  it.each([undefined, 'identity', 'deflate', 'br;q=0, gzip;q=0'])('preserves identity body and length for %s', async encoding => {
    const app = await fixture()
    const response = await app.inject({ url: '/api/json', headers: encoding ? { 'accept-encoding': encoding } : {} })
    expect(response.headers['content-encoding']).toBeUndefined()
    expect(response.headers['content-length']).toBe(String(Buffer.byteLength(body)))
    expect(response.body).toBe(body)
  })

  it('honors encoding weights', async () => {
    const app = await fixture()
    const response = await app.inject({ url: '/api/json', headers: { 'accept-encoding': 'br;q=0.1, gzip;q=1' } })
    expect(response.headers['content-encoding']).toBe('gzip')
    expect(gunzipSync(response.rawPayload).toString()).toBe(body)
  })

  it.each([32, 1024, 1025])('compresses only above 1024 bytes (%s)', async size => {
    const app = await fixture()
    const response = await app.inject({ url: `/api/size/${size}`, headers: { 'accept-encoding': 'gzip' } })
    expect(response.headers['content-encoding']).toBe(size > 1024 ? 'gzip' : undefined)
    expect(response.headers['content-length']).toBe(size > 1024 ? undefined : String(size))
    expect(size > 1024 ? gunzipSync(response.rawPayload).toString() : response.body).toBe('a'.repeat(size))
  })

  it.each(['/api/stream', '/api/web-stream', '/api/events', '/api/partial', '/api/disabled',
    '/api/preview/file', '/api/previews/file', '/api/tunnel/data', '/internal/machines/exec-stream',
    '/api/logs?follow=true', '/asset', '/api/media/zip', '/api/media/png', '/api/media/gzip', '/api/media/video'])
  ('excludes %s without changing its body', async url => {
    const app = await fixture()
    const response = await app.inject({ url, headers: { 'accept-encoding': 'br, gzip' } })
    expect(response.headers['content-encoding']).toBeUndefined()
    expect(response.body).toBe(body)
    if (!['/api/web-stream'].includes(url)) expect(response.headers['content-length']).toBe(String(Buffer.byteLength(body)))
    if (url.includes('preview') || url.includes('follow')) expect(response.headers['x-route-hook']).toBe('ran')
  })

  it.each([{ range: 'bytes=0-2048' }, { upgrade: 'websocket', connection: 'Upgrade' }])
  ('excludes range and upgrade requests (%j)', async headers => {
    const app = await fixture()
    const response = await app.inject({ url: '/api/json', headers: { ...headers, 'accept-encoding': 'gzip' } })
    expect(response.headers['content-encoding']).toBeUndefined()
    expect(response.headers['content-length']).toBe(String(Buffer.byteLength(body)))
    expect(response.body).toBe(body)
  })

  it('does not recompress an encoded response', async () => {
    const app = await fixture()
    const response = await app.inject({ url: '/api/encoded', headers: { 'accept-encoding': 'br, gzip' } })
    expect(response.headers['content-encoding']).toBe('gzip')
    expect(response.rawPayload).toEqual(gzipSync(body))
    expect(response.headers['content-length']).toBe(String(gzipSync(body).length))
  })
})

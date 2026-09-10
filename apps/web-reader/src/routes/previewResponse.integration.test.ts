import type { AgentHttpResponse } from '@voicechat/shared'
import Fastify, { type FastifyInstance } from 'fastify'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { registerPreviewProxy } from './previewProxy.js'
let upstream: FastifyInstance, reader: FastifyInstance, base: string
const body = Buffer.from('<!doctype html><h1>Привет</h1>')
describe('кодировки всех транспортов preview', () => {
  beforeAll(async () => {
    upstream = Fastify(); upstream.removeAllContentTypeParsers(); upstream.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body))
    upstream.all('/*', async (req, reply) => {
      if (req.url === '/gzip') return reply.type('text/html').header('content-encoding', 'gzip').send(gzipSync(body))
      if (req.url === '/cross') return reply.code(307).header('location', 'http://93.184.216.35:8080/final').send('')
      if (req.url === '/redirect') return reply.code(302).header('location', '/final').send('')
      return { method: req.method, body: Buffer.isBuffer(req.body) ? req.body.toString() : null, auth: req.headers.authorization ?? null, type: req.headers['content-type'] ?? null }
    })
    base = await upstream.listen({ host: '127.0.0.1', port: 0 })
    reader = Fastify(); reader.addHook('onRequest', async req => { Object.assign(req, { user: { name: 'response-fixture' } }) })
    registerPreviewProxy(reader, { hostAliases: new Map([['93.184.216.34:8080', new URL(base).host], ['93.184.216.35:8080', new URL(base).host]]), machines: { canUse: async () => true, bridge: { isOnline: () => true, http: async (_agent, req): Promise<AgentHttpResponse> => req.path === '/local' ? { status: 307, headers: { location: 'http://127.0.0.1:5173/final' }, bodyBase64: '' } : req.path === '/invalid' ? { status: 307, headers: { location: 'ftp://response.machine.internal/final' }, bodyBase64: '' } : req.path === '/final' ? { status: 200, headers: { 'content-type': 'application/json' }, bodyBase64: Buffer.from(JSON.stringify({ auth: req.headers?.authorization })).toString('base64') } : { status: 200, headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' }, bodyBase64: gzipSync(body).toString('base64') } } } })
    await reader.ready()
  })
  afterAll(async () => { await reader?.close(); await upstream?.close() })
  it.each(['http://93.184.216.34:8080/gzip', 'http://response.machine.internal:5173/gzip'])('сжатый HTML из %s переписывается и отдаётся без Content-Encoding', async url => {
    const response = await reader.inject({ url: '/api/preview?url=' + encodeURIComponent(url) }); expect(response.statusCode).toBe(200); expect(response.body).toContain('Привет'); expect(response.body).toContain('voicechat-preview-inspector'); expect(response.headers['content-encoding']).toBeUndefined(); expect(response.headers['content-type']).toContain('charset=utf-8')
  })
  it('внешний 302 сохраняет PUT с телом', async () => {
    const response = await reader.inject({ method: 'PUT', url: '/api/preview?url=' + encodeURIComponent('http://93.184.216.34:8080/redirect'), headers: { 'content-type': 'text/plain' }, payload: 'value' }); expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ method: 'PUT', body: 'value', type: 'text/plain' })
  })
  it('внешний 302 убирает тело и content-type POST', async () => {
    const response = await reader.inject({ method: 'POST', url: '/api/preview?url=' + encodeURIComponent('http://93.184.216.34:8080/redirect'), headers: { 'content-type': 'text/plain' }, payload: 'value' }); expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ method: 'GET', body: null, type: null })
  })
  it('локальный redirect машины сохраняет авторизацию того же origin', async () => {
    const response = await reader.inject({ url: '/api/preview?url=' + encodeURIComponent('http://response.machine.internal:5173/local'), headers: { 'x-preview-authorization': 'nested-secret' } }); expect(response.statusCode).toBe(200); expect(response.json().auth).toBe('nested-secret')
  })
  it('redirect машины на не-HTTP отклоняется до повторного запроса', async () => {
    const response = await reader.inject({ url: '/api/preview?url=' + encodeURIComponent('http://response.machine.internal:5173/invalid') }); expect(response.statusCode).toBe(400)
  })
  it('cross-origin redirect не раскрывает авторизацию страницы', async () => {
    const response = await reader.inject({ url: '/api/preview?url=' + encodeURIComponent('http://93.184.216.34:8080/cross'), headers: { 'x-preview-authorization': 'nested-secret' } }); expect(response.statusCode).toBe(200); expect(response.json().auth).toBeNull()
  })
})

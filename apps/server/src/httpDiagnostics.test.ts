import Fastify from 'fastify'
import { expect, it, vi } from 'vitest'
import { registerHttpDiagnostics, requestIdOf, REQUEST_ID_HEADER } from './httpDiagnostics.js'

it('records slow and failed APIs without query strings, credentials or response bodies', async () => {
  const app = Fastify(), log = vi.fn()
  let clock = 0
  registerHttpDiagnostics(app, { now: () => clock, log })
  app.get('/api/users/:name', async () => { clock += 30000; return { secret: 'private-result' } })
  app.get('/api/session/signup', async (_req, reply) => reply.code(503).send({ error: 'private-detail' }))
  app.get('/api/health', async () => ({ ok: true }))
  try {
    await app.inject({ url: '/api/users/private-user?q=private-query', headers: { authorization: 'Bearer private-token', cookie: 'private-cookie' } })
    await app.inject('/api/session/signup')
    await app.inject('/api/health')
    expect(log.mock.calls).toEqual([
      [{ event: 'api_request_problem', requestId: expect.any(String), method: 'GET', route: '/api/users/:name', status: 200, durationMs: 30000 }],
      [{ event: 'api_request_problem', requestId: expect.any(String), method: 'GET', route: '/api/session/signup', status: 503, durationMs: 0 }],
    ])
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-')
  } finally { await app.close() }
})

it('keeps a safe caller request ID, replaces unsafe values and exposes bounded route metrics', async () => {
  let clock = 0
  const app = Fastify({ genReqId: request => requestIdOf(request.headers[REQUEST_ID_HEADER]) })
  const diagnostics = registerHttpDiagnostics(app, { now: () => clock, log: () => {} })
  app.get('/api/items/:id', async (_req, reply) => {
    clock += 2500
    return reply.code(503).send({ error: 'unavailable' })
  })
  try {
    const first = await app.inject({ url: '/api/items/private-id?q=secret', headers: { [REQUEST_ID_HEADER]: 'edge:trace-1' } })
    expect(first.headers[REQUEST_ID_HEADER]).toBe('edge:trace-1')
    for (let index = 0; index < 4; index++) await app.inject({ url: `/api/items/${index}` })
    const unsafe = await app.inject({ url: '/api/items/unsafe', headers: { [REQUEST_ID_HEADER]: 'bad request\nvalue' } })
    expect(unsafe.headers[REQUEST_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/)
    expect(diagnostics.snapshot()).toMatchObject({
      inFlight: 0,
      requests: 6,
      failures: 6,
      slow: 6,
      recentFailures: 6,
      recentSlow: 6,
      alerts: ['http_5xx_rate']
    })
    const metrics = diagnostics.prometheus()
    expect(metrics).toContain('sislexa_core_http_requests_total{method="GET",route="/api/items/:id"} 6')
    expect(metrics).not.toContain('private-id')
    expect(metrics).not.toContain('secret')
  } finally { await app.close() }
})

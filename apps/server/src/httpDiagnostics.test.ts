import Fastify from 'fastify'
import { expect, it, vi } from 'vitest'
import { registerHttpDiagnostics } from './httpDiagnostics.js'

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
      [{ event: 'api_request_problem', method: 'GET', route: '/api/users/:name', status: 200, durationMs: 30000 }],
      [{ event: 'api_request_problem', method: 'GET', route: '/api/session/signup', status: 503, durationMs: 0 }],
    ])
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-')
  } finally { await app.close() }
})

import { expect, it } from 'vitest'
import Fastify from 'fastify'
import { buildIdentityServer } from '@sislexa/identity/server/server'
import { registerRemoteIdentity } from '@sislexa/identity/client/server'
import { registerAuthGuard } from '@sislexa/identity/server/users/auth'
import { signToken } from '@sislexa/identity/server/users/accounts'
import { VoiceChatDb } from '../db/database.js'
import { registerKanbanProxy } from '../kanbanBridge/proxy.js'
import { registerCoreOAuth } from './oauth.js'

it('authenticates operator and board tokens through the real Identity RPC port', async () => {
  const db = new VoiceChatDb(':memory:')
  await db.ready
  await db.identity.createUser('operator', '', 'admin')
  const { app: identity } = await buildIdentityServer({ database: db, secret: 'test-secret',
    authorize: header => header === 'Bearer core-service' ? { ok: true } : { ok: false, status: 401 } })
  const host = Fastify()
  const app = Fastify()
  const forwarded: string[] = []
  try {
    const port = await registerRemoteIdentity(host, db, { url: 'https://identity.test', token: 'core-service',
      fetchImpl: async (input, init) => {
        const request = new Request(input, init)
        const url = new URL(request.url)
        const response = await identity.inject({ method: request.method as 'GET' | 'POST', url: url.pathname + url.search,
          headers: Object.fromEntries(request.headers), ...(request.method === 'POST' ? { payload: await request.text() } : {}) })
        return new Response(response.body, { status: response.statusCode })
      },
    }, 'test-secret')
    const oauth = await registerCoreOAuth(app, db, { authUrl: 'https://identity.test', publicUrl: 'https://core.test' }, port.authenticate)
    registerAuthGuard(app, db, oauth.authenticate, () => null)
    registerKanbanProxy(app, { kanbanUrl: 'https://kanban.test', fetchImpl: async (_input, init) => {
      forwarded.push(new Headers(init?.headers).get('authorization')!)
      return Response.json({ columns: [] })
    } })
    for (const name of ['claude-operator', 'dc-board']) {
      const { sid } = await db.identity.createApiToken('operator', { name, ttlMs: 60000, access: 'full' })
      const authorization = `Bearer ${signToken({ name: 'operator', role: 'admin' }, 'test-secret', sid)}`
      const headers = { authorization }
      for (const url of ['/api/session/me', '/api/projects/project/board']) {
        const response = await app.inject({ url, headers })
        expect(response.statusCode, response.body).toBe(200)
      }
      expect(forwarded.at(-1)).toBe(authorization)
      await db.identity.setUserBlocked('operator', true)
      expect((await app.inject({ url: '/api/session/me', headers })).statusCode).toBe(401)
      await db.identity.setUserBlocked('operator', false)
      await db.identity.revokeApiToken('operator', sid)
      expect((await app.inject({ url: '/api/projects/project/board', headers })).statusCode).toBe(401)
    }
    expect(forwarded).toHaveLength(2)
  } finally { await app.close(); await host.close(); await identity.close(); await db.close() }
})

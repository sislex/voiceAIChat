import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import { expect, it } from 'vitest'
import { BrowserChatSessions, browserOriginAllowed } from './browserChat.js'

it('matches only canonical exact origins', () => {
  const allowed = ['https://host.example', '*', 'sislexa://app']
  for (const origin of ['null', '*', 'https://host.example/', 'https://host.example.evil', 'https://user@host.example', 'https://host.example:443']) {
    expect(browserOriginAllowed(origin, allowed, 'https://core.example')).toBe(false)
  }
  for (const origin of ['https://host.example', 'https://core.example', 'sislexa://app']) {
    expect(browserOriginAllowed(origin, allowed, 'https://core.example')).toBe(true)
  }
})

it('expires handles, prevents session chaining and binds origin, tenant and resource', async () => {
  let now = 10_000
  const sessions = new BrowserChatSessions(() => now)
  const app = Fastify()
  app.decorateRequest('user', null)
  sessions.register(app)
  app.post('/api/chat/session', async req => {
    req.user = { name: 'test', role: 'developer', account: { tenantId: 'tenant' } } as typeof req.user
    return sessions.issue(req, undefined, 'conversation', now + 60_000)
  })
  for (const url of ['/api/conversations/:id', '/api/settings', '/ws']) app.get(url, async req => ({
    sessionId: sessions.requests.get(req)?.sessionId,
    tenant: req.headers['x-sislexa-tenant-id']
  }))
  try {
    const issued = (await app.inject({ method: 'POST', url: '/api/chat/session',
      headers: { origin: 'https://host.example', authorization: 'Bearer ' + randomUUID() } })).json()
    expect(issued.expiresAt).toBe(now + 60_000)
    const headers = { origin: 'https://host.example', authorization: 'Bearer ' + issued.accessToken }
    expect((await app.inject({ url: '/api/conversations/conversation', headers })).json()).toEqual({ sessionId: issued.sessionId, tenant: 'tenant' })
    for (const url of ['/api/settings', '/api/conversations/foreign']) expect((await app.inject({ url, headers })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: '/api/chat/session', headers })).statusCode).toBe(403)
    expect((await app.inject({ url: '/api/conversations/conversation', headers: { ...headers, origin: 'https://other.example' } })).statusCode).toBe(403)
    expect((await app.inject({ url: '/api/conversations/conversation', headers: { ...headers, 'x-sislexa-tenant-id': 'foreign' } })).statusCode).toBe(403)
    for (const extra of ['&tenantId=foreign', '&token=' + randomUUID(), '&session=' + randomUUID()]) {
      expect((await app.inject({ url: issued.socketUrl + extra, headers: { origin: headers.origin } })).statusCode).toBe(403)
    }
    now = issued.expiresAt
    expect((await app.inject({ url: '/api/conversations/conversation', headers })).statusCode).toBe(401)
    expect((await app.inject({ url: issued.socketUrl, headers: { origin: headers.origin } })).statusCode).toBe(401)
  } finally { await app.close() }
})

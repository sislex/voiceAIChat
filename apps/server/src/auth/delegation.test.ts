import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { createDelegationIntrospectionClient } from '@sislexa/identity/client/delegation'
import type { DelegatedPrincipal } from '@sislexa/identity/contracts/index'
import { ChatDelegation, registerChatDelegation, rejectsAttribution } from './delegation.js'
import type { VoiceChatDb } from '../db/database.js'

const fixtureCredential1 = randomUUID()
const fixtureCredential2 = randomUUID()

function fixture() {
  let active = true
  let now = 1000
  const principal: DelegatedPrincipal = {
    kind: 'delegated', userId: 'alice', tenantId: 'tenant', applicationId: 'assistant', grantId: 'grant',
    audience: 'core', issuedAt: 0, expiresAt: 2000,
    permissions: [
      { resource: { tenantId: 'tenant', type: 'conversation', id: 'chat' }, scopes: ['read', 'write', 'execute'] },
      { resource: { tenantId: 'tenant', type: 'project', id: 'project' }, scopes: ['read'] }
    ]
  }
  const requests: unknown[] = []
  const client = createDelegationIntrospectionClient({ url: 'https://identity.invalid', token: fixtureCredential2,
    now: () => now, fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify(active ? { version: 1, active: true, principal } : { version: 1, active: false }))
    } })
  let projectId: string | null = null
  const db = { chat: { getConversation: async (user: string, id: string) =>
    user === 'alice' && id === 'chat' ? { id, tenantId: 'tenant', projectId } : null },
    projects: { projectTenant: async (id: string) => id === 'project' ? { id: 'tenant' } : null } } as unknown as VoiceChatDb
  const authority = new ChatDelegation(client, db, () => now)
  return { authority, principal, requests, revoke: () => { active = false }, expire: () => { now = 2000 },
    project: () => { projectId = 'project' } }
}
const apps: ReturnType<typeof Fastify>[] = []
afterEach(async () => { for (const app of apps.splice(0)) await app.close() })

describe('Core delegated authorization', () => {
  it('uses the HTTP introspection adapter on every admission and rejects revoked or expired grants', async () => {
    const f = fixture()
    const reference = await f.authority.bind(fixtureCredential1, 'alice', 'tenant')
    await f.authority.authorize(reference, 'execute', 'chat')
    expect(f.requests).toHaveLength(2)
    expect(JSON.stringify(reference)).not.toContain(fixtureCredential1)
    expect(f.authority.attribution(reference)).toEqual({ version: 1, originApplicationId: 'assistant',
      executorApplicationId: 'core', tokenId: null, delegationId: 'grant' })
    f.revoke()
    await expect(f.authority.authorize(reference, 'execute', 'chat')).rejects.toThrow()
    const expired = fixture()
    const ref = await expired.authority.bind(fixtureCredential1, 'alice', 'tenant')
    expired.expire()
    await expect(expired.authority.authorize(ref, 'execute', 'chat')).rejects.toThrow()
  })
  it('preserves paired resource scopes and requires the stored project grant as well', async () => {
    const f = fixture()
    const reference = await f.authority.bind(fixtureCredential1, 'alice', 'tenant')
    await expect(f.authority.authorize(reference, 'read', 'other')).rejects.toThrow()
    f.project()
    await f.authority.authorize(reference, 'read', 'chat')
    await expect(f.authority.authorize(reference, 'execute', 'chat')).rejects.toThrow()
    await expect(f.authority.bind(fixtureCredential1, 'bob', 'tenant')).rejects.toThrow()
    await expect(f.authority.bind(fixtureCredential1, 'alice', 'other')).rejects.toThrow()
  })
  it('rejects rotated identity, forged references and queue replay without the originating credential', async () => {
    const f = fixture()
    const reference = await f.authority.bind(fixtureCredential1, 'alice', 'tenant')
    await expect(f.authority.current({ ...reference, applicationId: 'spoof' })).rejects.toThrow()
    f.principal.grantId = 'rotated'
    await expect(f.authority.current(reference)).rejects.toThrow()
    await expect(fixture().authority.current(JSON.parse(JSON.stringify(reference)))).rejects.toThrow()
  })
  it('enforces REST resources and rejects nested attribution before invoking a route', async () => {
    const f = fixture()
    const app = Fastify(); apps.push(app)
    app.decorateRequest('user', null)
    app.addHook('preHandler', async req => { req.user = { name: 'alice', account: { tenantId: 'tenant' } } as typeof req.user })
    registerChatDelegation(app, f.authority)
    app.get('/api/conversations/:id', async () => ({ ok: true }))
    app.post('/api/conversations/:id/messages', async () => ({ ok: true }))
    app.get('/api/conversations/:id/context-diff/:other', async () => ({ secret: true }))
    const headers = { 'x-sislexa-delegation': fixtureCredential1 }
    expect((await app.inject({ url: '/api/conversations/chat', headers })).statusCode).toBe(200)
    expect((await app.inject({ url: '/api/conversations/other', headers })).statusCode).toBe(403)
    expect((await app.inject({ url: '/api/conversations/chat/context-diff/other', headers })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: '/api/conversations/chat/messages', headers,
      payload: { meta: { application: { originApplicationId: 'spoof' } } } })).statusCode).toBe(400)
    f.revoke()
    expect((await app.inject({ url: '/api/conversations/chat', headers })).statusCode).toBe(403)
  })
  it('rejects client attribution without a delegated header too', () => {
    expect(rejectsAttribution({ applicationId: 'spoof' })).toBe(true)
    expect(rejectsAttribution({ values: { principal: {} } })).toBe(true)
    expect(rejectsAttribution({ text: 'ordinary message' })).toBe(false)
  })
})

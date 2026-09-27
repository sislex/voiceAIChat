import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { expect, it } from 'vitest'
import { buildServer } from './server.js'
import { loadConfig } from './config.js'
import { VoiceChatDb } from './db/database.js'
import type { DelegatedPrincipal } from '@sislexa/identity/contracts/index'

it('admits a server credential without cookies, isolates resources and preserves legacy login', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'core-delegation-'))
  const db = new VoiceChatDb(':memory:')
  const credential = randomUUID()
  const password = randomUUID()
  let active = true
  let principal!: DelegatedPrincipal
  const app = await buildServer({ db, config: loadConfig({ VC_DATA_DIR: dataDir, VC_DELEGATED_CHAT_ENABLED: 'true' }),
    delegationClient: { introspect: async input => active && Object.is(input.token, credential)
      ? { version: 1, active: true, principal } : { version: 1, active: false } } })
  try {
    const access = (await db.identity.getAccountAccess('admin'))!
    const conversation = await db.chat.createConversation('admin', 'Granted')
    const other = await db.chat.createConversation('admin', 'Private')
    principal = { kind: 'delegated', userId: 'admin', tenantId: access.tenant.id,
      applicationId: 'external', grantId: 'grant', audience: 'core', issuedAt: 0, expiresAt: Date.now() + 60_000,
      permissions: [{ resource: { tenantId: access.tenant.id, type: 'conversation', id: conversation.id }, scopes: ['read', 'execute'] }] }
    const headers = { 'x-sislexa-delegation': credential }
    const context = await app.inject({ url: '/api/chat/context?conversationId=' + conversation.id, headers })
    expect(context.statusCode).toBe(200)
    expect(context.json().context.application.originApplicationId).toBe('external')
    expect(context.headers['cache-control']).toBe('no-store')
    const frames: Array<{ t: string; snapshot?: { context: { application: { originApplicationId: string } } } }> = []
    const socket = await app.injectWS('/ws', { headers }, { onInit: ws => {
      ws.on('message', data => frames.push(JSON.parse(String(data))))
    } })
    const ready = once(socket, 'message')
    socket.send(JSON.stringify({ t: 'chat.connect', v: 1, conversationId: conversation.id }))
    await ready
    expect(frames.map(frame => frame.t)).toEqual(['chat.ready'])
    expect(frames[0]?.snapshot?.context.application.originApplicationId).toBe('external')
    active = false
    const closed = once(socket, 'close')
    socket.send(JSON.stringify({ t: 'chat.connect', v: 1, conversationId: conversation.id }))
    await closed
    active = true
    expect((await app.inject({ url: '/api/conversations/' + conversation.id, headers })).statusCode).toBe(200)
    for (const url of ['/api/conversations/' + other.id, '/api/conversations', '/api/settings', '/api/agents']) {
      expect((await app.inject({ url, headers })).statusCode).toBe(403)
    }
    expect((await app.inject({ url: '/api/conversations/' + conversation.id,
      headers: { ...headers, 'x-sislexa-tenant-id': 'other' } })).statusCode).toBe(403)
    active = false
    expect((await app.inject({ url: '/api/conversations/' + conversation.id, headers })).statusCode).toBe(403)
    active = true
    principal.expiresAt = Date.now() - 1
    expect((await app.inject({ url: '/api/conversations/' + conversation.id, headers })).statusCode).toBe(403)
    expect((await app.inject({ url: '/api/conversations/' + conversation.id })).statusCode).toBe(401)
    expect((await app.inject({ url: '/api/health' })).statusCode).toBe(200)
    await db.identity.createUser('legacy', password, 'developer')
    const login = await app.inject({ method: 'POST', url: '/api/session/login',
      payload: { name: 'legacy', password: password } })
    expect(login.statusCode).toBe(200)
    expect((await app.inject({ url: '/api/conversations', headers: { authorization: 'Bearer ' + login.json().token } })).statusCode).toBe(200)
  } finally {
    await app.close()
    await db.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})

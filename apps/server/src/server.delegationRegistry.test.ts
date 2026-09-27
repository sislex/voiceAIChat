import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { loadConfig } from './config.js'
import { VoiceChatDb } from './db/database.js'
import { buildServer } from './server.js'
import type { DelegationIntrospectionClient } from '@sislexa/identity/contracts/index'

const temporaryRoot = () => process.env.DELIVERY_ATTEMPT_ROOT
  ? join(process.env.DELIVERY_ATTEMPT_ROOT, 'tmp') : tmpdir()

it.each([undefined, 'false', '1', 'TRUE'])('denies delegated REST and WS without explicit opt-in (%s)', async value => {
  const dataDir = mkdtempSync(join(temporaryRoot(), 'delegation-disabled-'))
  const db = new VoiceChatDb(':memory:')
  const introspect = vi.fn<DelegationIntrospectionClient['introspect']>()
  const config = loadConfig({ VC_DATA_DIR: dataDir, VC_DELEGATED_CHAT_ENABLED: value })
  expect(config.delegatedChatEnabled).toBe(false)
  const app = await buildServer({ db, config, delegationClient: { introspect } })
  try {
    for (const url of ['/api/chat/context?conversationId=synthetic', '/api/conversations/synthetic']) {
      const response = await app.inject({ url, headers: { 'x-sislexa-delegation': 'synthetic-credential' } })
      expect(response.statusCode).toBe(403)
    }
    let closed!: Promise<unknown[]>
    const socket = await app.injectWS('/ws', { headers: { 'x-sislexa-delegation': 'synthetic-credential' } }, {
      onInit: ws => { closed = once(ws, 'close') }
    })
    try { await closed; expect(socket.readyState).toBe(3) } finally { socket.terminate() }
    expect(introspect).not.toHaveBeenCalled()
    expect((await app.inject({ url: '/api/health' })).statusCode).toBe(200)
  } finally {
    await app.close()
    await db.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})

it('uses issued Identity grants for scoped REST/WS, rotation and application revocation', async () => {
  const dataDir = mkdtempSync(join(temporaryRoot(), 'delegation-registry-'))
  const db = new VoiceChatDb(':memory:')
  // The embedded owner repository is the authority; no synthetic active verdicts.
  const client: DelegationIntrospectionClient = { async introspect({ token, audience }) {
    const principal = await db.identity.introspectApplicationGrant(token, audience)
    return principal ? { version: 1, active: true, principal } : { version: 1, active: false }
  } }
  const app = await buildServer({ db,
    config: loadConfig({ VC_DATA_DIR: dataDir, VC_DELEGATED_CHAT_ENABLED: 'true' }), delegationClient: client })
  let socket: Awaited<ReturnType<typeof app.injectWS>> | undefined
  try {
    const tenantId = (await db.identity.getAccountAccess('admin'))!.tenant.id
    const conversation = await db.chat.createConversation('admin', 'Synthetic acceptance')
    const privateConversation = await db.chat.createConversation('admin', 'Outside grant')
    const application = await db.identity.createApplication('admin', tenantId, 'Synthetic application')
    const issued = (await db.identity.issueApplicationGrant('admin', tenantId, application.id, {
      audience: 'core', expiresAt: Date.now() + 60_000,
      permissions: [{ resource: { tenantId, type: 'conversation', id: conversation.id }, scopes: ['read', 'execute'] }]
    }))!
    const read = (token: string, id = conversation.id) => app.inject({
      url: '/api/conversations/' + id, headers: { 'x-sislexa-delegation': token }
    })
    expect((await read(issued.token)).statusCode).toBe(200)
    expect((await read(issued.token, privateConversation.id)).statusCode).toBe(403)
    const snapshot = await app.inject({ url: '/api/chat/context?conversationId=' + conversation.id,
      headers: { 'x-sislexa-delegation': issued.token } })
    expect(snapshot.statusCode).toBe(200)
    expect(snapshot.json().context.application.originApplicationId).toBe(application.id)
    // No Billing is configured, so even an execute grant must not advertise paid execution.
    expect(snapshot.json().context.capabilities).toContainEqual({ id: 'chat.text', available: false, reason: 'host-unsupported' })
    const spoof = await app.inject({ url: '/api/chat/context?conversationId=' + conversation.id + '&originApplicationId=foreign',
      headers: { 'x-sislexa-delegation': issued.token } })
    expect(spoof.statusCode).toBe(400)

    socket = await app.injectWS('/ws', { headers: { 'x-sislexa-delegation': issued.token } })
    const ready = once(socket, 'message')
    socket.send(JSON.stringify({ t: 'chat.connect', v: 1, conversationId: conversation.id }))
    const [frame] = await ready
    expect(JSON.parse(String(frame))).toMatchObject({ t: 'chat.ready', snapshot: {
      context: { application: { originApplicationId: application.id } }
    } })

    const rotated = (await db.identity.rotateApplicationGrant('admin', tenantId, application.id, issued.grant.id))!
    expect((await read(issued.token)).statusCode).toBe(403)
    expect((await read(rotated.token)).statusCode).toBe(200)
    const closed = once(socket, 'close')
    socket.send(JSON.stringify({ t: 'chat.connect', v: 1, conversationId: conversation.id }))
    await closed
    socket = undefined

    await db.identity.renameApplication('admin', tenantId, application.id, 'Renamed synthetic application')
    expect((await read(rotated.token)).statusCode).toBe(200)
    await db.identity.revokeApplication('admin', tenantId, application.id)
    expect((await read(rotated.token)).statusCode).toBe(403)
    expect(await db.identity.listApplications('admin', tenantId)).toContainEqual(expect.objectContaining({
      id: application.id, name: 'Renamed synthetic application', revokedAt: expect.any(Number)
    }))
    expect(JSON.stringify(await db.identity.listApplicationGrants('admin', tenantId, application.id))).not.toContain(rotated.token)
  } finally {
    socket?.terminate()
    await app.close()
    await db.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})

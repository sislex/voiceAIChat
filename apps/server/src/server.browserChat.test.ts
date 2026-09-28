import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { buildServer } from './server.js'
import { VoiceChatDb } from './db/database.js'
import { loadConfig } from './config.js'

const origin = 'https://external.example'
const temp = () => process.env.DELIVERY_ATTEMPT_ROOT ? join(process.env.DELIVERY_ATTEMPT_ROOT, 'tmp') : tmpdir()

it('exchanges an authenticated browser session for REST, uploads and SDK WebSocket without shell frames', async () => {
  const directory = mkdtempSync(join(temp(), 'browser-chat-'))
  const db = new VoiceChatDb(':memory:')
  const app = await buildServer({ db, config: loadConfig({ VC_DATA_DIR: directory, VC_CORS_ORIGINS: origin }) })
  let socket: Awaited<ReturnType<typeof app.injectWS>> | undefined
  try {
    const password = randomUUID()
    await db.identity.createUser('external', password, 'developer')
    const login = await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'external', password } })
    expect(login.statusCode).toBe(200)
    const cookie = 'vc_session=' + login.json().token
    const conversation = await db.chat.createConversation('external', 'External sample')
    const second = await db.chat.createConversation('external', 'Another conversation')
    const foreign = await db.chat.createConversation('admin', 'Private')
    const team = await db.identity.createTeamTenant('external', 'Other tenant')
    const teamChat = await db.chat.createConversation('external', 'Team only', null, null, 'chat', team.tenant.id)
    const preflight = await app.inject({ method: 'OPTIONS', url: '/api/chat/session', headers: {
      origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,x-sislexa-delegation'
    } })
    expect(preflight.statusCode).toBe(204)
    expect(preflight.headers['access-control-allow-origin']).toBe(origin)
    expect(preflight.headers['access-control-allow-headers']).toContain('x-sislexa-delegation')
    expect((await app.inject({ method: 'POST', url: '/api/chat/session', headers: { origin } })).statusCode).toBe(401)
    for (const badOrigin of ['null', 'https://external.example.evil', 'https://external.example/']) {
      expect((await app.inject({ method: 'POST', url: '/api/chat/session', headers: { origin: badOrigin, cookie } })).statusCode).toBe(403)
    }
    expect((await app.inject({ method: 'POST', url: '/api/chat/session', headers: { cookie } })).statusCode).toBe(403)
    const issued = await app.inject({ method: 'POST', url: '/api/chat/session', headers: { origin, cookie } })
    expect(issued.statusCode).toBe(200)
    expect(issued.headers['cache-control']).toBe('no-store')
    const session = issued.json()
    expect(session.accessToken).not.toBe(login.json().token)
    const headers = { origin, authorization: 'Bearer ' + session.accessToken }
    expect((await app.inject({ url: '/api/conversations/' + conversation.id, headers })).statusCode).toBe(200)
    expect((await app.inject({ url: '/api/conversations/' + foreign.id, headers })).statusCode).toBe(404)
    expect((await app.inject({ url: '/api/settings', headers })).statusCode).toBe(403)
    expect((await app.inject({ url: '/api/conversations', headers: { ...headers, origin: 'https://other.example' } })).statusCode).toBe(403)
    expect((await app.inject({ url: '/api/conversations', headers: { ...headers, 'x-sislexa-tenant-id': 'foreign' } })).statusCode).toBe(403)
    const upload = await app.inject({ method: 'POST', url: '/api/uploads', headers,
      payload: { conversationId: conversation.id, name: 'hello.txt', dataBase64: Buffer.from('hello').toString('base64') } })
    expect(upload.statusCode).toBe(200)
    expect(upload.json().id).toBeTypeOf('string')
    expect((await app.inject({ method: 'POST', url: '/api/uploads', headers,
      payload: { conversationId: foreign.id, name: 'hello.txt', dataBase64: 'aGVsbG8=' } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: '/api/uploads', headers,
      payload: { conversationId: teamChat.id, name: 'hello.txt', dataBase64: 'aGVsbG8=' } })).statusCode).toBe(404)
    expect((await app.inject({ url: '/ws', headers: { origin: 'https://evil.example' } })).statusCode).toBe(403)
    const settings = await app.inject({ url: '/api/conversations/' + conversation.id + '/settings', headers })
    expect((await app.inject({ method: 'PATCH', url: '/api/conversations/' + conversation.id + '/settings', headers,
      payload: { version: 1, owner: 'conversation', expectedRevision: settings.json().revision, values: { title: 'Updated' } } })).statusCode).toBe(200)
    const frames: string[] = []
    socket = await app.injectWS(session.socketUrl, { headers: { origin } }, { onInit: ws => {
      ws.on('message', data => frames.push(JSON.parse(String(data)).t))
    } })
    const ready = once(socket, 'message')
    socket.send(JSON.stringify({ t: 'chat.connect', v: 1 }))
    const [frame] = await ready
    expect(JSON.parse(String(frame))).toMatchObject({ t: 'chat.ready', snapshot: { context: {
      principal: { userId: 'external' }, resources: { kind: 'all-conversations' }
    } } })
    expect(frames).toEqual(['chat.ready'])
    const rejectedAttachment = once(socket, 'message')
    socket.send(JSON.stringify({ t: 'claude.send', conversationId: second.id,
      segments: [{ speakerId: 1, text: 'Wrong attachment scope' }], attachments: [upload.json().id] }))
    expect(JSON.parse(String((await rejectedAttachment)[0]))).toMatchObject({ t: 'claude.error', message: 'attachment_not_allowed' })
    await db.identity.setUserBlocked('external', true)
    expect((await app.inject({ url: '/api/conversations/' + conversation.id, headers })).statusCode).toBe(401)
  } finally { socket?.terminate(); await app.close(); await db.close(); rmSync(directory, { recursive: true, force: true }) }
})

it('exchanges a live delegated grant, keeps its resource boundary and observes revocation', async () => {
  const directory = mkdtempSync(join(temp(), 'browser-delegated-'))
  const db = new VoiceChatDb(':memory:')
  const adminPassword = randomUUID()
  const app = await buildServer({ db, config: loadConfig({ VC_DATA_DIR: directory, VC_ADMIN_PASSWORD: adminPassword, VC_CORS_ORIGINS: origin, VC_DELEGATED_CHAT_ENABLED: 'true' }),
    delegationClient: { async introspect({ token, audience }) {
      const principal = await db.identity.introspectApplicationGrant(token, audience)
      return principal ? { version: 1, active: true, principal } : { version: 1, active: false }
    } } })
  let socket: Awaited<ReturnType<typeof app.injectWS>> | undefined
  try {
    const tenantId = (await db.identity.getAccountAccess('admin'))!.tenant.id
    const conversation = await db.chat.createConversation('admin', 'Shared')
    const privateChat = await db.chat.createConversation('admin', 'Private')
    const application = await db.identity.createApplication('admin', tenantId, 'Browser application')
    const grant = (await db.identity.issueApplicationGrant('admin', tenantId, application.id, { audience: 'core', expiresAt: Date.now() + 60_000,
      permissions: [{ resource: { tenantId, type: 'conversation', id: conversation.id }, scopes: ['read', 'execute'] }] }))!
    const publicSession = await app.inject({ method: 'POST', url: '/api/chat/session',
      headers: { origin, authorization: 'Bearer ' + grant.token } })
    expect(publicSession.statusCode).toBe(200)
    expect(publicSession.json().expiresAt).toBe(grant.grant.expiresAt)
    const publicHeaders = { origin, authorization: 'Bearer ' + publicSession.json().accessToken }
    expect((await app.inject({ url: '/api/conversations/' + privateChat.id, headers: publicHeaders })).statusCode).toBe(403)
    const login = await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'admin', password: adminPassword } })
    expect(login.statusCode).toBe(200)
    const backend = await app.inject({ method: 'POST', url: '/api/chat/session',
      headers: { authorization: 'Bearer ' + login.json().token, 'x-app-credential': grant.token } })
    expect(backend.statusCode).toBe(200)
    const backendHeaders = { authorization: 'Bearer ' + backend.json().accessToken }
    expect((await app.inject({ url: '/api/conversations/' + conversation.id, headers: backendHeaders })).statusCode).toBe(200)
    expect((await app.inject({ url: '/api/conversations/' + privateChat.id, headers: backendHeaders })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: '/api/chat/session',
      headers: { authorization: 'Bearer ' + login.json().token, 'x-app-credential': randomUUID() } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: '/api/chat/session',
      headers: { 'x-app-credential': grant.token } })).statusCode).toBe(403)
    const outsiderPassword = randomUUID()
    await db.identity.createUser('outsider', outsiderPassword, 'developer')
    const outsider = await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'outsider', password: outsiderPassword } })
    expect((await app.inject({ method: 'POST', url: '/api/chat/session',
      headers: { authorization: 'Bearer ' + outsider.json().token, 'x-app-credential': grant.token } })).statusCode).toBe(403)
    const issue = (id: string) => app.inject({ method: 'POST', url: '/api/chat/session?conversationId=' + id,
      headers: { origin, 'x-sislexa-delegation': grant.token } })
    expect((await issue(privateChat.id)).statusCode).toBe(403)
    const issued = await issue(conversation.id)
    expect(issued.statusCode).toBe(200)
    const session = issued.json()
    const headers = { origin, authorization: 'Bearer ' + session.accessToken }
    expect((await app.inject({ url: '/api/conversations/' + conversation.id, headers })).statusCode).toBe(200)
    expect((await app.inject({ url: '/api/conversations/' + privateChat.id, headers })).statusCode).toBe(403)
    const settings = await app.inject({ url: '/api/conversations/' + conversation.id + '/settings', headers })
    expect(settings.statusCode).toBe(200)
    expect(settings.json().account).toEqual({})
    expect((await app.inject({ method: 'POST', url: '/api/uploads', headers,
      payload: { conversationId: conversation.id, name: 'denied.txt', dataBase64: 'aGVsbG8=' } })).statusCode).toBe(403)
    socket = await app.injectWS(session.socketUrl, { headers: { origin } })
    const ready = once(socket, 'message')
    socket.send(JSON.stringify({ t: 'chat.connect', v: 1 }))
    expect(JSON.parse(String((await ready)[0]))).toMatchObject({ t: 'chat.ready', snapshot: { context: {
      application: { originApplicationId: application.id }, resources: { kind: 'conversation-ids', conversationIds: [conversation.id] }
    } } })
    await db.identity.revokeApplication('admin', tenantId, application.id)
    expect((await app.inject({ url: '/api/conversations/' + conversation.id, headers })).statusCode).toBe(403)
    const closed = once(socket, 'close')
    socket.send(JSON.stringify({ t: 'chat.connect', v: 1 }))
    await closed
  } finally { socket?.terminate(); await app.close(); await db.close(); rmSync(directory, { recursive: true, force: true }) }
})

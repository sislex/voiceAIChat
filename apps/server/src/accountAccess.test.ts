import { LocalImageStudioCore } from './imageStudioBridge/localCore.js'
import { afterEach, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import type { AddressInfo } from 'node:net'
import type { ServerMessage } from '@voicechat/shared'
import { accountContext } from '@sislexa/identity/server/users/productPolicy'
import { buildServer } from './server.js'
import { loadConfig } from './config.js'
import { VoiceChatDb } from './db/database.js'
import { signToken } from './users/accounts.js'
import { commandAccessError, TARIFF_DENIED } from './accountAccess.js'
import { createTurnManager } from './turns.js'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function fixture() {
  const db = new VoiceChatDb(':memory:'); cleanup.push(() => db.close())
  await db.identity.createUser('alice', '', 'developer')
  await db.identity.createUser('bob', '', 'developer')
  await db.identity.saveTariffPlan({ id: 'chat', name: 'Chat', capabilities: ['chat.use'] })
  await db.identity.assignUserTariff('alice', 'chat')
  const send = vi.fn(() => ({ cancel() {} }))
  const app = await buildServer({ config: loadConfig({ PORT: '0' }), db, claude: { send }, sessionSecret: 'tariff-test' })
  cleanup.push(() => app.close())
  const token = signToken({ name: 'alice', role: 'developer' }, 'tariff-test')
  return { app, db, send, token, headers: { authorization: 'Bearer ' + token } }
}

it('keeps account/history accessible while refusing product creation, mutation and foreign tenant hints', async () => {
  const { app, db, headers } = await fixture()
  const alice = await db.identity.getAccountAccess('alice'), bob = await db.identity.getAccountAccess('bob')
  expect(alice!.tenant.id).not.toBe(bob!.tenant.id)
  const create = (assistantKind?: string) => app.inject({ method: 'POST', url: '/api/conversations', headers, payload: { title: 'Test', assistantKind } })
  expect((await create('make')).statusCode).toBe(403)
  expect((await app.inject({ method: 'POST', url: '/api/conversations', headers, payload: { assistantKind: 'make', scope: 'kanban', projectId: 'fake' } })).statusCode).toBe(403)
  expect((await create()).statusCode).toBe(200)
  const make = await db.chat.createConversation('alice', 'Existing Make', 'make', null, 'make')
  expect((await app.inject({ url: '/api/conversations/' + make.id + '?scope=make', headers })).statusCode).toBe(200)
  expect((await app.inject({ method: 'POST', url: '/api/conversations/' + make.id + '/preview-url', headers, payload: { previewUrl: 'https://example.test' } })).statusCode).toBe(403)
  expect((await app.inject({ url: '/api/session/account-access', headers })).json()).toMatchObject({ systemRole: 'developer', tariff: { id: 'chat' } })
  expect((await app.inject({ url: '/api/session/account-access', headers: { ...headers, 'x-sislexa-tenant-id': bob!.tenant.id } })).statusCode).toBe(403)
  const capabilities = (await app.inject({ url: '/api/system/capabilities', headers })).json()
  expect(capabilities.stt).toMatchObject({ available: false, reason: TARIFF_DENIED })
  expect(capabilities.tts).toMatchObject({ available: false, reason: TARIFF_DENIED })
})

it('checks owned conversation kind and speech capability before dispatching WebSocket work', async () => {
  const { db } = await fixture()
  const account = (await db.identity.getAccountAccess('alice'))!
  const user = { name: 'alice', role: account.systemRole, account: accountContext(account) }
  const own = await db.chat.createConversation('alice', 'Make', 'make', null, 'make')
  const foreign = await db.chat.createConversation('bob', 'Private')
  expect(await commandAccessError(db, user, { t: 'audio.start', sampleRate: 16000 })).toMatchObject({ t: 'stt.error' })
  expect(await commandAccessError(db, user, { t: 'tts.speak', text: 'Test', voice: '' })).toMatchObject({ t: 'tts.error' })
  expect(await commandAccessError(db, user, { t: 'claude.send', conversationId: own.id, segments: [] })).toMatchObject({ message: TARIFF_DENIED })
  expect(await commandAccessError(db, user, { t: 'claude.cancel', conversationId: foreign.id })).toMatchObject({ message: 'Разговор недоступен.' })
  expect(await commandAccessError(db, user, { t: 'claude.cancel', conversationId: own.id })).toBeNull()
})

it('rechecks current entitlements at LLM execution even without an HTTP or WebSocket handler', async () => {
  const { db, send } = await fixture()
  const conversation = await db.chat.createConversation('alice', 'Make', 'make', null, 'make')
  const turns = createTurnManager({ db, claude: { send } }), messages: ServerMessage[] = []
  const off = turns.subscribe(message => messages.push(message))
  await turns.start({ userId: 'alice', conversationId: conversation.id, segments: [{ speakerId: 1, text: 'Run' }] })
  off()
  expect(send).not.toHaveBeenCalled()
  expect(messages).toContainEqual({ t: 'claude.error', conversationId: conversation.id, message: TARIFF_DENIED })
})

it('closes an already authenticated socket after a tariff change before accepting another command', async () => {
  const { app, db, token, send } = await fixture()
  await app.listen({ port: 0, host: '127.0.0.1' })
  const ws = new WebSocket(`ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/ws?token=${token}`)
  cleanup.push(async () => { ws.terminate() })
  await new Promise<void>((resolve, reject) => {
    ws.on('error', reject)
    ws.on('message', data => { if (JSON.parse(data.toString()).t === 'claude.active') resolve() })
    ws.on('close', () => reject(new Error('Closed before authentication')))
  })
  await db.identity.saveTariffPlan({ id: 'chat', name: 'Closed', capabilities: [], expectedRevision: 1 })
  const closed = new Promise<number>(resolve => ws.once('close', resolve))
  ws.send(JSON.stringify({ t: 'audio.start', sampleRate: 16000 }))
  expect(await closed).toBe(4001)
  expect(send).not.toHaveBeenCalled()
})

it('rechecks image generation after work has been queued in the independent application', async () => {
  const { db, send } = await fixture()
  const core = new LocalImageStudioCore({ db, client: { send }, profileHome: () => '/unused', readGenerated: async () => null })
  await expect(core.generate('alice', { prompt: 'Generate' })).rejects.toThrow(TARIFF_DENIED)
  expect(send).not.toHaveBeenCalled()
})

it('checks each Reader capability independently at the model callback boundary', async () => {
  const { db, app } = await fixture()
  const { createLocalPlaywrightReaderCore } = await import('./playwrightReaderBridge/localCore.js')
  const { createLocalReaderCore } = await import('./readerBridge/localCore.js')
  const relay = { request: vi.fn() }
  const chromium = createLocalPlaywrightReaderCore({ db, issuePreviewRunKey: async () => '', logBrowserShot: async () => {} })
  const reader = createLocalReaderCore({ app, db, relay, machines: { isOnline: () => false, http: vi.fn() }, runKeys: { issue: () => '' }, previews: async () => [], shotsRoot: '/unused', publish: () => {} })
  const conversation = await db.chat.createConversation('alice', 'Reader', 'web-recorder', null, 'web-reader')
  expect(await chromium.modelTarget('alice', conversation.id)).toBeNull()
  await expect(reader.previewAction('alice', conversation.id, { kind: 'status' })).rejects.toThrow(TARIFF_DENIED)
  expect(relay.request).not.toHaveBeenCalled()
  await db.identity.saveTariffPlan({ id: 'web', name: 'Web', capabilities: ['web-reader.use'] })
  await db.identity.assignUserTariff('alice', 'web')
  await reader.previewAction('alice', conversation.id, { kind: 'status' })
  expect(relay.request).toHaveBeenCalledOnce()
  expect(await chromium.modelTarget('alice', conversation.id)).toBeNull()
})

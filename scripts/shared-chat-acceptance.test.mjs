import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { WebSocketServer } from 'ws'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { createConsumer } from './shared-chat-artifacts.mjs'
import { settingsPort, websocketPort } from './shared-chat-ports.mjs'
import { VoiceChatDb } from '../apps/server/src/db/database.ts'
import { registerChatSettingsRoutes } from '../apps/server/src/routes/chatSettings.ts'
import { attachWs } from '../apps/server/src/ws.ts'

const hosts = ['main/widget', 'console/widget', 'task/kanban', 'make/widget', 'web-reader/widget', 'playwright-reader/widget', 'desktop/widget']
const until = async predicate => {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await delay(20) }
  assert.fail('Timed out waiting for transport event')
}

test('published Make and Reader adapters use real scoped Core resources and independent runtime lifecycles', async () => {
  const consumer = await createConsumer(), db = new VoiceChatDb(':memory:'), runtimes = []
  try {
    const { createChatRuntime } = await consumer.importChat('runtime/chatRuntime')
    const { createMakeChatAdapter, createWebReaderChatAdapter, createPlaywrightReaderChatAdapter } = await consumer.importChat('runtime/hostAdapters')
    const make = await db.chat.createConversation('alice', 'Make', 'make')
    const web = await db.chat.createConversation('alice', 'Page', 'web-recorder')
    const browser = await db.chat.createConversation('alice', 'Browser', 'playwright-reader')
    const foreign = await db.chat.createConversation('bob', 'Private', 'web-recorder')
    // Concrete repository-backed consumer port; ownership and scope checks remain in Core.
    const client = {
      turn: { enabled: false },
      'conversations:list': options => db.chat.listConversations('alice', options),
      'conversations:get': async ({ id, ...context }) => {
        const conversation = await db.chat.getConversation('alice', id, context)
        return conversation ? { conversation, messages: [] } : null
      },
      'conversations:setPreviewUrl': ({ id, previewUrl }) => db.chat.setConversationPreviewUrl('alice', id, previewUrl),
      'conversations:taskChats': async () => [],
      'conversations:taskContext': async () => null
    }
    const values = new Map(), prefs = { get: key => values.get(key) ?? null, set: (key, value) => values.set(key, value), remove: key => values.delete(key) }
    const voice = { state: () => 'idle', resetForChatSwitch() {}, cancelTimers() {}, cancelSpeech() {} }
    for (const preferenceNamespace of ['widget', 'kanban']) {
      const runtime = createChatRuntime({ chat: client, prefs, voice, preferenceNamespace, getSettings: () => ({}), listAgents: () => [], download: { file() {} } })
      runtimes.push(runtime); await runtime.start()
    }
    const [widget, kanban] = runtimes
    assert.equal(await widget.store.actions.selectConversation(make.id, { scope: 'make' }), true)
    assert.equal(await kanban.store.actions.selectConversation(web.id, { scope: 'web-reader' }), true)
    const makeAdapter = createMakeChatAdapter(widget.store, make.id)
    makeAdapter.onInsertToChat('Make context')
    assert.equal(widget.store.getState().draft, 'Make context')
    assert.equal(kanban.store.getState().draft, '')
    const reader = createWebReaderChatAdapter(widget.store, client, () => null)
    const playwright = createPlaywrightReaderChatAdapter(widget.store, client, () => null)
    assert.deepEqual((await reader.list()).map(item => item.id), [web.id])
    assert.deepEqual((await playwright.list()).map(item => item.id), [browser.id])
    assert.equal(await reader.get(browser.id), null)
    assert.equal(await playwright.get(web.id), null)
    assert.equal(await reader.get(foreign.id), null)
    assert.equal(await reader.setPreviewUrl(foreign.id, 'https://example.com/blocked'), null)
    await reader.setPreviewUrl(web.id, 'https://example.com/page')
    assert.equal((await db.chat.getConversation('alice', web.id, { scope: 'web-reader' })).previewUrl, 'https://example.com/page')
    await widget.store.actions.selectConversation(web.id, { scope: 'web-reader' })
    assert.throws(() => makeAdapter.onInsertToChat('stale Make context'), /no longer selected/)
    widget.dispose()
    assert.throws(() => widget.store.actions.setDraft('disposed'), /disposed/)
    kanban.store.actions.setDraft('still mounted')
    assert.equal(kanban.store.getState().draft, 'still mounted')
  } finally { runtimes.forEach(runtime => runtime.dispose()); await db.close(); consumer.close() }
})

test('published settings controller shares persisted revisions across every host and keeps device/resource boundaries', async () => {
  const consumer = await createConsumer(), app = Fastify(), db = new VoiceChatDb(':memory:')
  const controllers = []
  try {
    const { createSettingsController } = await consumer.importChat('runtime/settingsController')
    app.decorateRequest('user', null)
    app.addHook('preHandler', async req => { req.user = { name: req.headers.authorization === 'Bearer alice' ? 'alice' : 'bob', role: 'developer' } })
    registerChatSettingsRoutes(app, db)
    const conversation = await db.chat.createConversation('alice', 'Shared'), foreign = await db.chat.createConversation('bob', 'Private')
    const request = async (url, options) => {
      const response = await app.inject({ method: options.method, url: new URL(url).pathname, headers: options.headers, payload: options.body })
      return { ok: response.statusCode < 400, status: response.statusCode, json: async () => response.json() }
    }
    const ports = hosts.map(() => settingsPort('http://core.test', 'alice', request))
    for (const [index, host] of hosts.entries()) {
      const controller = createSettingsController(ports[index], conversation.id); controllers.push(controller)
      await controller.load(); assert.equal(controller.getState().status, 'ready', host)
      assert.equal(await controller.save('conversation', { title: host }), true, host)
      controller.setDevice({ micDeviceId: host })
    }
    // Two independently mounted hosts contend on the same server revision.
    await controllers[0].load(); await controllers[1].load()
    assert.equal(await controllers[0].save('conversation', { title: 'winner' }), true)
    assert.equal(await controllers[1].save('conversation', { title: 'stale' }), false)
    assert.equal(controllers[1].getState().status, 'conflict')
    for (const [index, controller] of controllers.entries()) {
      await controller.load()
      assert.equal(controller.getState().snapshot.conversation.title, 'winner')
      assert.equal(controller.getState().snapshot.device.micDeviceId, hosts[index])
    }
    await assert.rejects(ports[0].get(foreign.id), error => error.status === 404)
    await assert.rejects(ports[0].patch({ version: 1, owner: 'conversation', expectedRevision: 0, values: { title: 'stolen' } }, foreign.id), error => error.status === 404)
    await assert.rejects(ports[0].patch({ version: 1, owner: 'device', expectedRevision: 0, values: { micDeviceId: 'remote' } }, conversation.id), error => error.status === 400)
    assert.deepEqual((await db.settings.getChatSettings('alice', conversation.id)).device, {})
  } finally { controllers.forEach(controller => controller.dispose()); await app.close(); await db.close(); consumer.close() }
})

test('exact published transport adapter traverses Core WS dispatch, reconnects and disposes independent subscriptions', async () => {
  const consumer = await createConsumer()
  let server, transport, adapter, second
  try {
    const { createSdkChatAdapter } = await consumer.importChat('runtime/sdkAdapter')
    const ports = (process.env.DELIVERY_PORTS ?? '').match(/\d+/g)?.map(Number)
    if (process.env.DELIVERY_ATTEMPT_ROOT && !ports?.length) throw Error('Missing assigned DELIVERY_PORTS')
    server = new WebSocketServer({ host: '127.0.0.1', port: ports?.[0] ?? 0 })
    await once(server, 'listening')
    const received = [], contexts = []
    server.on('connection', socket => {
      void attachWs(socket, { onOpen: async ctx => { contexts.push(ctx); ctx.send({ t: 'claude.active', turns: [{ conversationId: 'shared', text: 'recovered' }] }) }, onMessage: async message => { received.push(message) } })
    })
    transport = websocketPort('ws://127.0.0.1:' + server.address().port)
    const events = [], other = [], handlers = target => ({ turnActive: turns => target.push(['active', turns]), turnToken: (text, id) => target.push(['token', text, id]), turnQueue: (id, items) => target.push(['queue', id, items]), turnError: (text, id) => target.push(['error', text, id]) })
    const sdk = { transport, attachments: { upload: async () => { throw Error('No upload fixture') } } }
    adapter = createSdkChatAdapter(sdk); second = createSdkChatAdapter(sdk)
    adapter.events(handlers(events)); second.events(handlers(other))
    await transport.connect(); await until(() => events.length === 1)
    adapter.turn.send('shared', [{ speakerId: 1, text: 'hello' }], ['attachment-id'], false, null, 'message-id')
    adapter.turn.editQueued('shared', 'queued-id', 'edited'); adapter.turn.cancel('shared')
    await until(() => received.length === 3)
    assert.deepEqual(received.map(message => message.t), ['claude.send', 'claude.queue.edit', 'claude.cancel'])
    assert.deepEqual(received[0].attachments, ['attachment-id'])
    contexts[0].send({ t: 'claude.token', conversationId: 'shared', delta: 'stream' })
    contexts[0].send({ t: 'claude.queue', conversationId: 'shared', items: [], paused: false })
    contexts[0].send({ t: 'claude.error', conversationId: 'other-resource', message: 'scoped' })
    await until(() => events.length === 4)
    assert.deepEqual(events.slice(1), [['token', 'stream', 'shared'], ['queue', 'shared', []], ['error', 'scoped', 'other-resource']])
    adapter.dispose(); const count = events.length
    await transport.disconnect(); assert.throws(() => second.turn.cancel('shared'), /not ready/)
    await transport.connect(); await until(() => other.length === 5)
    assert.equal(events.length, count); assert.equal(other.at(-1)[0], 'active')
    assert.throws(() => adapter.turn.cancel('shared'), /disposed/)
  } finally {
    adapter?.dispose(); second?.dispose(); await transport?.dispose()
    if (server) { for (const client of server.clients) client.terminate(); await new Promise(resolve => server.close(resolve)) }
    consumer.close()
  }
})

async function chatStoreFixture() {
  const consumer = await createConsumer()
  const { createChatStore } = await consumer.importChat('store/chatStore')
  const snapshots = new Map()
  const conversation = id => ({ id, title: id, scope: 'chat', createdAt: 1, updatedAt: 1, claudeSessionId: null, execTarget: null })
  for (const id of ['active', 'background']) snapshots.set(id, { conversation: conversation(id), messages: [] })
  const empty = async () => []
  const client = new Proxy({
    turn: { enabled: false },
    'conversations:get': async ({ id }) => snapshots.get(id) ?? null,
    'conversations:list': empty,
    'conversations:taskContext': async () => null,
    'conversations:taskChats': empty
  }, { get: (target, property) => property in target ? target[property] : empty })
  const voice = {
    state: () => 'idle', dispatch: () => true, restoreThinking: () => true, beginTurn() {},
    speakDelta() {}, finishStreamedTurn: () => true, speakReply() {}, autoSpeakActive: () => false,
    cancelSpeech() {}, cancelTimers() {}, resetForChatSwitch() {}
  }
  const store = createChatStore({
    chat: client,
    prefs: { get: () => null, set() {}, remove() {} },
    voice,
    getSettings: () => ({}),
    listAgents: () => [],
    download: { file() {} }
  })
  return { consumer, store, snapshots, conversation }
}

// @testCase TC-CLIENT-01
test('published chat store merges optimistic, realtime and HTTP confirmations by Message.id', async () => {
  const fixture = await chatStoreFixture()
  try {
    await fixture.store.actions.selectConversation('active')
    const optimistic = { id: 'stable-1', conversationId: 'active', role: 'u1', text: 'draft', time: '10:00', createdAt: 1 }
    const persisted = { ...optimistic, text: 'persisted', createdAt: 2 }
    fixture.store.actions.applyChatMessage('active', optimistic)
    fixture.store.actions.applyChatMessage('active', persisted)
    fixture.store.actions.applyChatMessage('active', persisted)
    fixture.snapshots.set('active', { conversation: fixture.conversation('active'), messages: [persisted] })
    await fixture.store.actions.reloadActiveMessages()

    assert.deepEqual(fixture.store.getState().messages.map(message => [message.id, message.text]), [['stable-1', 'persisted']])
  } finally {
    fixture.store.dispose()
    fixture.consumer.close()
  }
})

// @testCase TC-CLIENT-02
test('published chat store caches an inactive conversation without replacing the visible timeline', async () => {
  const fixture = await chatStoreFixture()
  try {
    await fixture.store.actions.selectConversation('active')
    const activeMessage = { id: 'active-1', conversationId: 'active', role: 'u1', text: 'visible', time: '10:00', createdAt: 1 }
    const backgroundMessage = { id: 'background-1', conversationId: 'background', role: 'u1', text: 'cached', time: '10:01', createdAt: 2 }
    fixture.store.actions.applyChatMessage('active', activeMessage)
    fixture.store.actions.applyChatMessage('background', backgroundMessage)
    fixture.store.actions.applyChatMessage('background', backgroundMessage)

    assert.deepEqual(fixture.store.getState().messages.map(message => message.id), ['active-1'])
    await fixture.store.actions.selectConversation('background')
    assert.deepEqual(fixture.store.getState().messages.map(message => message.id), ['background-1'])
  } finally {
    fixture.store.dispose()
    fixture.consumer.close()
  }
})

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { REST, type LlmClient, type LlmRequest } from '@voicechat/shared'
import { INTERNAL_IMAGE_STUDIO_GENERATE_PATH } from '@voicechat/image-studio-contracts/imageStudioInternal'
import { signToken } from '@sislexa/identity/server/users/accounts'
import { buildServer, type BuildOptions } from './server.js'
import { RemoteLlmClient } from './llm/remoteClient.js'
import { BillingSessions } from './billing/sessions.js'
import { loadConfig } from './config.js'
import { VoiceChatDb } from './db/database.js'
import * as turns from './turns.js'
import { KbResearchManager } from './kb/research.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.restoreAllMocks() })

async function fixture(textOnly: boolean | undefined, env: Record<string, string> = {}, options: Pick<BuildOptions, 'codex' | 'billingTransport'> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'public-chat-auxiliary-'))
  const root = join(directory, 'knowledge')
  mkdirSync(root)
  for (const name of ['one', 'two']) writeFileSync(join(root, `${name}.md`), `# ${name}\n\nThe garden has a quiet pond.\n`)
  const db = new VoiceChatDb(':memory:')
  await db.identity.createUser('visitor', '', 'developer')
  const requests: LlmRequest[] = []
  const client: LlmClient = { send(request, handlers) {
    requests.push(request)
    queueMicrotask(() => handlers.onDone(request.model === '' ? '{"selected":[]}' : 'Synthetic answer'))
    return { cancel() {} }
  } }
  const original = turns.createTurnManager
  let manager: ReturnType<typeof original> | undefined
  vi.spyOn(turns, 'createTurnManager').mockImplementation(deps => (manager = original(deps)))
  const retouch = vi.fn(async () => Buffer.from('unused'))
  const app = await buildServer({ config: loadConfig({ VC_DATA_DIR: directory, VC_KB_ROOT: root,
    ...(textOnly === undefined ? {} : { VC_CHAT_TEXT_ONLY: String(textOnly) }), VC_INTERNAL_TOKEN: 'synthetic-internal',
    VC_CHAT_MODELS: 'codex:gpt-5.6-luna', ...env }), db, codex: client, claude: client,
    sessionSecret: 'synthetic-secret', imageRetouchGenerator: retouch, ...options })
  cleanup.push(async () => { await app.close(); await db.close(); rmSync(directory, { recursive: true, force: true }) })
  const headers = (name = 'visitor') => ({ authorization: `Bearer ${signToken({ name, role: name === 'admin' ? 'admin' : 'developer' }, 'synthetic-secret')}` })
  return { app, db, requests, retouch, headers, manager: manager! }
}

it.each([undefined, 'codex', 'claude'])('keeps ambiguous public KB queries lexical with reranker override %s', async provider => {
  const f = await fixture(true, provider ? { VC_KB_RERANK_PROVIDER: provider } : {})
  for (const name of ['visitor', 'admin']) {
    const response = await f.app.inject({ url: '/api/kb/search?q=garden', headers: f.headers(name) })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toHaveLength(2)
    expect(response.json().every((row: { matchTypes: string[] }) => !row.matchTypes.includes('semantic'))).toBe(true)
    expect((await f.app.inject({ url: '/api/kb/context?q=garden', headers: f.headers(name) })).statusCode).toBe(200)
  }
  for (const title of ['first', 'second']) await f.db.kb.saveKbDocument({
    scope: 'user', ownerId: 'visitor', projectId: null, title, body: 'The orchard has a quiet pond.', createdBy: 'visitor'
  })
  const stored = await f.app.inject({ url: '/api/kb/search?q=orchard&scope=user', headers: f.headers() })
  expect(stored.statusCode).toBe(200)
  expect(stored.json()).toHaveLength(2)
  expect(f.requests).toEqual([])
})

it.each([false, undefined])('retains semantic KB ranking when the trusted public policy is %s', async policy => {
  const f = await fixture(policy)
  expect((await f.app.inject({ url: '/api/kb/search?q=garden', headers: f.headers() })).json()).toHaveLength(2)
  expect(f.requests).toHaveLength(1)
  expect(f.requests[0]?.model).toBe('')
})

it('runs only the selected model for an ambiguous public chat and never auto-summarizes forty messages', async () => {
  const f = await fixture(true)
  const conversation = await f.db.chat.createConversation('visitor', 'Public chat')
  for (let index = 0; index < 40; index++) await f.db.chat.addMessage('visitor', conversation.id, 'u0', `message ${index}`, '')
  await f.manager.start({ userId: 'visitor', conversationId: conversation.id, segments: [{ speakerId: 1, text: 'garden' }] })
  await f.manager.idle()
  expect((await f.db.chat.listMessages('visitor', conversation.id)).at(-1)?.text).toBe('Synthetic answer')
  expect(f.requests.map(request => request.model)).toEqual(['gpt-5.6-luna'])
  expect((await f.db.chat.getConversation('visitor', conversation.id))?.summary).toBeUndefined()
})

it.each(['visitor', 'admin'])('denies explicit public summaries for %s while keeping stored summaries readable', async name => {
  const f = await fixture(true)
  const conversation = await f.db.chat.createConversation(name, 'Stored summary')
  const message = await f.db.chat.addMessage(name, conversation.id, 'u0', 'Summarize me', '')
  const summary = { text: 'Previous durable summary', coversUntilMessageId: message.id, updatedAt: 123 }
  await f.db.chat.setConversationSummary(name, conversation.id, summary)
  const read = await f.app.inject({ url: REST.conversationSummary(conversation.id), headers: f.headers(name) })
  expect(read.json()).toEqual(summary)
  const refresh = await f.app.inject({ method: 'POST', url: REST.conversationSummaryRefresh(conversation.id), headers: f.headers(name) })
  expect(refresh.statusCode).toBe(503)
  expect(refresh.json().error).toBe('summary runner unavailable')
  expect(f.requests).toEqual([])
  expect((await f.db.chat.getConversation(name, conversation.id))?.summary).toEqual(summary)
})

it.each([false, undefined])('keeps explicit summaries available in ordinary mode %s', async policy => {
  const f = await fixture(policy)
  const conversation = await f.db.chat.createConversation('visitor', 'Summary')
  await f.db.chat.addMessage('visitor', conversation.id, 'u0', 'Summarize me', '')
  const response = await f.app.inject({ method: 'POST', url: REST.conversationSummaryRefresh(conversation.id), headers: f.headers() })
  expect(response.statusCode).toBe(200)
  expect(response.json().text).toBe('Synthetic answer')
  expect(f.requests).toHaveLength(1)
})

it.each(['visitor', 'admin'])('rejects public research and retouch before reads or generation for %s without an application selector', async name => {
  const f = await fixture(true)
  const start = vi.spyOn(KbResearchManager.prototype, 'start')
  const readConversation = vi.spyOn(f.db.chat, 'getConversation')
  const readProject = vi.spyOn(f.db.projects, 'getProject')
  for (const url of ['/api/projects/unused/kb/research', REST.imageRetouch]) {
    const response = await f.app.inject({ method: 'POST', url, headers: f.headers(name), payload: { chatTextOnly: false, enabled: true } })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ error: 'auxiliary_model_disabled', message: expect.any(String) })
  }
  expect(readProject).not.toHaveBeenCalled()
  expect(readConversation).not.toHaveBeenCalled()
  expect(start).not.toHaveBeenCalled()
  expect(f.retouch).not.toHaveBeenCalled()
  expect(f.requests).toEqual([])
  expect((await f.app.inject({ method: 'POST', url: '/api/prompt/suggest', headers: f.headers(name), payload: { chatTextOnly: false, enabled: true } })).statusCode).toBe(404)
})

it('blocks the authenticated internal image-generation path before settings or raw models', async () => {
  const f = await fixture(true)
  const settings = vi.spyOn(f.db.settings, 'getSettings')
  const response = await f.app.inject({ method: 'POST', url: INTERNAL_IMAGE_STUDIO_GENERATE_PATH,
    headers: { authorization: 'Bearer synthetic-internal' }, payload: { userId: 'visitor', prompt: 'Generate an image' } })
  expect(response.statusCode).toBe(503)
  expect(response.json().error).toBe('auxiliary_model_disabled')
  expect(settings).not.toHaveBeenCalled()
  expect(f.requests).toEqual([])
})

it.each(['codex', 'upstream'])('disables the configured %s gateway before dispatch in public mode', async backend => {
  const f = await fixture(true, { VC_CLAUDE_GATEWAY_BACKEND: backend, VC_CLAUDE_UPSTREAM_URL: 'https://synthetic.invalid' })
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected upstream call'))
  for (const url of ['/v1/messages', '/v1/messages/count_tokens']) {
    const response = await f.app.inject({ method: 'POST', url, payload: { model: 'any', messages: [] } })
    expect(response.statusCode).toBe(503)
    expect(response.json().error.message).toContain('disabled')
  }
  expect(fetch).not.toHaveBeenCalled()
  expect(f.requests).toEqual([])
})


it('does not spend on ambiguous auto-KB before a real daily-budget admission denial', async () => {
  const runnerFetch = vi.fn<typeof fetch>(async input => {
    const url = String(input)
    if (url.endsWith('/v1/health')) return Response.json({ accountingVersion: 1, application: { version: '0.3.8' } })
    throw new Error('Unexpected raw model dispatch: ' + url)
  })
  const billingFetch = vi.fn<typeof fetch>(async input => {
    expect(String(input)).toBe('https://billing.invalid/v1/billing/reservations')
    return Response.json({ error: 'daily_user_budget_exhausted' }, { status: 403 })
  })
  vi.spyOn(BillingSessions.prototype, 'authorization').mockReturnValue('Bearer synthetic-session')
  const f = await fixture(true, { VC_KB_RERANK_PROVIDER: 'codex' }, {
    codex: new RemoteLlmClient({ kind: 'codex', baseUrl: 'https://runner.invalid', fetchImpl: runnerFetch }),
    billingTransport: { url: 'https://billing.invalid', environmentId: 'synthetic', fetchImpl: billingFetch }
  })
  const conversation = await f.db.chat.createConversation('visitor', 'Budget exhausted')
  const errors: string[] = []
  const unsubscribe = f.manager.subscribe(frame => { if (frame.t === 'claude.error') errors.push(frame.message) })
  try {
    await f.manager.start({ userId: 'visitor', conversationId: conversation.id,
      billingSession: { sid: 'synthetic', userId: 'subject', tenantId: 'tenant' },
      segments: [{ speakerId: 1, text: 'garden' }] })
    await f.manager.idle()
    await vi.waitFor(() => expect(errors).toContain('Дневной лимит расходов исчерпан. Новые запросы будут доступны после начала следующих суток.'))
    expect(billingFetch).toHaveBeenCalledOnce()
    expect(runnerFetch.mock.calls.map(([url]) => String(url))).toEqual(['https://runner.invalid/v1/health'])
    expect(f.requests).toEqual([])
  } finally { unsubscribe() }
})

it('rejects public auxiliary writes before parsing malformed bodies and retains research reads', async () => {
  const f = await fixture(true)
  for (const url of [REST.imageRetouch, '/api/projects/unused/kb/research', '/v1/messages', '/v1/messages/count_tokens']) {
    const response = await f.app.inject({ method: 'POST', url, headers: { ...f.headers(), 'content-type': 'application/json' }, payload: '{' })
    expect(response.statusCode).toBe(503)
  }
  const project = await f.db.projects.createProject('visitor', { name: 'Read-only state', description: '' })
  const response = await f.app.inject({ url: `/api/projects/${project.id}/kb/research`, headers: f.headers() })
  expect(response.statusCode).toBe(200)
  expect(response.json()).toBeNull()
  expect(f.requests).toEqual([])
})

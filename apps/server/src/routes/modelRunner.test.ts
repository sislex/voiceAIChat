import { afterEach, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BillingStore, BillingError, buildBillingServer } from '@sislexa/billing'
import { signToken, verifyToken } from '@sislexa/identity/server/users/accounts'
import type { LlmExecutionReceipt, LlmRunBody } from '@voicechat/shared'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { RemoteLlmClient } from '../llm/remoteClient.js'
import { modelTokenAuthority } from '../auth/modelTokens.js'

const cleanup: Array<() => unknown | Promise<unknown>> = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
async function fixture(env: NodeJS.ProcessEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'model-api-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const db = new VoiceChatDb(':memory:')
  cleanup.push(() => db.close())
  const ledger = new BillingStore(join(dir, 'billing.sqlite'))
  let token = signToken({ name: 'admin', role: 'admin' }, 'secret')
  const billing = buildBillingServer(ledger, {
    environmentId: 'test',
    async verifyUser(credential) {
      if (credential !== 'Bearer ' + token) throw new BillingError(401, 'unauthorized')
      const access = await db.identity.getAccountAccess('admin')
      return { userId: access!.userId!, tenantId: access!.tenant.id, role: 'admin', capabilities: ['chat.use'] }
    },
    async verifyDelegation() { throw new BillingError(403, 'delegation_denied') },
    async verifyComponent() { return { consumerId: 'core' } }
  })
  const billingUrl = await billing.listen({ port: 0, host: '127.0.0.1' })
  cleanup.push(async () => { await billing.close(); ledger.close() })
  const runner = Fastify({ forceCloseConnections: true })
  const bodies: LlmRunBody[] = [], receipts = new Map<string, LlmExecutionReceipt>()
  let release: (() => void) | undefined, hold: Promise<void> | undefined
  runner.get('/v1/health', async () => ({ ok: true, accountingVersion: 1, application: { version: '0.3.8' },
    bins: { codex: { present: true, version: null }, claude: { present: true, version: null } }, login: {}, runs: 0 }))
  runner.get<{ Params: { id: string } }>('/v1/execution-receipts/:id', async (req, reply) =>
    receipts.get(req.params.id) ?? reply.code(404).send({ error: 'not_found' }))
  const finish = (body: LlmRunBody) => {
    receipts.set(body.runId!, { version: 1, runId: body.runId!, context: { ...body.accounting!, originModuleId: 'core' },
      kind: body.kind, model: body.model, state: 'finished', finalUsage: true, createdAt: Date.now(), updatedAt: Date.now(),
      baseline: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0 } })
  }
  runner.delete<{ Params: { id: string } }>('/v1/run/:id', async req => {
    const body = bodies.find(body => body.runId === req.params.id)
    if (body) finish(body)
    release?.()
    return { stopped: !!body }
  })
  runner.post<{ Body: LlmRunBody }>('/v1/run', async (req, reply) => {
    bodies.push(req.body)
    await hold
    finish(req.body)
    return reply.type('application/x-ndjson').send([
      { t: 'out', s: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Hello from production Core' } }) },
      { t: 'out', s: JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 10 } }) },
      { t: 'exit', code: 0 }
    ].map(frame => JSON.stringify(frame)).join('\n') + '\n')
  })
  const runnerUrl = await runner.listen({ port: 0, host: '127.0.0.1' })
  cleanup.push(() => runner.close())
  const app = await buildServer({
    db, sessionSecret: 'secret',
    config: loadConfig({ ...env, PORT: '0', VC_DATA_DIR: dir, VC_LLM_RUNNER_CODEX_URL: runnerUrl, VC_LLM_RUNNER_CLAUDE_URL: runnerUrl }),
    billingTransport: { url: billingUrl, environmentId: 'test', fetchImpl: fetch }
  })
  cleanup.push(async () => { app.server.closeAllConnections(); await app.close() })
  cleanup.push(() => release?.())
  const url = await app.listen({ port: 0, host: '127.0.0.1' })
  const headers = { authorization: 'Bearer ' + token }
  const payload = { kind: 'codex', model: 'gpt-5.6-sol', sessionId: null, prompt: 'hello' }
  // Materialize the legacy signed session exactly as an external Core does.
  const profile = await app.inject({ url: '/api/me/profile', headers })
  expect(profile.statusCode, profile.body).toBe(200)
  const created = await app.inject({ method: 'POST', url: '/api/session/api-tokens', headers, payload: { name: 'Second Core', ttlDays: 1, access: 'full' } })
  expect(created.statusCode, created.body).toBe(200)
  token = created.json().token
  headers.authorization = 'Bearer ' + token
  return { app, url, headers, token, payload, db, ledger, bodies,
    hold() { hold = new Promise(resolve => { release = resolve }); return () => release?.() } }
}

it('a second Core uses the first as its runner, with token profile and settled sid usage', async () => {
  const f = await fixture()
  const caller = new RemoteLlmClient({ kind: 'codex', baseUrl: f.url + '/api/model-runner', token: f.token })
  const result = await new Promise(resolve => caller.send({
    prompt: 'hello', model: 'gpt-5.6-sol', sessionId: null, userId: 'victim',
    remote: { mcpUrl: 'http://caller.invalid/mcp', agentName: 'caller' }, kbMcpUrl: 'http://caller.invalid/kb', cwd: '/secret'
  }, { onDelta() {}, onSession() {}, onDone: text => resolve({ text }), onError: error => resolve({ error }) }))
  expect(result).toEqual({ text: 'Hello from production Core' })
  expect(f.bodies[0]).toMatchObject({ userId: 'admin', textOnly: true, executionDisabled: true })
  expect(f.bodies[0]).not.toHaveProperty('remote')
  expect(f.bodies[0]).not.toHaveProperty('kbMcpUrl')
  expect(f.bodies[0]).not.toHaveProperty('cwd')
  await vi.waitFor(async () => {
    const usage = await f.app.inject({ url: '/api/me/usage', headers: f.headers })
    expect(usage.statusCode).toBe(200)
    expect(usage.json().tokens).toEqual([{ sid: verifyToken(f.token, 'secret')!.sid, tenantId: expect.any(String), requests: 1, actualMicroUsd: 600 }])
  })
  expect(f.bodies[0].accounting?.application).toMatchObject({ tokenId: expect.any(String), originApplicationId: 'core' })
})

it('a second Core chats over WebSocket using only runner URL and token configuration', async () => {
  const upstream = await fixture()
  const dir = mkdtempSync(join(tmpdir(), 'second-core-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const db = new VoiceChatDb(':memory:')
  cleanup.push(() => db.close())
  const app = await buildServer({ db, sessionSecret: 'second-secret', config: loadConfig({
    PORT: '0', VC_DATA_DIR: dir, VC_LLM_RUNNER_CODEX_URL: upstream.url + '/api/model-runner',
    VC_LLM_RUNNER_CLAUDE_URL: upstream.url + '/api/model-runner', VC_LLM_RUNNER_TOKEN: upstream.token,
    VC_CHAT_MODEL_API: 'true', VC_CHAT_TEXT_ONLY: 'true', VC_CHAT_REQUIRE_BILLING: 'false'
  }), billingTransport: { url: 'http://local-billing.invalid', environmentId: 'stand',
    fetchImpl: async () => { throw Error('stand must not bill locally') } } })
  cleanup.push(async () => { app.server.closeAllConnections(); await app.close() })
  const token = signToken({ name: 'admin', role: 'admin' }, 'second-secret')
  const settings = await app.inject({ method: 'PUT', url: '/api/settings', headers: { authorization: 'Bearer ' + token },
    payload: { llmProvider: 'codex', codexModel: 'gpt-5.6-sol' } })
  expect(settings.statusCode, settings.body).toBe(200)
  const conversation = await db.chat.createConversation('admin', 'Remote Core')
  await db.chat.addMessage('admin', conversation.id, 'u1', 'hello', '10:00')
  const frames: Array<{ t: string; text?: string; message?: string }> = []
  const socket = await app.injectWS('/ws?token=' + token, {}, {
    onInit: ws => ws.on('message', data => frames.push(JSON.parse(String(data))))
  })
  try {
    socket.send(JSON.stringify({ t: 'claude.send', conversationId: conversation.id, segments: [{ speakerId: 1, text: 'hello' }] }))
    await vi.waitFor(() => expect(frames.filter(frame => frame.t === 'claude.error')).toEqual([]))
    await vi.waitFor(() => expect(frames).toContainEqual(expect.objectContaining({ t: 'claude.done', text: 'Hello from production Core' })), { timeout: 10_000 })
    await vi.waitFor(async () => {
      const usage = await upstream.app.inject({ url: '/api/me/usage', headers: upstream.headers })
      expect(usage.json().tokens).toEqual([{ sid: verifyToken(upstream.token, 'secret')!.sid,
        tenantId: expect.any(String), requests: 1, actualMicroUsd: 600 }])
    })
    expect(upstream.bodies[0]).toMatchObject({ textOnly: true, executionDisabled: true })
  } finally { socket.terminate() }
})

it('denies an exhausted budget before dispatch and keeps private runner routes closed', async () => {
  const f = await fixture(), access = await f.db.identity.getAccountAccess('admin')
  f.ledger.setPolicy('test', access!.tenant.id, { monthlyMicroUsd: 0, monthlyRequests: null, maxConcurrent: null }, 0)
  const denied = await f.app.inject({ method: 'POST', url: '/api/model-runner/v1/run', headers: f.headers, payload: f.payload })
  expect(denied.statusCode, denied.body).toBe(402)
  expect(denied.json()).toEqual({ error: 'insufficient_balance' })
  expect(f.bodies).toHaveLength(0)
  for (const path of ['fs/read', 'admin/lifecycle', 'preview-grants', 'mcp/servers']) {
    expect((await f.app.inject({ url: '/api/model-runner/v1/' + path, headers: f.headers })).statusCode).toBe(404)
  }
})

it('limits concurrent token runs and settles actual usage after cancellation', async () => {
  const f = await fixture(), release = f.hold()
  const first = fetch(f.url + '/api/model-runner/v1/run', { method: 'POST', headers: { ...f.headers, 'content-type': 'application/json' },
    body: JSON.stringify({ ...f.payload, runId: 'first' }) })
  await vi.waitFor(() => expect(f.bodies).toHaveLength(1))
  const second = fetch(f.url + '/api/model-runner/v1/run', { method: 'POST', headers: { ...f.headers, 'content-type': 'application/json' },
    body: JSON.stringify({ ...f.payload, runId: 'second' }) })
  await vi.waitFor(() => expect(f.bodies).toHaveLength(2))
  const third = await f.app.inject({ method: 'POST', url: '/api/model-runner/v1/run', headers: f.headers, payload: f.payload })
  expect(third.statusCode).toBe(429)
  expect((await f.app.inject({ method: 'DELETE', url: '/api/model-runner/v1/run/first', headers: f.headers })).statusCode).toBe(200)
  release()
  const [cancelled] = await Promise.all([(await first).text(), (await second).text()])
  expect(JSON.parse(cancelled.trim().split('\n').at(-1)!)).toEqual({ t: 'exit', code: null })
  await vi.waitFor(async () => {
    const access = await f.db.identity.getAccountAccess('admin')
    expect(f.ledger.balance('test', access!.tenant.id).spentMicroUsd).toBe(1200)
  })
})

it('rate limits a token independently of concurrent runs and filters its model catalog', async () => {
  const f = await fixture({ VC_MODEL_API_REQUESTS_PER_MINUTE: '1' })
  const first = await f.app.inject({ method: 'POST', url: '/api/model-runner/v1/run', headers: f.headers, payload: f.payload })
  expect(first.statusCode, first.body).toBe(200)
  expect(first.headers['x-run-id']).toEqual(expect.any(String))
  expect(JSON.parse(first.body.trim().split('\n').at(-1)!)).toEqual({ t: 'exit', code: 0 })
  const second = await f.app.inject({ method: 'POST', url: '/api/model-runner/v1/run', headers: f.headers, payload: f.payload })
  expect(second.statusCode).toBe(429)
  expect(second.json()).toEqual({ error: 'rate_limit_exceeded' })
  const catalog = await f.app.inject({ url: '/api/model-runner/v1/models', headers: f.headers })
  expect(catalog.statusCode).toBe(200)
  expect(catalog.json().models).toContainEqual(expect.objectContaining({ kind: 'codex', id: 'gpt-5.6-sol' }))
  expect(JSON.stringify(catalog.json())).not.toContain('baseUrl')
  const health = await f.app.inject({ url: '/api/model-runner/v1/health', headers: f.headers })
  expect(health.json()).toMatchObject({ ok: true, bins: { codex: { present: true } }, runs: 0 })
})

it('accounts for work after the calling Core disconnects', async () => {
  const f = await fixture()
  f.hold()
  const abort = new AbortController()
  const response = fetch(f.url + '/api/model-runner/v1/run', { method: 'POST', signal: abort.signal,
    headers: { ...f.headers, 'content-type': 'application/json' }, body: JSON.stringify(f.payload) }).catch(() => undefined)
  await vi.waitFor(() => expect(f.bodies).toHaveLength(1))
  abort.abort()
  await response
  await vi.waitFor(async () => {
    const access = await f.db.identity.getAccountAccess('admin')
    expect(f.ledger.balance('test', access!.tenant.id).spentMicroUsd).toBe(600)
  }, { timeout: 10_000 })
})

it('applies future Identity models metadata in the real Core global guard', async () => {
  const f = await fixture()
  const sid = verifyToken(f.token, 'secret')!.sid!
  const access = await f.db.identity.getAccountAccess('admin')
  const getSession = f.db.identity.getSession.bind(f.db.identity)
  vi.spyOn(f.db.identity, 'getSession').mockImplementation(async id => {
    const session = await getSession(id)
    return id === sid && session ? { ...session, access: 'models', tenantId: access!.tenant.id } as unknown as typeof session : session
  })
  for (const url of ['/api/conversations', '/api/session/api-tokens', '/api/me/usage']) {
    const response = await f.app.inject({ url, headers: f.headers })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'token_scope_denied' })
  }
  const response = await f.app.inject({ method: 'POST', url: '/api/model-runner/v1/run', headers: f.headers, payload: f.payload })
  expect(response.statusCode, response.body).toBe(200)
})

it('enforces verified models scope globally, including public routes and wrong tenant metadata', async () => {
  const app: FastifyInstance = Fastify()
  cleanup.push(async () => { app.server.closeAllConnections(); await app.close() })
  let access = 'models', tenantId = 'tenant'
  const authority = modelTokenAuthority(async () => ({ ok: true, access, sid: 'sid', tenantId,
    user: { name: 'owner', role: 'developer', account: { userId: 'subject', tenantId: 'tenant', tariffId: 'standard', tariffRevision: 1, capabilities: ['chat.use'] } } }),
    async () => undefined)
  authority.register(app)
  for (const url of ['/api/conversations', '/api/session/me', '/api/model-runner/v1/health']) app.get(url, async () => ({ ok: true }))
  for (const url of ['/api/conversations', '/api/session/me']) {
    const res = await app.inject({ url, headers: { authorization: 'Bearer models' } })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: 'token_scope_denied' })
  }
  expect((await app.inject({ url: '/api/model-runner/v1/health', headers: { authorization: 'Bearer models' } })).statusCode).toBe(200)
  tenantId = 'foreign'
  expect((await app.inject({ url: '/api/model-runner/v1/health', headers: { authorization: 'Bearer models' } })).statusCode).toBe(403)
  access = 'full'
  expect((await app.inject({ url: '/api/conversations', headers: { authorization: 'Bearer full' } })).statusCode).toBe(200)
})

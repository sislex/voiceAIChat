import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import Fastify from 'fastify'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BillingStore, BillingError, buildBillingServer } from '@sislexa/billing'
import type { LlmExecutionReceipt, LlmRequest, LlmRunBody, LlmStreamHandlers } from '@voicechat/shared'
import { AccountingStore } from './accountingStore.js'
import { BillingSessions } from './sessions.js'
import { ChatAccounting } from './chatAccounting.js'
import { ChatDelegation } from '../auth/delegation.js'
import type { VoiceChatDb } from '../db/database.js'
import { RemoteLlmClient } from '../llm/remoteClient.js'

const userCredential = 'Bearer '+randomUUID()
const delegatedCredential = 'Bearer '+randomUUID()
const componentCredential = randomUUID()

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'chat-accounting-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const ledger = new BillingStore(join(dir, 'billing.sqlite'))
  let revoked = false, loseSettlement = false, revokeAfterReserve = false, revokeAfterStart = false, foreignAccount = false
  const delegatedHeaders: Headers[] = []
  const billing = buildBillingServer(ledger, { environmentId: 'test',
    async verifyUser(token) {
      if (token !== userCredential || revoked) throw new BillingError(401, 'user_session_required')
      return { userId: 'subject', tenantId: 'tenant', role: 'developer', capabilities: ['chat.use'] }
    },
    async verifyDelegation(token, attribution) {
      if (token !== delegatedCredential || revoked || attribution.originApplicationId !== application.originApplicationId
        || attribution.delegationId !== application.delegationId) throw new BillingError(401, 'delegation_denied')
      return { userId: foreignAccount ? 'foreign' : 'subject', tenantId: 'tenant', role: 'developer', capabilities: ['chat.use'] }
    },
    async verifyComponent(token) {
      if (token !== componentCredential) throw new BillingError(403, 'component_access_denied')
      return { consumerId: 'core' }
    } })
  const billingUrl = await billing.listen({ host: '127.0.0.1', port: 0 })
  cleanup.push(async () => { await billing.close(); ledger.close() })
  const outbox = new AccountingStore(join(dir, 'outbox.sqlite')); cleanup.push(() => outbox.close())
  const sessions = new BillingSessions()
  const session = sessions.register({ name: 'login', role: 'developer', account: {
    userId: 'subject', tenantId: 'tenant', tariffId: 'standard', tariffRevision: 1, capabilities: ['chat.use'] } }, 'sid', userCredential.slice(7))!
  const receipts = new Map<string, LlmExecutionReceipt>()
  let runs = 0, lastRequest: LlmRunBody | undefined
  const runner = Fastify()
  runner.get('/v1/health', async () => ({ accountingVersion: 1, application: { version: '0.2.1' } }))
  runner.get<{ Params: { id: string } }>('/v1/execution-receipts/:id', async (req, reply) =>
    receipts.get(req.params.id) ?? reply.code(404).send({ error: 'execution_not_found' }))
  runner.post<{ Params: { id: string }; Body: { context: LlmExecutionReceipt['context']; kind: 'codex' } }>('/v1/execution-receipts/:id/fence', async req => {
    const receipt: LlmExecutionReceipt = { version: 1, runId: req.params.id, context: { ...req.body.context, originModuleId: 'core' }, kind: req.body.kind,
      state: 'not_started', createdAt: Date.now(), updatedAt: Date.now(), finalUsage: false }
    receipts.set(req.params.id, receipt); return receipt
  })
  runner.post<{ Body: LlmRunBody }>('/v1/run', async (req, reply) => {
    runs++; lastRequest = req.body
    const id = req.body.runId!, context = req.body.accounting!
    receipts.set(id, { version: 1, runId: id, context: { ...context, originModuleId: 'core' }, kind: 'codex', model: req.body.model,
      state: 'finished', finalUsage: true, createdAt: Date.now(), updatedAt: Date.now(),
      baseline: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0 } })
    return reply.type('application/x-ndjson').send([
      { t: 'out', s: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'done' } }) },
      { t: 'out', s: JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 10 } }) },
      { t: 'exit', code: 0 }
    ].map(row => JSON.stringify(row)).join('\n')+'\n')
  })
  runner.delete('/v1/run/:id', async () => ({ stopped: true }))
  const runnerUrl = await runner.listen({ host: '127.0.0.1', port: 0 }); cleanup.push(async () => runner.close())
  const client = new RemoteLlmClient({ kind: 'codex', baseUrl: runnerUrl })
  const options = { store: outbox, sessions, environmentId: 'test', resolveRunner: async () => client,
    billing: { url: billingUrl, fetchImpl: (async (url, init) => {
      const headers = new Headers(init?.headers); headers.set('authorization', componentCredential)
      if (headers.has('x-sislexa-delegated-billing')) delegatedHeaders.push(headers)
      const response = await fetch(url, { ...init, headers })
      if (revokeAfterReserve && String(url).endsWith('/reservations') || revokeAfterStart && String(url).endsWith('/start')) revoked = true
      if (loseSettlement && String(url).endsWith('/settle') && response.ok) { loseSettlement = false; throw Error('lost response') }
      return response
    }) as typeof fetch } }
  const authority = new ChatDelegation({ introspect: async ({ token }) => !revoked && token === delegatedCredential.slice(7)
    ? { version: 1, active: true, principal: { kind: 'delegated', userId: 'login', tenantId: 'tenant',
      applicationId: application.originApplicationId, grantId: 'grant', audience: 'core', issuedAt: 0, expiresAt: Date.now()+60_000,
      permissions: [{ resource: { tenantId: 'tenant', type: 'conversation', id: 'chat' }, scopes: ['read', 'execute'] }] } }
    : { version: 1, active: false } }, {
      identity: { getUser: async () => ({ blocked: false }), getAccountAccess: async () => ({
        userId: 'subject', tenant: { id: 'tenant', kind: 'personal' }, systemRole: 'developer',
        tariff: { id: 'standard', revision: 1 }, capabilities: ['chat.use'] }) },
      chat: { getConversation: async () => ({ tenantId: 'tenant', projectId: null }) }
    } as unknown as VoiceChatDb)
  const delegation = await authority.bind(delegatedCredential.slice(7), 'login', 'tenant')
  const accounting = new ChatAccounting(options)
  cleanup.push(() => accounting.shutdown())
  return { authority, delegation, delegatedHeaders, revokeAfterStart: () => { revokeAfterStart = true }, revokeAfterReserve: () => { revokeAfterReserve = true },
    foreignAccount: () => { foreignAccount = true }, ledger, outbox, sessions, session, client, options, accounting, receipts,
    runs: () => runs, lastRequest: () => lastRequest, revoke: () => { revoked = true }, loseSettlement: () => { loseSettlement = true } }
}
const application = { version: 1 as const, originApplicationId: 'delegated-app', executorApplicationId: 'core', tokenId: null, delegationId: 'grant' }
const request: LlmRequest = { userId: 'login', prompt: 'PRIVATE_PROMPT', sessionId: null, model: 'gpt-5.6-sol', application }
const execute = (f: Awaited<ReturnType<typeof fixture>>, session = f.session): Promise<{ text?: string; error?: string }> =>
  new Promise(resolve => {
    const handlers: LlmStreamHandlers = { onDelta() {}, onSession() {}, onDone: text => resolve({ text }), onError: error => resolve({ error }) }
    f.accounting.wrap(f.client, { login: 'login', session, originModuleId: 'chat', application }).send(request, handlers)
  })

it('admits a real HTTP model request with stable identity and settles once after a lost response', async () => {
  const f = await fixture(); f.loseSettlement()
  expect(await execute(f)).toEqual({ text: 'done' })
  expect(f.runs()).toBe(1)
  expect(f.lastRequest()).toMatchObject({ userId: 'login', application,
    accounting: { userId: 'subject', tenantId: 'tenant', originModuleId: 'chat', application } })
  expect(f.ledger.balance('test', 'tenant')).toMatchObject({ requests: 1, spentMicroUsd: 600, active: 0 })
  expect(f.outbox.pending()).toHaveLength(1)
  expect(f.outbox.pending()[0]?.application).toEqual(application)
  f.revoke()
  const recovered = new ChatAccounting(f.options)
  await recovered.reconcileAll()
  expect(f.outbox.pending()).toHaveLength(0)
  expect(f.outbox.get(f.lastRequest()!.runId!)?.application).toEqual(application)
  expect(f.ledger.balance('test', 'tenant').spentMicroUsd).toBe(600)
  expect(f.ledger.usageReport({ userId: 'subject', tenantId: 'tenant', environmentId: 'test' },
    Date.now() - 60_000, Date.now() + 60_000)).toMatchObject({
    applications: [{ applicationId: 'delegated-app', events: 1, actualMicroUsd: 600 }]
  })
})

it('denies finite budgets before execution and rejects a changed session identity', async () => {
  const f = await fixture()
  f.ledger.setPolicy('test', 'tenant', { monthlyMicroUsd: 1000, monthlyRequests: null, maxConcurrent: null }, 0)
  expect((await execute(f)).error).toContain('жёстким ограничением')
  expect(f.runs()).toBe(0)
  expect(f.ledger.balance('test', 'tenant').requests).toBe(0)
  expect((await execute(f, { ...f.session, tenantId: 'foreign' })).error).toContain('исходную сессию')
  expect(f.runs()).toBe(0)
})

it('uses live Identity authorization rather than cached queue authority', async () => {
  const f = await fixture(); f.revoke()
  expect((await execute(f)).error).toBeDefined()
  expect(f.runs()).toBe(0)
  expect(f.ledger.balance('test', 'tenant').requests).toBe(0)
})

it('reconciles a lost start response without execution and fences a possibly dispatched missing run', async () => {
  const f = await fixture()
  for (const state of ['claiming', 'dispatching'] as const) {
    const id = 'recover-'+state
    const input = { operationId: id, maxMicroUsd: 0, executionBound: 'unbounded' as const, expiresAt: Date.now()+60_000 }
    const principal = { userId: 'subject', tenantId: 'tenant', environmentId: 'test', actorClientId: 'core', originModuleId: 'chat' }
    const reservation = f.ledger.reserve(principal, input)
    f.ledger.transition(principal, reservation.id, 'start')
    f.outbox.save({ id, login: 'login', session: f.session, originModuleId: 'chat', input,
      target: f.client.accountingTarget, model: request.model, reservation, state })
    await f.accounting.reconcile(id)
    expect(f.outbox.get(id)?.state).toBe('done')
    expect(f.ledger.reservation(principal, reservation.id)).toMatchObject({ state: 'settled', actualMicroUsd: 0 })
  }
  expect(f.runs()).toBe(0)
  expect(f.receipts.get('recover-dispatching')?.state).toBe('not_started')
  expect(f.ledger.balance('test', 'tenant')).toMatchObject({ requests: 2, active: 0, spentMicroUsd: 0 })
})

it('retains a concurrency hold when terminal usage cannot be priced or proved', async () => {
  const f = await fixture(), id = 'unknown-result'
  const input = { operationId: id, maxMicroUsd: 0, executionBound: 'unbounded' as const, expiresAt: Date.now()+60_000 }
  const principal = { userId: 'subject', tenantId: 'tenant', environmentId: 'test', actorClientId: 'core', originModuleId: 'chat' }
  const reservation = f.ledger.reserve(principal, input)
  f.ledger.transition(principal, reservation.id, 'start')
  f.outbox.save({ id, login: 'login', session: f.session, originModuleId: 'chat', input,
    target: f.client.accountingTarget, model: 'unknown-model', reservation, state: 'dispatching' })
  f.receipts.set(id, { version: 1, runId: id, kind: 'codex', state: 'finished', finalUsage: false,
    context: { operationId: id, reservationId: reservation.id, userId: 'subject', tenantId: 'tenant', environmentId: 'test', originModuleId: 'core' },
    createdAt: 1, updatedAt: 2 })
  await f.accounting.reconcile(id)
  expect(f.ledger.reservation(principal, reservation.id).state).toBe('uncertain')
  expect(f.ledger.balance('test', 'tenant')).toMatchObject({ active: 1, spentMicroUsd: 0 })
  expect(f.outbox.pending()).toHaveLength(1)
})

const executeDelegated = (f: Awaited<ReturnType<typeof fixture>>): Promise<{ text?: string; error?: string }> =>
  new Promise(resolve => {
    f.accounting.wrap(f.client, { login: 'login', originModuleId: 'chat', application,
      delegatedAuthorization: () => f.authority.billingAuthorization(f.delegation, 'chat'),
      authorize: () => f.authority.authorize(f.delegation, 'execute', 'chat')
    }).send(request, { onDelta() {}, onSession() {}, onDone: text => resolve({ text }), onError: error => resolve({ error }) })
  })

it('executes a token-only paid turn through published Billing with attribution and no stored grant', async () => {
  const f = await fixture()
  f.sessions.revoke('login')
  expect(await executeDelegated(f)).toEqual({ text: 'done' })
  expect(f.delegatedHeaders).toHaveLength(2)
  for (const headers of f.delegatedHeaders) {
    expect(headers.get('x-sislexa-delegated-billing')).toBe('1')
    expect(headers.get('x-sislexa-user-authorization')).toBe(delegatedCredential)
  }
  expect(f.lastRequest()).toMatchObject({ accounting: { userId: 'subject', tenantId: 'tenant', application } })
  const job = f.outbox.get(f.lastRequest()!.runId!)!
  expect(job.session).toEqual({ userId: 'subject', tenantId: 'tenant', delegationId: 'grant' })
  expect(JSON.stringify(job)).not.toContain(delegatedCredential.slice(7))
  expect(f.ledger.balance('test', 'tenant')).toMatchObject({ requests: 1, spentMicroUsd: 600, active: 0 })
})

it.each(['revoke', 'revokeAfterReserve', 'revokeAfterStart', 'foreignAccount'] as const)('denies delegated execution on %s', async action => {
  const f = await fixture()
  f[action]()
  expect((await executeDelegated(f)).error).toBeDefined()
  await f.accounting.shutdown()
  expect(f.runs()).toBe(0)
})

it('settles delegated usage after revocation and denies replay when the in-memory reference is lost', async () => {
  const f = await fixture()
  f.loseSettlement()
  expect(await executeDelegated(f)).toEqual({ text: 'done' })
  f.revoke()
  f.authority.release(f.delegation)
  const recovered = new ChatAccounting(f.options)
  await recovered.reconcileAll()
  expect(f.outbox.pending()).toHaveLength(0)
  expect((await executeDelegated(f)).error).toBeDefined()
  expect(f.runs()).toBe(1)
  expect(f.ledger.usageReport({ userId: 'subject', tenantId: 'tenant', environmentId: 'test' },
    Date.now()-60_000, Date.now()+60_000)).toMatchObject({
    applications: [{ applicationId: application.originApplicationId, events: 1, actualMicroUsd: 600 }]
  })
})

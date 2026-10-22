import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
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
function gate() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}
async function fixture(dailyLimit?: number, backgroundStop = false) {
  const dir = mkdtempSync(join(tmpdir(), 'chat-accounting-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const ledger = new BillingStore(join(dir, 'billing.sqlite'), Date.now, dailyLimit === undefined ? undefined : {
    limitMicroUsd: dailyLimit, timeZone: 'Europe/Minsk' })
  let revoked = false, loseSettlement = false, revokeAfterReserve = false, revokeAfterStart = false, foreignAccount = false
  const delegatedHeaders: Headers[] = []
  const billing = buildBillingServer(ledger, { environmentId: 'test',
    async verifyUser(token) {
      if (token !== userCredential || revoked) throw new BillingError(401, 'user_session_required')
      return { userId: 'subject', tenantId: 'tenant', role: 'developer', capabilities: ['chat.use', 'projects.use'] }
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
  let runs = 0, deletes = 0, disconnected = false, lastRequest: LlmRunBody | undefined
  let runGate: ReturnType<typeof gate> | undefined, startGate: ReturnType<typeof gate> | undefined, settlementGate: ReturnType<typeof gate> | undefined
  let finalUsage = true, runFailure = false
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
      state: 'running', finalUsage: false, createdAt: Date.now(), updatedAt: Date.now() })
    let completed = false
    reply.raw.on('close', () => { if (!completed) disconnected = true })
    await runGate?.promise
    completed = true
    receipts.set(id, { version: 1, runId: id, context: { ...context, originModuleId: 'core' }, kind: 'codex', model: req.body.model,
      state: 'finished', finalUsage, createdAt: Date.now(), updatedAt: Date.now(),
      baseline: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0 } })
    return reply.type('application/x-ndjson').send([
      { t: 'out', s: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'done' } }) },
      { t: 'out', s: JSON.stringify(runFailure ? { type: 'error', message: 'Synthetic runner failure' }
        : { type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 10 } }) },
      { t: 'exit', code: runFailure ? 1 : 0 }
    ].map(row => JSON.stringify(row)).join('\n')+'\n')
  })
  runner.delete('/v1/run/:id', async () => { deletes++; return { stopped: true } })
  const runnerUrl = await runner.listen({ host: '127.0.0.1', port: 0 }); cleanup.push(async () => runner.close())
  const client = new RemoteLlmClient({ kind: 'codex', baseUrl: runnerUrl })
  const options = { store: outbox, sessions, environmentId: 'test', finishStoppedChatInBackground: backgroundStop, resolveRunner: async () => client,
    billing: { url: billingUrl, fetchImpl: (async (url, init) => {
      const headers = new Headers(init?.headers); headers.set('authorization', componentCredential)
      if (headers.has('x-sislexa-delegated-billing')) delegatedHeaders.push(headers)
      const response = await fetch(url, { ...init, headers })
      if (String(url).endsWith('/start')) await startGate?.promise
      if (String(url).endsWith('/settle')) await settlementGate?.promise
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
  cleanup.push(() => { runGate?.release(); startGate?.release(); settlementGate?.release() })
  return { billingUrl, authority, delegation, delegatedHeaders, revokeAfterStart: () => { revokeAfterStart = true }, revokeAfterReserve: () => { revokeAfterReserve = true },
    foreignAccount: () => { foreignAccount = true }, ledger, outbox, sessions, session, client, options, accounting, receipts,
    holdRunner: () => { runGate = gate(); return runGate }, holdStart: () => { startGate = gate(); return startGate },
    holdSettlement: () => { settlementGate = gate(); return settlementGate }, failRun: () => { runFailure = true },
    missingUsage: () => { finalUsage = false }, deletes: () => deletes, disconnected: () => disconnected,
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

it('lets the admitted response cross the daily threshold and blocks the next runner dispatch', async () => {
  const f = await fixture(5_000_000)
  const principal = { userId: 'subject', tenantId: 'tenant', environmentId: 'test', actorClientId: 'core', originModuleId: 'chat' }
  const seed = f.ledger.reserve(principal, { operationId: 'earlier-today', maxMicroUsd: 0,
    executionBound: 'unbounded', expiresAt: Date.now() + 60_000 })
  f.ledger.transition(principal, seed.id, 'start')
  f.ledger.settle(principal, seed.id, 'earlier-cost', 4_999_500)

  expect(await execute(f)).toEqual({ text: 'done' })
  expect(f.runs()).toBe(1)
  const account = await fetch(f.billingUrl + '/api/billing/account', { headers: { authorization: userCredential } })
  expect(account.status).toBe(200)
  expect(await account.json()).toMatchObject({ dailyUser: { limitMicroUsd: 5_000_000,
    spentMicroUsd: 5_000_100, remainingMicroUsd: 0, active: 0, timeZone: 'Europe/Minsk' } })
  expect((await execute(f)).error).toContain('Дневной лимит')
  expect(f.runs()).toBe(1)
  expect(f.outbox.pending()).toHaveLength(0)
})

function publicTurn(f: Awaited<ReturnType<typeof fixture>>) {
  const handlers = { onDelta: vi.fn(), onSession: vi.fn(), onInit: vi.fn(), onActivity: vi.fn(), onUsage: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
  const original = f.client.send.bind(f.client)
  let forwarded!: LlmStreamHandlers
  vi.spyOn(f.client, 'send').mockImplementation((req, next) => { forwarded = next; return original(req, next) })
  const handle = f.accounting.wrap(f.client, { login: 'login', session: f.session, originModuleId: 'chat' })
    .send({ ...request, application: undefined, textOnly: true }, handlers)
  return { handle, handlers, forwarded: () => forwarded }
}

it('stops public output without cancelling its HTTP executor, keeps admission closed, and settles exactly once', async () => {
  const f = await fixture(5_000_000, true), held = f.holdRunner(), run = publicTurn(f)
  await vi.waitFor(() => expect(f.runs()).toBe(1))
  run.forwarded().onDelta('Visible partial')
  run.handle.cancel(); run.handle.cancel()
  const next = run.forwarded()
  next.onDelta('Hidden'); next.onSession('hidden-session'); next.onInit?.({ model: 'hidden' })
  next.onActivity?.({ kind: 'system', summary: 'Hidden', raw: '' }); next.onUsage?.({ inputTokens: 123 })
  await f.accounting.reconcileAll()
  expect(f.accounting.hasPendingUser('subject')).toBe(true)
  expect(f.ledger.balance('test', 'tenant')).toMatchObject({ active: 1, spentMicroUsd: 0 })
  expect((await execute(f)).error).toContain('учёта его стоимости')
  expect(f.runs()).toBe(1)
  expect(f.deletes()).toBe(0); expect(f.disconnected()).toBe(false)
  held.release()
  await vi.waitFor(() => expect(f.ledger.balance('test', 'tenant')).toMatchObject({ active: 0, spentMicroUsd: 600 }))
  next.onDone('Duplicate'); next.onError('Duplicate')
  await f.accounting.reconcileAll()
  expect(run.handlers.onDelta.mock.calls).toEqual([['Visible partial']])
  for (const [name, callback] of Object.entries(run.handlers)) if (name !== 'onDelta') expect(callback).not.toHaveBeenCalled()
  expect(f.outbox.pending()).toHaveLength(0)
  expect(f.accounting.hasPendingUser('subject')).toBe(false)
  expect(await execute(f)).toEqual({ text: 'done' })
  expect(f.runs()).toBe(2)
  expect(f.ledger.balance('test', 'tenant')).toMatchObject({ active: 0, spentMicroUsd: 1200 })
})

it('cancels before dispatch with an authoritative no-spawn zero settlement', async () => {
  const f = await fixture(5_000_000, true), held = f.holdStart(), run = publicTurn(f)
  await vi.waitFor(() => expect(f.outbox.pending()[0]?.state).toBe('claiming'))
  run.handle.cancel(); held.release()
  await f.accounting.shutdown()
  expect(f.runs()).toBe(0); expect(f.deletes()).toBe(0)
  expect(f.outbox.pending()).toHaveLength(0)
  expect(f.ledger.balance('test', 'tenant')).toMatchObject({ active: 0, spentMicroUsd: 0 })
  for (const callback of Object.values(run.handlers)) expect(callback).not.toHaveBeenCalled()
})

it.each(['default', 'delegated', 'internal'] as const)('preserves hard cancellation for %s even with request.textOnly', async mode => {
  const f = await fixture(5_000_000, mode !== 'default'), held = f.holdRunner()
  const handle = f.accounting.wrap(f.client, { login: 'login', session: f.session,
    originModuleId: mode === 'internal' ? 'projects' : 'chat', ...(mode === 'delegated' ? { application } : {}) })
    .send({ ...request, textOnly: true, application: mode === 'delegated' ? application : undefined }, { onDelta() {}, onSession() {}, onDone() {}, onError() {} })
  await vi.waitFor(() => expect(f.runs()).toBe(1))
  handle.cancel(); handle.cancel()
  await vi.waitFor(() => expect(f.deletes()).toBe(1))
  await vi.waitFor(() => expect(f.disconnected()).toBe(true))
  held.release()
})

it('retains the stable user hold when a stopped executor finishes without authoritative usage', async () => {
  const f = await fixture(5_000_000, true), held = f.holdRunner(), run = publicTurn(f)
  f.missingUsage()
  await vi.waitFor(() => expect(f.runs()).toBe(1))
  run.handle.cancel(); held.release()
  await vi.waitFor(() => expect(f.receipts.get(f.lastRequest()!.runId!)?.state).toBe('finished'))
  await vi.waitFor(() => expect(f.ledger.reservation({ userId: 'subject', tenantId: 'tenant', environmentId: 'test', actorClientId: 'core', originModuleId: 'chat' },
    f.outbox.pending()[0]!.reservation!.id).state).toBe('uncertain'))
  expect((await execute(f)).error).toContain('учёта его стоимости')
  await f.accounting.shutdown()
  expect(f.accounting.hasPendingUser('subject')).toBe(true)
  expect(f.runs()).toBe(1)
  expect(f.ledger.balance('test', 'tenant')).toMatchObject({ active: 1, spentMicroUsd: 0 })
  expect(f.outbox.pending()).toHaveLength(1)
})

it('waits for a stopped background executor and reconciliation before shutdown can close the outbox', async () => {
  const f = await fixture(5_000_000, true), held = f.holdRunner(), run = publicTurn(f)
  await vi.waitFor(() => expect(f.runs()).toBe(1))
  run.handle.cancel()
  let closed = false
  const shutdown = f.accounting.shutdown().then(() => { closed = true })
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(closed).toBe(false)
  expect(f.outbox.pending()).toHaveLength(1)
  held.release(); await shutdown
  expect(closed).toBe(true)
  expect(f.outbox.pending()).toHaveLength(0)
  expect(f.ledger.balance('test', 'tenant')).toMatchObject({ active: 0, spentMicroUsd: 600 })
  expect(f.deletes()).toBe(0)
})

it('suppresses a terminal callback when Stop arrives while its settlement response is pending', async () => {
  const f = await fixture(5_000_000, true), held = f.holdSettlement(), run = publicTurn(f)
  await vi.waitFor(() => expect(f.ledger.balance('test', 'tenant').spentMicroUsd).toBe(600))
  expect(f.outbox.pending()[0]?.state).toBe('settling')
  run.handle.cancel(); run.handle.cancel()
  run.forwarded().onDone('Duplicate terminal')
  held.release(); await f.accounting.shutdown()
  expect(run.handlers.onDone).not.toHaveBeenCalled()
  expect(run.handlers.onError).not.toHaveBeenCalled()
  expect(f.deletes()).toBe(0)
  expect(f.ledger.balance('test', 'tenant')).toMatchObject({ active: 0, spentMicroUsd: 600 })
  expect(f.outbox.pending()).toHaveLength(0)
})

it('reconciles authoritative usage when a stopped executor terminates with an error', async () => {
  const f = await fixture(5_000_000, true), held = f.holdRunner(), run = publicTurn(f)
  f.failRun()
  await vi.waitFor(() => expect(f.runs()).toBe(1))
  const terminalError = vi.spyOn(run.forwarded(), 'onError')
  run.handle.cancel(); held.release()
  await f.accounting.shutdown()
  expect(terminalError).toHaveBeenCalledTimes(1)
  expect(run.handlers.onDone).not.toHaveBeenCalled()
  expect(run.handlers.onError).not.toHaveBeenCalled()
  expect(f.ledger.balance('test', 'tenant')).toMatchObject({ active: 0, spentMicroUsd: 600 })
  expect(f.outbox.pending()).toHaveLength(0)
})

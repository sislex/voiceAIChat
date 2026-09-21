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
import { RemoteLlmClient } from '../llm/remoteClient.js'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'chat-accounting-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const ledger = new BillingStore(join(dir, 'billing.sqlite'))
  let revoked = false, loseSettlement = false
  const billing = buildBillingServer(ledger, { environmentId: 'test',
    async verifyUser(token) {
      if (token !== 'Bearer user-secret' || revoked) throw new BillingError(401, 'user_session_required')
      return { userId: 'subject', tenantId: 'tenant', role: 'developer', capabilities: ['chat.use'] }
    },
    async verifyComponent(token) {
      if (token !== 'Bearer component-secret') throw new BillingError(403, 'component_access_denied')
      return { consumerId: 'core' }
    } })
  const billingUrl = await billing.listen({ host: '127.0.0.1', port: 0 })
  cleanup.push(async () => { await billing.close(); ledger.close() })
  const outbox = new AccountingStore(join(dir, 'outbox.sqlite')); cleanup.push(() => outbox.close())
  const sessions = new BillingSessions()
  const session = sessions.register({ name: 'login', role: 'developer', account: {
    userId: 'subject', tenantId: 'tenant', tariffId: 'standard', tariffRevision: 1, capabilities: ['chat.use'] } }, 'sid', 'user-secret')!
  const receipts = new Map<string, LlmExecutionReceipt>()
  let runs = 0, lastRequest: LlmRunBody | undefined
  const runner = Fastify()
  runner.get('/v1/health', async () => ({ accountingVersion: 1, application: { version: '0.2.1' } }))
  runner.get<{ Params: { id: string } }>('/v1/execution-receipts/:id', async (req, reply) =>
    receipts.get(req.params.id) ?? reply.code(404).send({ error: 'execution_not_found' }))
  runner.post<{ Params: { id: string }; Body: { context: LlmExecutionReceipt['context']; kind: 'codex' } }>('/v1/execution-receipts/:id/fence', async req => {
    const receipt: LlmExecutionReceipt = { version: 1, runId: req.params.id, context: req.body.context, kind: req.body.kind,
      state: 'not_started', createdAt: Date.now(), updatedAt: Date.now(), finalUsage: false }
    receipts.set(req.params.id, receipt); return receipt
  })
  runner.post<{ Body: LlmRunBody }>('/v1/run', async (req, reply) => {
    runs++; lastRequest = req.body
    const id = req.body.runId!, context = req.body.accounting!
    receipts.set(id, { version: 1, runId: id, context, kind: 'codex', model: req.body.model,
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
      const headers = new Headers(init?.headers); headers.set('authorization', 'Bearer component-secret')
      const response = await fetch(url, { ...init, headers })
      if (loseSettlement && String(url).endsWith('/settle') && response.ok) { loseSettlement = false; throw Error('lost response') }
      return response
    }) as typeof fetch } }
  const accounting = new ChatAccounting(options)
  cleanup.push(() => accounting.shutdown())
  return { ledger, outbox, sessions, session, client, options, accounting, receipts,
    runs: () => runs, lastRequest: () => lastRequest, revoke: () => { revoked = true }, loseSettlement: () => { loseSettlement = true } }
}
const request: LlmRequest = { userId: 'login', prompt: 'PRIVATE_PROMPT', sessionId: null, model: 'gpt-5.6-sol' }
const execute = (f: Awaited<ReturnType<typeof fixture>>, session = f.session): Promise<{ text?: string; error?: string }> =>
  new Promise(resolve => {
    const handlers: LlmStreamHandlers = { onDelta() {}, onSession() {}, onDone: text => resolve({ text }), onError: error => resolve({ error }) }
    f.accounting.wrap(f.client, { login: 'login', session, originModuleId: 'chat' }).send(request, handlers)
  })

it('admits a real HTTP model request with stable identity and settles once after a lost response', async () => {
  const f = await fixture(); f.loseSettlement()
  expect(await execute(f)).toEqual({ text: 'done' })
  expect(f.runs()).toBe(1)
  expect(f.lastRequest()).toMatchObject({ userId: 'login', accounting: { userId: 'subject', tenantId: 'tenant', originModuleId: 'chat' } })
  expect(f.ledger.balance('test', 'tenant')).toMatchObject({ requests: 1, spentMicroUsd: 600, active: 0 })
  expect(f.outbox.pending()).toHaveLength(1)
  f.revoke()
  const recovered = new ChatAccounting(f.options)
  await recovered.reconcileAll()
  expect(f.outbox.pending()).toHaveLength(0)
  expect(f.ledger.balance('test', 'tenant').spentMicroUsd).toBe(600)
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
    context: { operationId: id, reservationId: reservation.id, userId: 'subject', tenantId: 'tenant', environmentId: 'test', originModuleId: 'chat' },
    createdAt: 1, updatedAt: 2 })
  await f.accounting.reconcile(id)
  expect(f.ledger.reservation(principal, reservation.id).state).toBe('uncertain')
  expect(f.ledger.balance('test', 'tenant')).toMatchObject({ active: 1, spentMicroUsd: 0 })
  expect(f.outbox.pending()).toHaveLength(1)
})

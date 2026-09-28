import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import WebSocket from 'ws'
import { buildRunner } from '@sislex/llm-runner/server'
import { buildIdentityServer } from '@sislexa/identity/server/server'
import { signToken } from '@sislexa/identity/server/users/accounts'
import { createDelegationIntrospectionClient } from '@sislexa/identity/client/delegation'
import { BillingStore, buildBillingServer, componentAuthority as billingAuthority } from '@sislexa/billing'
import { ActivityStore, buildAnalyticsServer, componentAuthority as analyticsAuthority, componentBillingReports } from '@sislexa/analytics'
import { VoiceChatDb } from '../apps/server/src/db/database.ts'
import { RemoteLlmClient } from '../apps/server/src/llm/remoteClient.ts'
import { AccountingStore } from '../apps/server/src/billing/accountingStore.ts'
import { verifyA07Composition } from './a07-composition.mjs'
import { createSyntheticChatApplication } from './synthetic-chat-application.mjs'

// Prevent development asset discovery by the Core test host.
process.env.VITEST = 'a07'
const { buildServer } = await import('../apps/server/src/server.ts')
const { loadConfig } = await import('../apps/server/src/config.ts')
const inProcess = process.env.A07_IN_PROCESS === 'true'

const until = async (check, label) => {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const value = await check()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw Error('Timed out: ' + label)
}

// Real owner HTTP handlers, without allocating additional listeners. No verdicts,
// receipts, reservations, settlements or report rows are fabricated by this adapter.
const injectedFetch = app => async (url, init = {}) => {
  const parsed = new URL(url)
  const result = await app.inject({ method: init.method ?? 'GET', url: parsed.pathname + parsed.search,
    headers: Object.fromEntries(new Headers(init.headers)), payload: init.body })
  return new Response(result.body || null, { status: result.statusCode,
    headers: Object.fromEntries(Object.entries(result.headers).map(([key, value]) => [key, String(value)])) })
}

test('synthetic application is disabled by default', () => {
  assert.throws(() => createSyntheticChatApplication({}), /synthetic_application_disabled/)
})

test(`A07 exact composition (${inProcess ? 'in-process transport' : 'loopback transport'}): paid SDK turn, rotation, restart, queue and reports`, { timeout: 90_000 }, async t => {
  await verifyA07Composition()
  const attempt = process.env.DELIVERY_ATTEMPT_ROOT
  const ports = (process.env.DELIVERY_PORTS ?? '').match(/\d+/g)?.map(Number)
  if (attempt && (!ports || ports.length < 2)) throw Error('A07 requires assigned DELIVERY_PORTS (Core, Runner)')
  const directory = mkdtempSync(join(attempt ? join(attempt, 'tmp') : tmpdir(), 'a07-'))
  const cleanup = []
  t.after(async () => {
    const failures = []
    for (const close of cleanup.reverse()) {
      try { await close() } catch (error) { failures.push(error) }
    }
    rmSync(directory, { recursive: true, force: true })
    if (failures.length) throw new AggregateError(failures, 'A07 cleanup failed')
  })
  const environmentId = process.env.DELIVERY_DATABASE_NAME ?? 'a07-isolated'
  const secret = randomUUID(), componentToken = randomUUID()
  const databasePath = join(directory, 'core.sqlite')
  let db = new VoiceChatDb(databasePath)
  const databases = [db]
  cleanup.push(async () => { for (const database of databases) await database.close() })
  await db.ready
  await db.identity.createUser('admin', '', 'admin')
  const access = await db.identity.getAccountAccess('admin')
  const tenantId = access.tenant.id
  const conversation = await db.chat.createConversation('admin', 'A07 synthetic')
  const outside = await db.chat.createConversation('admin', 'Outside grant')
  const settings = await db.settings.getSettings('admin')
  await db.settings.saveSettings('admin', { ...settings, llmProvider: 'claude', claudeModel: 'sonnet' })
  const application = await db.identity.createApplication('admin', tenantId, 'A07 synthetic application')
  const issued = await db.identity.issueApplicationGrant('admin', tenantId, application.id, {
    audience: 'core', expiresAt: Date.now() + 120_000,
    permissions: [{ resource: { tenantId, type: 'conversation', id: conversation.id }, scopes: ['read', 'execute'] }]
  })
  const { app: identity } = await buildIdentityServer({ database: db, secret,
    authorize: header => header === 'Bearer ' + componentToken ? { ok: true } : { ok: false, status: 403 },
    authorizeDelegationAudience: (header, audience) => header === 'Bearer ' + componentToken && audience === 'core' })
  cleanup.push(() => identity.close())
  const identityTransport = { url: 'http://identity.invalid', token: componentToken,
    fetchImpl: async (url, init) => {
      const headers = new Headers(init?.headers); headers.set('authorization', 'Bearer ' + componentToken)
      return injectedFetch(identity)(url, { ...init, headers })
    } }
  const registry = { authorize: header => header === 'Bearer ' + componentToken
    ? { ok: true, principal: { consumerId: 'core' } } : { ok: false, status: 403 } }
  const ledger = new BillingStore(join(directory, 'billing.sqlite'))
  cleanup.push(() => ledger.close())
  const billing = buildBillingServer(ledger, billingAuthority({ config: { environmentId }, registry,
    dependency: () => identityTransport }))
  cleanup.push(() => billing.close())
  const admission = await billingAuthority({ config: { environmentId }, registry, dependency: () => identityTransport })
    .verifyDelegation('Bearer ' + issued.token, { version: 1, originApplicationId: application.id,
      executorApplicationId: 'core', tokenId: null, delegationId: issued.grant.id })
  let loseSettlement = true, billingUnavailable = false
  const billingTransport = { url: 'http://billing.invalid', environmentId, fetchImpl: async (url, init) => {
    if (billingUnavailable) throw Error('injected_billing_outage')
    const headers = new Headers(init?.headers); headers.set('authorization', 'Bearer ' + componentToken)
    const response = await injectedFetch(billing)(url, { ...init, headers })
    if (loseSettlement && String(url).endsWith('/settle') && response.ok) {
      billingUnavailable = true
      throw Error('injected_lost_settlement_response')
    }
    return response
  } }

  // Exercise the shipped administrator CLI with an in-memory terminal against a
  // fresh isolated token store. Never read or modify operator credentials.
  const runnerPackage = dirname(fileURLToPath(import.meta.resolve('@sislex/llm-runner/package.json')))
  const { runAdminCli } = await import(pathToFileURL(join(runnerPackage, 'src/adminCli.ts')).href)
  const tokenStoreDir = join(directory, 'runner-auth'), password = randomUUID()
  let tokenId, runnerToken, step = 0
  const terminal = { password: async () => password, line: async () => {
    if (step++ === 0) return 'create --app core --expires-in 1h'
    if (step === 2) return 'copy ' + tokenId
    return 'logout'
  }, write: value => {
    if (value.startsWith('{')) tokenId = JSON.parse(value).id
    if (value.startsWith('llmr_')) runnerToken = value.trim()
  } }
  await runAdminCli(['init'], tokenStoreDir, terminal)
  await runAdminCli(['login'], tokenStoreDir, terminal)
  assert.ok(runnerToken)
  const home = join(directory, 'runner-home'); mkdirSync(home)
  const release = join(directory, 'release'), invocations = join(directory, 'invocations')
  const cli = join(directory, 'synthetic-claude.cjs')
  // Only the model provider is synthetic. Runner spawns a real bounded child and
  // derives durable receipts from the provider's normal NDJSON usage stream.
  writeFileSync(cli, '#!' + process.execPath + '\n' + `
    const fs = require('node:fs');
    if (process.argv.includes('--version')) { console.log('synthetic 1.0'); process.exit(0); }
    if (process.argv.includes('auth')) { console.log(JSON.stringify({loggedIn:false})); process.exit(0); }
    fs.appendFileSync(${JSON.stringify(invocations)}, 'run\\n');
    const deadline = Date.now() + 15000;
    const timer = setInterval(() => {
      if (Date.now() > deadline) process.exit(2);
      if (!fs.existsSync(${JSON.stringify(release)})) return;
      clearInterval(timer);
      console.log(JSON.stringify({type:'result',is_error:false,result:'A07 complete',session_id:'a07-synthetic',usage:{input_tokens:100,output_tokens:10},total_cost_usd:0.0006}));
    }, 25);
  `, { mode: 0o700 })
  const runner = await buildRunner({ config: { host: '127.0.0.1', port: ports?.[1] ?? 0,
    token: randomUUID(), tokenStoreDir, dataDir: join(directory, 'runner'), home,
    codexBin: cli, claudeBin: cli, orphanMs: 15_000 } })
  cleanup.push(() => runner.close())
  const runnerUrl = inProcess ? 'http://runner.invalid' : await runner.listen({ host: '127.0.0.1', port: ports?.[1] ?? 0 })
  const claude = new RemoteLlmClient({ kind: 'claude', baseUrl: runnerUrl, token: runnerToken,
    ...(inProcess ? { fetchImpl: injectedFetch(runner) } : {}) })
  assert.equal(await claude.accountingReady(), true, 'published Runner accounting capability')
  let core
  cleanup.push(async () => { if (core) await core.close() })
  const startCore = async () => {
    core = await buildServer({ db, claude, billingTransport, sessionSecret: secret,
      delegationClient: createDelegationIntrospectionClient(identityTransport),
      config: loadConfig({ VC_DATA_DIR: directory, VC_DELEGATED_CHAT_ENABLED: 'true' }) })
    await core.ready()
    return inProcess ? 'http://core.invalid' : core.listen({ host: '127.0.0.1', port: ports?.[0] ?? 0 })
  }
  let coreUrl = await startCore()
  const read = (token, id = conversation.id) => core.inject({ url: '/api/conversations/' + id,
    headers: { 'x-sislexa-delegation': token } })
  assert.equal((await read(issued.token)).statusCode, 200, 'live grant reads selected conversation')
  assert.equal((await read(issued.token, outside.id)).statusCode, 403)
  const client = createSyntheticChatApplication({ enabled: true, baseUrl: coreUrl,
    conversationId: conversation.id, credential: issued.token,
    ...(inProcess ? { fetchImpl: injectedFetch(core), connectSocket: (_url, options) => {
      let ws
      const socket = { readyState: 0, binaryType: 'arraybuffer',
        send: data => ws.send(data), close: () => ws?.terminate() }
      void core.injectWS('/ws', options).then(connected => {
        ws = connected; socket.readyState = 1
        ws.on('message', data => socket.onmessage?.({ data: String(data) }))
        ws.on('close', () => { socket.readyState = 3; socket.onclose?.({}) })
        ws.on('error', error => socket.onerror?.(error))
        socket.onopen?.({})
      }).catch(error => socket.onerror?.(error))
      return socket
    } } : {}) })
  cleanup.push(() => client.dispose())
  const clientErrors = []
  client.transport.subscribe(event => {
    if (event.type === 'error') clientErrors.push(event.error.message)
    if (event.type === 'message' && event.message.t === 'claude.error') clientErrors.push(event.message.message)
  })
  client.transport.connect()
  await until(() => {
    if (clientErrors.length) throw Error(clientErrors.join('; '))
    return client.transport.state === 'ready'
  }, 'SDK handshake and history resynchronization')
  const capabilities = await client.capabilities.discover()
  assert.ok(capabilities.capabilities.some(row => row.id === 'chat.text' && row.available))
  assert.ok(capabilities.capabilities.some(row => row.id === 'chat.tools' && !row.available))
  assert.equal(admission.userId === access.userId, true,
    'Composition blocker: Identity delegated Billing admission must use the stable account subject, not the login')
  const send = async text => {
    client.transport.send({ t: 'claude.send', conversationId: conversation.id,
      segments: [{ speakerId: 1, text }] })
  }
  await send('Synthetic paid turn')
  await until(() => {
    if (clientErrors.length) throw Error(clientErrors.join('; '))
    return existsSync(invocations)
  }, 'real Runner child admission')
  await send('Queued turn must not inherit authority after restart')
  const queue = await until(async () => {
    const rows = await db.chat.listQueuedTurns('admin', conversation.id)
    return rows.length === 1 && rows
  }, 'durable Core queue')
  const payload = await db.chat.queuedTurnPayload('admin', conversation.id, queue[0].id)
  assert.ok(payload.delegation)
  assert.ok(!JSON.stringify(payload).includes(issued.token))
  await db.chat.setTurnQueuePaused('admin', conversation.id, true)
  const rotated = await db.identity.rotateApplicationGrant('admin', tenantId, application.id, issued.grant.id)
  assert.equal((await read(issued.token)).statusCode, 403)
  assert.equal((await read(rotated.token)).statusCode, 200)
  writeFileSync(release, '')
  await until(() => ledger.balance(environmentId, tenantId).spentMicroUsd === 600, 'settlement despite rotation')
  // Trigger an immediate live authorization check rather than waiting for the
  // periodic socket check. The request cannot start another paid operation.
  client.transport.send({ t: 'claude.send', conversationId: conversation.id,
    segments: [{ speakerId: 1, text: 'Denied after rotation' }] })
  await until(() => client.transport.state === 'closed', 'revoked SDK connection closes')
  const outboxPath = join(directory, 'chat-accounting.sqlite')
  let outbox = new AccountingStore(outboxPath)
  const [job] = outbox.pending()
  assert.equal(job.application.originApplicationId, application.id)
  assert.equal(job.application.executorApplicationId, 'core')
  assert.equal(job.application.delegationId, issued.grant.id)
  assert.ok(!JSON.stringify(job).includes(issued.token))
  outbox.close()
  await db.identity.renameApplication('admin', tenantId, application.id, 'Renamed A07 application')
  await db.identity.revokeApplication('admin', tenantId, application.id)
  assert.equal((await read(rotated.token)).statusCode, 403)
  client.dispose()
  await core.close(); core = undefined
  // Reopen the durable Core database and outbox. Identity keeps its own live
  // repository connection, as it does when deployed as a separate service.
  db = new VoiceChatDb(databasePath)
  databases.push(db)
  await db.ready
  loseSettlement = false; billingUnavailable = false
  coreUrl = await startCore()
  outbox = new AccountingStore(outboxPath)
  try { await until(() => outbox.pending().length === 0, 'startup outbox reconciliation') }
  finally { outbox.close() }
  await db.chat.setTurnQueuePaused('admin', conversation.id, false)
  const sessionToken = signToken({ name: 'admin', role: 'admin' }, secret)
  const userOptions = { headers: { cookie: 'vc_session=' + sessionToken } }
  const userSocket = inProcess ? await core.injectWS('/ws', userOptions)
    : new WebSocket(coreUrl.replace('http:', 'ws:') + '/ws', userOptions)
  cleanup.push(() => userSocket.terminate())
  if (!inProcess) await once(userSocket, 'open')
  await until(() => db.chat.isTurnQueuePaused('admin', conversation.id), 'recovered queue denies lost grant reference')
  const recoveredQueue = await db.chat.listQueuedTurns('admin', conversation.id)
  assert.equal(recoveredQueue.length, 1)
  assert.equal(recoveredQueue[0].status, 'failed')
  userSocket.terminate()
  assert.equal(readFileSync(invocations, 'utf8'), 'run\n')
  assert.equal(ledger.balance(environmentId, tenantId).spentMicroUsd, 600)
  assert.equal(ledger.balance(environmentId, tenantId).requests, 1)
  const receipt = await claude.executionReceipt({ operationId: job.id, reservationId: job.reservation.id,
    userId: job.session.userId, tenantId, environmentId, originModuleId: 'chat', application: job.application })
  assert.equal(receipt.state, 'finished')
  assert.deepEqual(receipt.context.application, job.application)

  const activity = new ActivityStore(join(directory, 'analytics.sqlite'))
  cleanup.push(() => activity.close())
  const analyticsRuntime = { config: { environmentId }, dependency: id => id === 'identity' ? identityTransport : billingTransport }
  const analytics = buildAnalyticsServer(activity, analyticsAuthority(analyticsRuntime), componentBillingReports(analyticsRuntime))
  cleanup.push(() => analytics.close())
  const period = { from: Date.now() - 60_000, to: Date.now() + 60_000 }
  const report = ledger.usageReport({ userId: job.session.userId, tenantId, environmentId }, period.from, period.to)
  assert.equal(report.events, 1)
  assert.equal(report.actualMicroUsd, 600)
  assert.equal(report.totalTokens, 110)
  assert.deepEqual(report.applications, [{ applicationId: application.id, events: 1, actualMicroUsd: 600,
    inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0,
    totalTokens: 110, missingUsageEvents: 0 }])
  const query = new URLSearchParams(period).toString()
  const accountResponse = await analytics.inject({ url: '/api/analytics/account?' + query,
    headers: { authorization: 'Bearer ' + sessionToken } })
  assert.equal(accountResponse.statusCode, 200)
  assert.equal(accountResponse.json().usageStatus, 'current')
  assert.deepEqual(accountResponse.json().usage, report)
  const appResponse = await analytics.inject({ url: '/api/analytics/application?' + query + '&applicationId=' + application.id,
    headers: { authorization: 'Bearer ' + sessionToken } })
  assert.equal(appResponse.statusCode, 200)
  assert.equal(appResponse.json().usageStatus, 'current')
  assert.deepEqual(appResponse.json().usage, report.applications.find(row => row.applicationId === application.id))
  assert.equal(appResponse.json().usage.actualMicroUsd, 600)
  assert.equal(report.modules.length, 1, 'no second executor or child charge')
})

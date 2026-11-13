import { randomUUID } from 'node:crypto'
import { PassThrough } from 'node:stream'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { allowedModels, normalizeClaudeModel, type LlmClient, type LlmHandle, type LlmRequest } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import { MODEL_API_PREFIX, type ModelToken } from '../auth/modelTokens.js'
import { deploymentModelAccess, type ChatModelPolicy } from '../chatModelPolicy.js'
import { RemoteLlmClient } from '../llm/remoteClient.js'
import type { ChatAccounting } from '../billing/chatAccounting.js'
import type { AccountingStore } from '../billing/accountingStore.js'
import type { BillingSessions } from '../billing/sessions.js'

interface Options {
  db: VoiceChatDb
  token(req: FastifyRequest): ModelToken | undefined
  accounting?: ChatAccounting
  store?: AccountingStore
  sessions: BillingSessions
  claude: LlmClient
  codex?: LlmClient
  chatModels?: ChatModelPolicy
  concurrency?: number
  requestsPerMinute?: number
}
const positive = (value: number | undefined, fallback: number) =>
  Number.isSafeInteger(value) && value! > 0 ? value! : fallback

/** The only public runner operations; no wildcard forwarding to the private service. */
export function registerModelRunner(app: FastifyInstance, opts: Options): void {
  const active = new Map<string, { sid: string; operationId?: string; cancel(): void }>()
  const windows = new Map<string, { start: number; count: number }>()
  const concurrency = positive(opts.concurrency, 2)
  const rate = positive(opts.requestsPerMinute, 60)
  const catalog = async (req: FastifyRequest) => {
    const access = deploymentModelAccess(await opts.db.identity.getUserLlmAccess(req.user!.name), opts.chatModels)
    return { claude: allowedModels(access, 'claude'), codex: allowedModels(access, 'codex') }
  }
  app.get(MODEL_API_PREFIX + 'health', async req => {
    const health = async (kind: 'claude' | 'codex') => {
      const engine = (await opts.db.llm.resolveLlmEngine(undefined, kind, req.user!.role)).engine
      const client = engine ? new RemoteLlmClient({ kind, baseUrl: engine.baseUrl, token: engine.token })
        : kind === 'claude' ? opts.claude : opts.codex
      try { return client instanceof RemoteLlmClient ? await client.health(req.user!.name) : undefined } catch { return undefined }
    }
    const [claude, codex] = await Promise.all([health('claude'), health('codex')])
    return { ok: !!opts.accounting && !!(claude?.ok || codex?.ok),
      bins: { claude: claude?.bins?.claude ?? { present: false, version: null }, codex: codex?.bins?.codex ?? { present: false, version: null } },
      login: { claude: claude?.login?.claude ?? { loggedIn: false }, codex: codex?.login?.codex ?? { loggedIn: false } },
      runs: [...active.values()].filter(run => run.sid === opts.token(req)?.sid).length }
  })
  app.get(MODEL_API_PREFIX + 'models', async req => {
    if (!req.user?.account?.capabilities.includes('chat.use') || req.user.role === 'observer') return { models: [], engines: [] }
    const models = await catalog(req)
    const engines = await opts.db.llm.listLlmEnginesForRole(req.user.role)
    for (const kind of ['claude', 'codex'] as const) {
      if (!engines.some(engine => engine.kind === kind) && (kind === 'claude' ? opts.claude : opts.codex) instanceof RemoteLlmClient) {
        engines.push({ id: 'default:' + kind, name: kind, kind, isDefault: true })
      }
    }
    return { models: Object.entries(models).flatMap(([kind, items]) => items.map(model => ({ ...model, kind }))),
      engines: engines.filter(engine => models[engine.kind].length > 0) }
  })
  app.delete<{ Params: { id: string } }>(MODEL_API_PREFIX + 'run/:id', async (req, reply) => {
    const run = active.get(req.params.id), token = opts.token(req)
    if (!run || run.sid !== token?.sid) return reply.code(404).send({ error: 'run_not_found' })
    run.cancel()
    return { stopped: true }
  })
  app.post<{ Body: Record<string, unknown> }>(MODEL_API_PREFIX + 'run', async (req, reply) => {
    const token = opts.token(req), user = req.user, body = req.body
    if (!token || !user) return reply.code(403).send({ error: 'token_scope_denied' })
    if (!user.account?.capabilities.includes('chat.use') || user.role === 'observer') return reply.code(403).send({ error: 'tariff_denied' })
    if (!body || (body.kind !== 'claude' && body.kind !== 'codex') || typeof body.prompt !== 'string' || !body.prompt.trim()
      || typeof body.model !== 'string' || (body.sessionId != null && typeof body.sessionId !== 'string')
      || (body.runId !== undefined && (typeof body.runId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.runId)))) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const now = Date.now()
    for (const [sid, window] of windows) if (now - window.start >= 60_000) windows.delete(sid)
    const window = windows.get(token.sid) ?? { start: now, count: 0 }
    windows.set(token.sid, window)
    if (++window.count > rate) return reply.code(429).send({ error: 'rate_limit_exceeded' })
    const running = [...active.values()].filter(run => run.sid === token.sid).length
    const pending = opts.store?.pending().filter(job => job.modelApi && 'sid' in job.session && job.session.sid === token.sid
      && ![...active.values()].some(run => run.operationId === job.id)).length ?? 0
    if (running + pending >= concurrency) return reply.code(429).send({ error: 'concurrency_limit_exceeded' })
    const runId = body.runId as string | undefined ?? randomUUID()
    if (active.has(runId)) return reply.code(409).send({ error: 'run_already_exists' })
    // Reserve the token slot before any asynchronous policy or Billing work.
    let handle: LlmHandle | undefined, cancelled = false
    const stream = new PassThrough()
    const release = () => { if (active.get(runId) === entry) active.delete(runId) }
    const cancel = () => {
      if (cancelled) return
      cancelled = true; handle?.cancel(); release()
      if (!stream.writableEnded) stream.end(dispatched && !exit ? JSON.stringify({ t: 'exit', code: null }) + '\n' : undefined)
      if (!dispatched && !failed && !reply.sent && !reply.raw.headersSent && !reply.raw.destroyed) {
        failed = true
        reply.code(409).send({ error: 'run_cancelled' })
      }
    }
    const entry = { sid: token.sid, operationId: undefined as string | undefined, cancel }
    active.set(runId, entry)
    reply.raw.on('close', () => { if (!reply.raw.writableFinished) cancel() })
    let dispatched = false, exit = false, failed = false
    const fail = (status: number, reason: string) => {
      if (failed) return
      failed = true
      release()
      if (dispatched) { if (!stream.destroyed) stream.end(JSON.stringify({ t: 'exit', code: 1 }) + '\n'); return }
      if (!reply.sent) reply.code(status).send({ error: reason })
    }
    try {
      const models = await catalog(req)
      const model = body.model ? (body.kind === 'claude' ? normalizeClaudeModel(body.model) : body.model) : models[body.kind][0]?.id
      if (!models[body.kind].some(item => item.id === model)) return fail(403, 'model_not_allowed')
      const account = await opts.db.identity.getUser(user.name)
      if (!account || account.blocked) return fail(403, 'account_unavailable')
      if (account.llmLimitUsd !== null && account.llmLimitUsd >= 0) return fail(402, 'insufficient_balance')
      if (!opts.accounting) return fail(503, 'accounting_unavailable')
      const resolved = await opts.db.llm.resolveLlmEngine(undefined, body.kind, user.role)
      const base = resolved.engine ? new RemoteLlmClient({ kind: body.kind, baseUrl: resolved.engine.baseUrl, token: resolved.engine.token })
        : body.kind === 'codex' ? opts.codex : opts.claude
      if (!(base instanceof RemoteLlmClient)) return fail(503, 'runner_unavailable')
      const session = opts.sessions.register(user, token.sid, req.headers.authorization!.slice(7))
      if (!session) return fail(403, 'token_scope_denied')
      const client = base.observingFrames(frame => {
        if (cancelled || stream.destroyed || stream.writableEnded) return
        if (frame.t === 'exit') exit = true
        // A disconnected or slow reader must not stall authoritative accounting.
        if (stream.writableLength > 1024 * 1024) { cancel(); return }
        stream.write(JSON.stringify(frame) + '\n')
      })
      const request: LlmRequest = {
        userId: user.name, prompt: body.prompt, model: body.model || model!, sessionId: body.sessionId as string | null ?? null,
        textOnly: true, executionDisabled: true,
        ...(typeof body.deepThinking === 'boolean' ? { deepThinking: body.deepThinking } : {}),
        ...(['low', 'medium', 'high', 'xhigh', 'max'].includes(String(body.reasoningEffort))
          ? { reasoningEffort: body.reasoningEffort as LlmRequest['reasoningEffort'] } : {})
      }
      if (cancelled) return
      handle = opts.accounting.wrap(client, {
        login: user.name, session, originModuleId: 'chat', modelApi: true, engineId: resolved.engine?.id,
        application: { version: 1, originApplicationId: 'core', executorApplicationId: 'core', tokenId: token.sid, delegationId: null },
        onOperation(operationId) {
          entry.operationId = operationId
        },
        onDispatch() {
          dispatched = true
          reply.header('x-run-id', runId).header('cache-control', 'no-store').type('application/x-ndjson').send(stream)
        },
        onAdmissionError(status, reason) {
          const balance = ['insufficient_balance', 'budget_exhausted', 'daily_user_budget_exhausted', 'execution_cost_not_bounded'].includes(reason)
          fail(balance ? 402 : status, balance ? 'insufficient_balance' : reason)
        }
      }).send(request, {
        onDelta() {}, onSession() {},
        onDone() {
          release()
          if (!exit && !stream.writableEnded) stream.write(JSON.stringify({ t: 'exit', code: 1 }) + '\n')
          stream.end()
        },
        onError() {
          if (!dispatched) { fail(503, 'runner_unavailable'); return }
          release()
          if (!exit) stream.write(JSON.stringify({ t: 'exit', code: 1 }) + '\n')
          stream.end()
        }
      })
      // Fastify must keep the reply pending while asynchronous admission runs.
      return reply
    } catch { fail(503, 'model_runner_unavailable') }
  })
  app.addHook('onClose', async () => { for (const run of active.values()) run.cancel() })
}

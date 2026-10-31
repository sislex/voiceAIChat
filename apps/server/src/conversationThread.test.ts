import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { REST, type LlmClient, type LlmRequest, type LlmStreamHandlers, type LlmProvider } from '@voicechat/shared'
import { VoiceChatDb } from './db/database.js'
import { createTurnManager } from './turns.js'
import { createConversationSummaryService } from './conversationSummary.js'
import { conversationThreadCost, resetConversationThread, threadCostThresholds } from './conversationThread.js'
import { registerRest } from './routes/rest.js'

const U = 'alice'
async function fixture(provider: LlmProvider = 'codex') {
  const db = new VoiceChatDb(':memory:')
  await db.identity.createUser(U, '', 'admin')
  const conv = await db.chat.createConversation(U, 'Thread')
  await db.chat.setClaudeSession(U, conv.id, provider + ':current')
  const requests: LlmRequest[] = []
  let handlers: LlmStreamHandlers | undefined
  const client: LlmClient = { send(request, h) { requests.push(request); handlers = h; return { cancel() {} } } }
  const summaryClient: LlmClient = { send(_request, h) {
    queueMicrotask(() => h.onDone('Decisions and open tasks'))
    return { cancel() {} }
  } }
  const summary = createConversationSummaryService({ db, client: summaryClient, model: 'cheap' })
  const turns = createTurnManager({ db, claude: client, codex: client, conversationSummary: summary })
  const app = Fastify()
  app.decorateRequest('user', null)
  app.addHook('preHandler', async req => { req.user = { name: U, role: 'admin' } as NonNullable<typeof req.user> })
  await registerRest(app, db, '/tmp/thread-test', { resetThread: turns.resetThread })
  const add = (sessionId: string, tokens: number, engine = provider) => db.chat.addMessage(U, conv.id, 'ai', 'answer', '', engine, {
    sessionId, inputTokens: 100, cacheReadTokens: tokens - 100, outputTokens: 50, durationMs: tokens / 10
  })
  const mode = async (threadReset: string) => {
    const settings = (await db.settings.getChatSettings(U, conv.id))!
    return app.inject({ method: 'PATCH', url: REST.conversationSettings(conv.id), payload: {
      version: 1, expectedRevision: settings.revision, owner: 'conversation', values: { threadReset }
    } })
  }
  return { db, conv, app, turns, summary, requests, add, mode, handlers: () => handlers,
    close: async () => { await turns.flushInterrupted(); await turns.idle(); await app.close(); await db.close() } }
}

afterEach(() => vi.unstubAllEnvs())

describe('conversation threads', () => {
  it.each(['missing', 'throw', 'null', 'failed-runners'] as const)('resets when summary service is %s', async mode => {
    const f = await fixture()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const message = await f.add('current', 1000)
      const failing: LlmClient = { send(_request, h) { queueMicrotask(() => h.onError('offline')); return { cancel() {} } } }
      const service = mode === 'missing' ? undefined : mode === 'failed-runners'
        ? createConversationSummaryService({ db: f.db, client: failing, model: 'primary', fallback: { client: failing, model: 'secondary' } })
        : { refresh: async () => { if (mode === 'throw') throw new Error('offline'); return null } }
      const result = await resetConversationThread(f.db, service, U, f.conv.id, true)
      expect(result).toMatchObject({ claudeSessionId: null, summary: { source: 'fallback', coversUntilMessageId: message.id } })
      expect(await resetConversationThread(f.db, service, U, 'missing', true)).toBeNull()
    } finally { log.mockRestore(); await f.close() }
  })

  it('GET scopes lightweight usage to the current provider/session and hides foreign conversations', async () => {
    const f = await fixture()
    try {
      await f.add('old', 9e6)
      await f.add('current', 1000)
      await f.add('current', 2000)
      await f.add('current', 3000)
      await f.add('current', 1.2e6)
      await f.add('current', 8e6, 'claude')
      vi.spyOn(f.db.chat, 'listMessages').mockRejectedValue(Error('full history forbidden'))
      const response = await f.app.inject({ url: REST.conversationThreadCost(f.conv.id) })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ turnsInThread: 4, provider: 'codex', sessionActive: true,
        recommendation: 'reset', baseline: { inputTokens: 2000, source: 'thread-start' },
        last: { inputTokens: 100, cacheReadTokens: 1199900 }, extra: { tokensPerTurn: 1198000 } })
      const foreign = await f.db.chat.createConversation('bob', 'Private')
      expect((await f.app.inject({ url: REST.conversationThreadCost(foreign.id) })).statusCode).toBe(404)
      expect((await f.app.inject({ method: 'POST', url: REST.conversationThreadReset(foreign.id) })).statusCode).toBe(404)
    } finally { await f.close() }
  })
  it.each(['claude', 'codex'] as const)('resets %s with a refreshed summary and cold-starts the next turn', async provider => {
    const f = await fixture(provider)
    try {
      await f.add('current', 1200000)
      const result = await f.app.inject({ method: 'POST', url: REST.conversationThreadReset(f.conv.id) })
      expect(result.statusCode).toBe(200)
      expect(result.json()).toMatchObject({ ok: true, summary: { text: 'Decisions and open tasks' } })
      expect((await f.db.chat.getConversation(U, f.conv.id))?.claudeSessionId).toBeNull()
      expect((await f.db.chat.listMessages(U, f.conv.id)).at(-1)?.text).toBe('Тред сброшен: было 1200000 токенов на ход')
      await f.turns.start({ userId: U, conversationId: f.conv.id, segments: [{ speakerId: 1, text: 'Continue' }] })
      expect(f.requests[0]?.sessionId).toBeNull()
      expect(f.requests[0]?.prompt).toContain('Decisions and open tasks')
      await f.handlers()!.onSession('new')
      await f.handlers()!.onDone('answer', { inputTokens: 200 })
      await f.turns.idle()
      expect((await f.db.chat.listMessages(U, f.conv.id)).at(-1)?.meta?.sessionId).toBe('new')
    } finally { await f.close() }
  })
  it('preserves the published reset route and response while enforcing turn admission', async () => {
    const f = await fixture('claude')
    try {
      await f.add('current', 1000)
      const refresh = vi.spyOn(f.summary, 'refresh')
      const url = REST.conversationThreadResetLegacy(f.conv.id)
      await f.turns.start({ userId: U, conversationId: f.conv.id, segments: [{ speakerId: 1, text: 'Go' }] })
      expect((await f.app.inject({ method: 'POST', url })).statusCode).toBe(409)
      await f.handlers()!.onDone('Done')
      await f.turns.idle()
      const response = await f.app.inject({ method: 'POST', url })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ id: f.conv.id, claudeSessionId: null })
      expect(response.json().contextUsage).toBeUndefined()
      expect(response.json()).not.toHaveProperty('ok')
      expect(refresh).not.toHaveBeenCalled()
      const foreign = await f.db.chat.createConversation('bob', 'Private')
      expect((await f.app.inject({ method: 'POST', url: REST.conversationThreadResetLegacy(foreign.id) })).statusCode).toBe(404)
    } finally { await f.close() }
  })
  it('returns 409 during an active turn and while a reset is generating the summary', async () => {
    const f = await fixture('claude')
    try {
      await f.add('current', 1000)
      await f.turns.start({ userId: U, conversationId: f.conv.id, segments: [{ speakerId: 1, text: 'Go' }] })
      expect((await f.app.inject({ method: 'POST', url: REST.conversationThreadReset(f.conv.id) })).json()).toMatchObject({ code: 'turn_active' })
      await f.handlers()!.onDone('Done')
      await f.turns.idle()
      let release!: () => void
      const original = f.summary.refresh
      let enteredResolve!: () => void
      const entered = new Promise<void>(resolve => { enteredResolve = resolve })
      vi.spyOn(f.summary, 'refresh').mockImplementation(async (...args) => {
        enteredResolve()
        await new Promise<void>(resolve => { release = resolve })
        return original(...args)
      })
      const first = f.app.inject({ method: 'POST', url: REST.conversationThreadReset(f.conv.id) })
      const running = first.then(response => response)
      await entered
      const conflict = await f.app.inject({ method: 'POST', url: REST.conversationThreadReset(f.conv.id) })
      expect(conflict.statusCode).toBe(409)
      release()
      expect((await running).statusCode).toBe(200)
    } finally { await f.close() }
  })
  it.each(['off', 'hint', 'auto'])('%s setting persists and only auto resets before model execution', async mode => {
    const f = await fixture('claude')
    try {
      await f.add('current', 1100000)
      expect((await f.mode(mode)).statusCode).toBe(200)
      expect((await f.db.settings.getChatSettings(U, f.conv.id))?.conversation.threadReset).toBe(mode)
      await f.turns.start({ userId: U, conversationId: f.conv.id, segments: [{ speakerId: 1, text: 'Next' }] })
      expect(f.requests[0]?.sessionId).toBe(mode === 'auto' ? null : 'current')
      if (mode === 'auto') expect(f.requests[0]?.prompt).toContain('Decisions and open tasks')
      expect((await f.mode('invalid')).statusCode).toBe(400)
    } finally { await f.close() }
  })
  it('resets with a persisted fallback if summarization makes no progress', async () => {
    const f = await fixture()
    try {
      await f.add('current', 1000)
      vi.spyOn(f.summary, 'refresh').mockImplementation(() => f.db.chat.getConversation(U, f.conv.id))
      const response = await f.app.inject({ method: 'POST', url: REST.conversationThreadReset(f.conv.id) })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ ok: true, summary: { source: 'fallback', text: expect.stringContaining('answer') } })
      expect((await f.db.chat.getConversation(U, f.conv.id))?.claudeSessionId).toBeNull()
      expect((await f.app.inject({ method: 'POST', url: REST.conversationThreadReset(f.conv.id), payload: { summarize: 'no' } })).statusCode).toBe(400)
      expect((await f.app.inject({ method: 'POST', url: REST.conversationThreadReset(f.conv.id), payload: { summarize: false } })).json()).toMatchObject({ ok: true, summary: { source: 'fallback' } })
    } finally { await f.close() }
  })
  it('continues extracted queued work with fallback when automatic summary refresh fails', async () => {
    const f = await fixture('claude')
    try {
      await f.add('current', 1100000)
      await f.mode('auto')
      const message = await f.db.chat.addMessage(U, f.conv.id, 'u0', 'Pending request', '')
      vi.spyOn(f.summary, 'refresh').mockImplementation(() => f.db.chat.getConversation(U, f.conv.id))
      await f.turns.start({ userId: U, conversationId: f.conv.id, messageId: message.id,
        fromQueue: true, segments: [{ speakerId: 1, text: message.text }] })
      expect(f.requests).toHaveLength(1)
      expect(f.requests[0]?.sessionId).toBeNull()
      expect(f.requests[0]?.prompt).toContain('RECENT MESSAGES')
      expect(await f.db.chat.isTurnQueuePaused(U, f.conv.id)).toBe(false)
      await f.handlers()!.onDone('Continued')
      await f.turns.idle()
    } finally { await f.close() }
  })
  it('does not treat a reply without input usage as a zero-cost measured turn', async () => {
    const f = await fixture('claude')
    try {
      await f.db.chat.addMessage(U, f.conv.id, 'ai', 'No usage', '', 'claude', {
        sessionId: 'current', outputTokens: 50, durationMs: 100
      })
      const cost = () => f.app.inject({ url: REST.conversationThreadCost(f.conv.id) })
      expect((await cost()).json()).toMatchObject({ turnsInThread: 0, last: null, baseline: { source: 'estimate' } })
      await f.add('current', 1200000)
      await f.db.chat.addMessage(U, f.conv.id, 'ai', 'No usage again', '', 'claude', { sessionId: 'current' })
      expect((await cost()).json()).toMatchObject({ turnsInThread: 1, recommendation: 'reset',
        baseline: { inputTokens: 1200000, source: 'thread-start' } })
      await f.db.chat.addMessage(U, f.conv.id, 'ai', 'Measured zero', '', 'claude', { sessionId: 'current', inputTokens: 0 })
      expect((await cost()).json()).toMatchObject({ turnsInThread: 2, recommendation: 'ok', last: { inputTokens: 0 } })
    } finally { await f.close() }
  })
  it('supports legacy Codex session attribution and estimates when measured usage is absent', async () => {
    const f = await fixture()
    try {
      await f.db.chat.addMessage(U, f.conv.id, 'ai', 'legacy', '', 'codex', {
        inputTokens: 100, cacheReadTokens: 400000, codexThreadUsage: {
          sessionId: 'current', inputTokens: 9000000, cacheReadTokens: 8000000, outputTokens: 1000, cacheCreationTokens: 0
        }
      })
      expect((await conversationThreadCost(f.db, U, (await f.db.chat.getConversation(U, f.conv.id))!)).last?.inputTokens).toBe(100)
      await f.db.chat.setClaudeSession(U, f.conv.id, 'claude:unknown')
      expect(await conversationThreadCost(f.db, U, (await f.db.chat.getConversation(U, f.conv.id))!)).toMatchObject({
        turnsInThread: 0, baseline: { source: 'estimate' }, last: null
      })
      vi.stubEnv('VC_THREAD_RESET_CONSIDER_TOKENS', '12')
      vi.stubEnv('VC_THREAD_RESET_RESET_TOKENS', '25')
      expect(threadCostThresholds()).toEqual({ considerTokens: 12, resetTokens: 25 })
      vi.stubEnv('VC_THREAD_RESET_RESET_TOKENS', '-1')
      expect(threadCostThresholds().resetTokens).toBe(1000000)
    } finally { await f.close() }
  })
})

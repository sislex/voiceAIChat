import { describe, expect, it, vi } from 'vitest'
import type { LlmClient, LlmRequest, LlmStreamHandlers } from '@voicechat/shared'
import { VoiceChatDb } from './db/database.js'
import { createConversationSummaryService, fallbackSummary, SUMMARY_PROMPT_CHARS } from './conversationSummary.js'

function fakeRunner(responses: Array<string | Error>) {
  const requests: LlmRequest[] = []
  const client: LlmClient = { send(request, handlers: LlmStreamHandlers) {
    requests.push(request)
    const response = responses.shift() ?? 'summary'
    queueMicrotask(() => response instanceof Error ? handlers.onError(response.message) : handlers.onDone(response))
    return { cancel() {} }
  } }
  return { client, requests }
}

async function seeded(count: number) {
  const db = new VoiceChatDb(':memory:')
  await db.identity.createUser('alice', '', 'admin')
  const conversation = await db.chat.createConversation('alice', 'Summary')
  for (let index = 1; index <= count; index++) await db.chat.addMessage('alice', conversation.id, index % 2 ? 'u1' : 'ai', `message ${index}`, '')
  return { db, conversation }
}

describe('rolling conversation summary', () => {
  it('retries the other runner and emits structured JSON without conversation text', async () => {
    const { db, conversation } = await seeded(2)
    const primary = fakeRunner([new Error('runner unavailable')])
    const secondary = fakeRunner(['Recovered'])
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const service = createConversationSummaryService({
        db, client: primary.client, model: 'primary',
        fallback: { client: secondary.client, model: 'secondary' }
      })
      expect((await service.refresh('alice', conversation.id))?.summary?.text).toBe('Recovered')
      expect(secondary.requests[0]?.prompt).toBe(primary.requests[0]?.prompt)
      const event = JSON.parse(log.mock.calls[0]![0])
      expect(event).toEqual({
        event: 'conversation_summary_failed', conversationId: conversation.id, model: 'primary',
        reason: 'Error', error: 'runner unavailable', messageCount: 2,
        promptChars: primary.requests[0]!.prompt.length
      })
      expect(JSON.stringify(event)).not.toContain('message 1')
    } finally { log.mockRestore(); await db.close() }
  })

  it('rolls large history oldest first with bounded prompts and bounded model output', async () => {
    const { db, conversation } = await seeded(0)
    for (let i = 0; i < 25; i++) await db.chat.addMessage('alice', conversation.id, 'u1', `entry-${i} ` + 'x'.repeat(50_000), '')
    const pending = (await db.chat.summaryMessages('alice', conversation.id))!
    const runner = fakeRunner(['first ' + 'x'.repeat(40_000), 'second', 'third'])
    const service = createConversationSummaryService({ db, client: runner.client, model: 'cheap' })
    const result = await service.refresh('alice', conversation.id)
    expect(runner.requests.length).toBeGreaterThan(1)
    for (const request of runner.requests) expect(request.prompt.length).toBeLessThanOrEqual(SUMMARY_PROMPT_CHARS)
    expect(runner.requests[0]!.prompt).toContain('entry-0 ')
    expect(runner.requests[1]!.prompt).toContain('PREVIOUS SUMMARY:\nfirst ')
    expect(runner.requests.at(-1)!.prompt).toContain('entry-24 ')
    expect(result?.summary?.coversUntilMessageId).toBe(pending.messages.at(-1)!.id)
    const fallback = fallbackSummary({ text: 'Prior decisions', coversUntilMessageId: 'old', updatedAt: 1 }, pending.messages)
    expect(fallback.text.length).toBeLessThanOrEqual(12_000)
    expect(fallback.text).toContain('Prior decisions')
    expect(fallback.text.indexOf('entry-24 ')).toBeLessThan(fallback.text.indexOf('entry-23 '))
    expect(fallback.text).not.toContain('entry-0 ')
    expect(fallback.source).toBe('fallback')
    await db.close()
  })

  it('cancels a stalled runner and tries the secondary after a bounded wait', async () => {
    const { db, conversation } = await seeded(1)
    vi.useFakeTimers()
    const cancel = vi.fn()
    const secondary = fakeRunner(['Recovered'])
    try {
      const service = createConversationSummaryService({
        db, client: { send: () => ({ cancel }) }, model: 'stalled',
        fallback: { client: secondary.client, model: 'secondary' }, logError: vi.fn()
      })
      const result = service.refresh('alice', conversation.id)
      await vi.advanceTimersByTimeAsync(30_000)
      expect((await result)?.summary?.text).toBe('Recovered')
      expect(cancel).toHaveBeenCalledOnce()
    } finally { vi.useRealTimers(); await db.close() }
  })

  it('tries the secondary only once when both models fail', async () => {
    const { db, conversation } = await seeded(1)
    const primary = fakeRunner([new Error('offline')])
    const secondary = fakeRunner([''])
    const logError = vi.fn()
    const service = createConversationSummaryService({
      db, client: primary.client, model: 'primary', fallback: { client: secondary.client, model: 'secondary' }, logError
    })
    expect((await service.refresh('alice', conversation.id))?.summary).toBeUndefined()
    expect(primary.requests).toHaveLength(1)
    expect(secondary.requests).toHaveLength(1)
    expect(logError).toHaveBeenCalledTimes(2)
    await db.close()
  })

  it('starts at forty published messages with a tool-free independent plan session', async () => {
    const { db, conversation } = await seeded(39)
    const runner = fakeRunner(['First summary'])
    const published = vi.fn()
    const service = createConversationSummaryService({ db, client: runner.client, model: 'cheap', now: () => 123, publish: published })
    service.consider('alice', conversation.id)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(runner.requests).toHaveLength(0)
    await db.chat.addMessage('alice', conversation.id, 'u1', 'message 40', '')
    service.consider('alice', conversation.id)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(runner.requests[0]).toMatchObject({ sessionId: null, model: 'cheap', permissionMode: 'plan', textOnly: true, executionDisabled: true })
    expect((await db.chat.getConversation('alice', conversation.id))?.summary).toEqual({ text: 'First summary', coversUntilMessageId: expect.any(String), updatedAt: 123 })
    expect(published).toHaveBeenCalledOnce()
    await db.close()
  })

  it('updates incrementally from the previous boundary', async () => {
    const { db, conversation } = await seeded(40)
    const runner = fakeRunner(['First', 'Second'])
    const service = createConversationSummaryService({ db, client: runner.client, model: 'cheap' })
    await service.refresh('alice', conversation.id)
    for (let index = 41; index <= 80; index++) await db.chat.addMessage('alice', conversation.id, 'u1', `message ${index}`, '')
    await service.refresh('alice', conversation.id)
    expect(runner.requests[1]!.prompt).toContain('PREVIOUS SUMMARY:\nFirst')
    expect(runner.requests[1]!.prompt).toContain('message 41')
    expect(runner.requests[1]!.prompt).not.toContain('message 1\n')
    await db.close()
  })

  it('keeps turns successful when the runner fails and retries only at the next threshold', async () => {
    const { db, conversation } = await seeded(40)
    const runner = fakeRunner([new Error('offline'), 'Recovered'])
    const errors = vi.fn()
    const service = createConversationSummaryService({ db, client: runner.client, model: 'cheap', logError: errors })
    await service.refresh('alice', conversation.id)
    expect((await db.chat.getConversation('alice', conversation.id))?.summary).toBeUndefined()
    expect(errors).toHaveBeenCalledOnce()
    for (let index = 41; index <= 79; index++) await db.chat.addMessage('alice', conversation.id, 'u1', `message ${index}`, '')
    service.consider('alice', conversation.id)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(runner.requests).toHaveLength(1)
    await db.chat.addMessage('alice', conversation.id, 'u1', 'message 80', '')
    service.consider('alice', conversation.id)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(runner.requests).toHaveLength(2)
    await db.close()
  })
})

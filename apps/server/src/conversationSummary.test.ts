import { describe, expect, it, vi } from 'vitest'
import type { LlmClient, LlmRequest, LlmStreamHandlers } from '@voicechat/shared'
import { VoiceChatDb } from './db/database.js'
import { createConversationSummaryService } from './conversationSummary.js'

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

import { afterEach, describe, expect, it } from 'vitest'
import { VoiceChatDb } from '../db/database.js'
import { createHistoryTurnBroker, historyGet, historySearch, HISTORY_GET_MESSAGE_CHARS, HISTORY_SEARCH_SNIPPET_CHARS } from './historyMcp.js'

const databases: VoiceChatDb[] = []
async function database() {
  const db = new VoiceChatDb(':memory:')
  databases.push(db)
  await db.ready
  await db.identity.createUser('alice', '', 'admin')
  return db
}
afterEach(async () => { await Promise.all(databases.splice(0).map((db) => db.close())) })

describe('history MCP data adapter', () => {
  it('searches only the scoped conversation and returns newest published matches first', async () => {
    const db = await database()
    const first = await db.chat.createConversation('alice', 'first')
    const second = await db.chat.createConversation('alice', 'second')
    await db.chat.addMessage('alice', first.id, 'u1', 'needle oldest', '10:00')
    await db.chat.addMessage('alice', second.id, 'u1', 'needle foreign', '10:01')
    const newest = await db.chat.addMessage('alice', first.id, 'ai', 'needle newest', '10:02')

    const hits = await historySearch(db, { userId: 'alice', conversationId: first.id }, 'needle', 20)
    expect(hits.map((hit) => hit.messageId)).toEqual([newest.id, expect.any(String)])
    expect(hits.every((hit) => !hit.snippet.includes('foreign'))).toBe(true)
  })

  it('caps search snippets and full messages and returns at most requested neighbours', async () => {
    const db = await database()
    const conversation = await db.chat.createConversation('alice', 'long')
    await db.chat.addMessage('alice', conversation.id, 'u1', 'before', '10:00')
    const center = await db.chat.addMessage('alice', conversation.id, 'ai', `needle ${'x'.repeat(5_000)}`, '10:01')
    await db.chat.addMessage('alice', conversation.id, 'u1', 'after', '10:02')
    await db.chat.addMessage('alice', conversation.id, 'u1', 'outside', '10:03')

    const [hit] = await historySearch(db, { userId: 'alice', conversationId: conversation.id }, 'needle', 1)
    expect(hit.snippet).toHaveLength(HISTORY_SEARCH_SNIPPET_CHARS)
    const around = await historyGet(db, { userId: 'alice', conversationId: conversation.id }, center.id, 1)
    expect(around.map((message) => message.text)).toEqual(['before', expect.stringMatching(/^needle /), 'after'])
    expect(around[1].text).toHaveLength(HISTORY_GET_MESSAGE_CHARS)
  })

  it('revokes a turn token synchronously', () => {
    const broker = createHistoryTurnBroker()
    broker.register('turn', { userId: 'alice', conversationId: 'conversation' })
    expect(broker.get('turn')).toBeDefined()
    broker.unregister('turn')
    expect(broker.get('turn')).toBeUndefined()
  })
})

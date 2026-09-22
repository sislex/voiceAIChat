import { afterEach, expect, it } from 'vitest'
import { VoiceChatDb } from './database.js'

const databases: VoiceChatDb[] = []
afterEach(async () => { for (const db of databases.splice(0)) await db.close() })

it('preserves per-user totals, model ordering, incomplete prices and inclusive dates in one summary', async () => {
  let now = 100
  const db = new VoiceChatDb(':memory:', { now: () => now })
  databases.push(db)
  await db.identity.createUser('alice', '', 'developer')
  await db.identity.createUser('empty', '', 'developer')
  const conversation = await db.chat.createConversation('alice', 'Usage')
  await db.chat.addMessage('alice', conversation.id, 'ai', 'one', '', 'claude', {
    model: 'reported', inputTokens: 10, outputTokens: 3, cacheReadTokens: 2, costUsd: 0.25,
  })
  now = 200
  await db.chat.addMessage('alice', conversation.id, 'ai', 'two', '', 'claude', {
    model: 'unpriced', inputTokens: 20, outputTokens: 7, interrupted: true,
  })
  now = 300
  await db.chat.addMessage('alice', conversation.id, 'ai', 'three', '', 'claude', {
    model: 'reported', inputTokens: 30, outputTokens: 1, cacheReadTokens: 4, costUsd: 0.5,
  })
  now = 400
  await db.chat.addMessage('alice', conversation.id, 'ai', 'outside period', '', 'claude', {
    model: 'reported', inputTokens: 1000, outputTokens: 1000, costUsd: 99,
  })
  await db.chat.addMessage('alice', conversation.id, 'u1', 'not usage', '')
  const summary = await db.chat.usageSummary(100, 300)
  const alice = summary.find(row => row.name === 'alice')!
  expect(alice.totals).toEqual((await db.chat.usageReport('alice', 'day', 100, 300)).totals)
  expect(alice.totals).toMatchObject({ inputTokens: 60, outputTokens: 11, cacheReadTokens: 6,
    costUsd: 0.75, messages: 3, interrupted: 1, costIncomplete: true })
  expect(alice.byModel.map(row => row.model)).toEqual(['unpriced', 'reported'])
  expect(summary.find(row => row.name === 'empty')).toMatchObject({ totals: {
    messages: 0, inputTokens: 0, costUsd: 0, costIncomplete: false,
  }, byModel: [] })
  expect((await db.chat.usageSummary(401)).every(row => row.totals.messages === 0)).toBe(true)
})

it('keeps database price estimates and omits usage without a current account', async () => {
  const db = new VoiceChatDb(':memory:')
  databases.push(db)
  await db.identity.createUser('alice', '', 'developer')
  const priced = await db.chat.createConversation('alice', 'Priced')
  await db.chat.addMessage('alice', priced.id, 'ai', 'priced', '', 'codex', {
    model: 'gpt-5.4', inputTokens: 800_000, cacheReadTokens: 200_000, outputTokens: 100_000,
  })
  const orphan = await db.chat.createConversation('removed-account', 'Orphan')
  await db.chat.addMessage('removed-account', orphan.id, 'ai', 'orphan', '', 'claude', {
    model: 'unknown', inputTokens: 900, outputTokens: 900,
  })
  const summary = await db.chat.usageSummary()
  expect(summary.map(row => row.name)).toEqual(['alice'])
  expect(summary[0].totals.costFromPrices).toBeCloseTo(3.55, 6)
  expect(summary[0].totals.costIncomplete).toBe(false)
  expect(summary[0].totals).toEqual((await db.chat.usageReport('alice', 'day')).totals)
})

it('isolates account reports by owner and period while retaining other conversation choices', async () => {
  let now = 100
  const db = new VoiceChatDb(':memory:', { now: () => now })
  databases.push(db)
  for (const name of ['alice', 'bob', 'empty']) await db.identity.createUser(name, '', 'developer')
  const first = await db.chat.createConversation('alice', 'First')
  const second = await db.chat.createConversation('alice', 'Second')
  const foreign = await db.chat.createConversation('bob', 'Foreign')
  await db.chat.addMessage('alice', first.id, 'ai', 'first', '', 'claude', { model: 'reported', inputTokens: 10, outputTokens: 2, costUsd: 0.1 })
  now = 200
  await db.chat.addMessage('alice', second.id, 'ai', 'second', '', 'claude', { model: 'unpriced', inputTokens: 20, outputTokens: 3, interrupted: true })
  await db.chat.addMessage('bob', foreign.id, 'ai', 'foreign', '', 'claude', { model: 'reported', inputTokens: 999, costUsd: 99 })
  now = 300
  await db.chat.addMessage('alice', first.id, 'ai', 'outside', '', 'claude', { model: 'reported', inputTokens: 999, costUsd: 99 })
  const report = await db.chat.usageReport('alice', 'day', 100, 200, first.id)
  expect(report.totals).toMatchObject({ messages: 1, inputTokens: 10, outputTokens: 2, costUsd: 0.1, costIncomplete: false })
  expect(report.byModel).toHaveLength(1)
  expect(report.byBucket).toHaveLength(1)
  expect(report.byConversation.map(row => row.conversationId).sort()).toEqual([first.id, second.id].sort())
  expect(report.byConversation.find(row => row.conversationId === second.id)).toMatchObject({ messages: 1, inputTokens: 20, interrupted: 1, costIncomplete: true })
  const empty = await db.chat.usageReport('empty', 'day', 100, 200)
  expect(empty.totals).toMatchObject({ messages: 0, inputTokens: 0, costUsd: 0, costIncomplete: false })
  expect(empty.byModel).toEqual([])
  expect(empty.byConversation).toEqual([])
  expect((await db.chat.usageReport('alice', 'day', 100, 200, foreign.id)).totals.messages).toBe(0)
})

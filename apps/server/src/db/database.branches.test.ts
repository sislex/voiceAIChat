import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VoiceChatDb } from './database.js'

for (const engine of ['sqlite', 'postgres'] as const) {
  describe.skipIf(engine === 'postgres' && !process.env.VC_TEST_DB_URL)(`message branches (${engine})`, () => {
    let db: VoiceChatDb
    let dir: string
    beforeEach(async () => {
      dir = mkdtempSync(join(tmpdir(), 'branches-'))
      db = new VoiceChatDb(join(dir, 'db.sqlite'), engine === 'postgres'
        ? { postgres: { url: process.env.VC_TEST_DB_URL!, schema: `branches_${randomUUID().replace(/-/g, '')}`, dropSchemaOnClose: true } }
        : {})
      await db.ready
    })
    afterEach(async () => { await db?.close(); if (dir) rmSync(dir, { recursive: true, force: true }) })

    const texts = async (conversationId: string) => (await db.chat.listMessages('owner', conversationId)).map(m => m.text)

    it('edits, retries and selects branches without losing variants', async () => {
      const c = await db.chat.createConversation('owner')
      await db.chat.addMessage('owner', c.id, 'u1', 'Q1', '10:00')
      await db.chat.addMessage('owner', c.id, 'ai', 'A1', '10:00')
      const q2 = await db.chat.addMessage('owner', c.id, 'u1', 'Q2', '10:01')
      await db.chat.addMessage('owner', c.id, 'ai', 'A2', '10:01')

      const edited = await db.chat.branchMessage('owner', c.id, q2.id, 'edit', 'Q2 edited')
      expect(edited.map(m => m.text)).toEqual(['Q1', 'A1', 'Q2 edited'])
      expect(edited[2].branch).toMatchObject({ index: 2, count: 2, previousId: q2.id, nextId: null })
      const a2b = await db.chat.addMessage('owner', c.id, 'ai', 'A2b', '10:02')
      expect(await texts(c.id)).toEqual(['Q1', 'A1', 'Q2 edited', 'A2b'])

      const retried = await db.chat.branchMessage('owner', c.id, a2b.id, 'retry')
      expect(retried.map(m => m.text)).toEqual(['Q1', 'A1', 'Q2 edited'])
      await db.chat.addMessage('owner', c.id, 'ai', 'A2c', '10:03')
      const afterRetry = await db.chat.listMessages('owner', c.id)
      expect(afterRetry.map(m => m.text)).toEqual(['Q1', 'A1', 'Q2 edited', 'A2c'])
      expect(afterRetry[3].branch).toMatchObject({ index: 2, count: 2 })

      const restored = await db.chat.branchMessage('owner', c.id, q2.id, 'select')
      expect(restored.map(m => m.text)).toEqual(['Q1', 'A1', 'Q2', 'A2'])
    })

    it('keeps system notes, queued turns and messages after a deletion on the active path', async () => {
      const c = await db.chat.createConversation('owner')
      await db.chat.addMessage('owner', c.id, 'u1', 'Q1', '10:00')
      const a1 = await db.chat.addMessage('owner', c.id, 'ai', 'A1', '10:00')
      await db.chat.addMessage('owner', c.id, 'u1', 'Q2', '10:01')
      await db.chat.resetConversationThread('owner', c.id)
      const queued = await db.chat.addMessage('owner', c.id, 'u1', 'Queued', '10:02')
      await db.chat.enqueueTurn('owner', c.id, queued.id, { segments: [{ speakerId: 1, text: 'Queued' }] })
      await db.chat.addMessage('owner', c.id, 'ai', 'A2', '10:02')
      await db.chat.takeQueuedTurn('owner', c.id)
      await db.chat.addMessage('owner', c.id, 'ai', 'A3', '10:03')
      expect((await texts(c.id)).filter(t => !t.startsWith('Системная'))).toEqual(['Q1', 'A1', 'Q2', 'A2', 'Queued', 'A3'])
      expect(await texts(c.id)).toHaveLength(7)

      await db.chat.deleteMessage('owner', c.id, a1.id)
      const q3 = await db.chat.addMessage('owner', c.id, 'u1', 'Q3', '10:04')
      await db.chat.branchMessage('owner', c.id, q3.id, 'edit', 'Q3 edited')
      expect((await texts(c.id)).filter(t => !t.startsWith('Системная'))).toEqual(['Q1', 'Q2', 'A2', 'Queued', 'A3', 'Q3 edited'])
    })
  })
}

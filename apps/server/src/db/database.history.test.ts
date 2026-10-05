import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Sql } from '@sislexa/identity/storage-sql/types'
import { VoiceChatDb } from './database.js'

for (const engine of ['sqlite', 'postgres'] as const) {
  describe.skipIf(engine === 'postgres' && !process.env.VC_TEST_DB_URL)(`history adapter (${engine})`, () => {
    let db: VoiceChatDb
    let dir: string
    let sql: Sql
    beforeEach(async () => {
      dir = mkdtempSync(join(process.env.DELIVERY_ATTEMPT_ROOT ? join(process.env.DELIVERY_ATTEMPT_ROOT, 'tmp') : tmpdir(), 'history-'))
      db = new VoiceChatDb(join(dir, 'db.sqlite'), {
        now: () => 1000,
        ...(engine === 'postgres' ? { postgres: { url: process.env.VC_TEST_DB_URL!, schema: `history_${randomUUID().replace(/-/g, '')}`, dropSchemaOnClose: true } } : {})
      })
      await db.ready
      sql = (db as unknown as { sql: Sql }).sql
    })
    afterEach(async () => { await db?.close(); if (dir) rmSync(dir, { recursive: true, force: true }) })

    it('uses the indexed published order and traverses tied positions while new messages arrive', async () => {
      const c = await db.chat.createConversation('owner')
      for (let i = 0; i < 11; i++) await db.chat.addMessage('owner', c.id, 'u1', `Message ${i}`, '10:00')
      // Exercise the id tie-breaker independently from wall-clock timestamps.
      await sql.run('UPDATE messages SET history_position = 1 WHERE conversation_id = ?', [c.id])
      const original = await db.chat.listMessages('owner', c.id)
      let page = (await db.chat.pageMessages('owner', c.id, 4))!
      expect(page.messages).toEqual(original.slice(-4))
      expect(page.history).toEqual({ hasMore: true, oldestId: original[7].id, total: 11 })
      await db.chat.addMessage('owner', c.id, 'ai', 'New reply', '10:00')
      let ids = page.messages.map(m => m.id)
      for (let i = 0; page.history.hasMore && i < 5; i++) {
        page = (await db.chat.pageMessages('owner', c.id, 4, page.history.oldestId!))!
        expect(page.history.total).toBe(12)
        ids = [...page.messages.map(m => m.id), ...ids]
      }
      expect(page.history.hasMore).toBe(false)
      expect(ids).toEqual(original.map(m => m.id))
      const indexes = engine === 'postgres'
        ? await sql.all<{ name: string }>('SELECT indexname AS name FROM pg_indexes WHERE schemaname = current_schema()')
        : await sql.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index'")
      expect(indexes.map(i => i.name)).toContain('idx_messages_history_page')
      if (engine === 'sqlite') {
        const plan = await sql.all(`EXPLAIN QUERY PLAN SELECT * FROM messages WHERE conversation_id = ? AND state = 'published' AND history_position IS NOT NULL AND (history_position, id) < (?, ?) ORDER BY history_position DESC, id DESC LIMIT ?`, [c.id, 1, original[7].id, 5])
        expect(JSON.stringify(plan)).toContain('idx_messages_history_page')
        expect(JSON.stringify(plan)).not.toContain('TEMP B-TREE')
      } else {
        await sql.transaction(async () => {
          // Small fixtures otherwise favor a sequential scan; verify the range
          // and ordering can both be served by the production index.
          await sql.exec('SET LOCAL enable_seqscan = off')
          const plan = await sql.all(`EXPLAIN (FORMAT JSON) SELECT * FROM messages WHERE conversation_id = ? AND state = 'published' AND history_position IS NOT NULL AND (history_position, id) < (?, ?) ORDER BY history_position DESC, id DESC LIMIT ?`, [c.id, 1, original[7].id, 5])
          expect(JSON.stringify(plan)).toContain('idx_messages_history_page')
        })
      }
    })

    it('pages legacy imported NULL positions in the same order as the complete history', async () => {
      const c = await db.chat.createConversation('owner')
      for (let i = 0; i < 7; i++) await db.chat.addMessage('owner', c.id, 'u1', `Message ${i}`, '10:00')
      await sql.run('UPDATE messages SET history_position = NULL WHERE history_position < 5 AND conversation_id = ?', [c.id])
      const original = await db.chat.listMessages('owner', c.id)
      let page = (await db.chat.pageMessages('owner', c.id, 2))!
      let messages = page.messages
      for (let i = 0; page.history.hasMore && i < 5; i++) {
        page = (await db.chat.pageMessages('owner', c.id, 2, page.history.oldestId!))!
        messages = [...page.messages, ...messages]
      }
      expect(page.history.hasMore).toBe(false)
      expect(messages).toEqual(original)
      expect((await db.chat.pageMessages('owner', c.id, 2, original[0].id))!.messages).toEqual([])
    })

    it('excludes queued messages and rejects deleted or foreign cursors', async () => {
      const c = await db.chat.createConversation('owner')
      const first = await db.chat.addMessage('owner', c.id, 'u1', 'first', '10:00')
      const queued = await db.chat.addMessage('owner', c.id, 'u1', 'queued', '10:00')
      await sql.run("UPDATE messages SET state = 'queued', history_position = NULL WHERE id = ?", [queued.id])
      expect(await db.chat.pageMessages('owner', c.id, 1)).toEqual({ messages: [first], history: { hasMore: false, oldestId: first.id, total: 1 } })
      expect(await db.chat.pageMessages('owner', c.id, 1, queued.id)).toBeNull()
      await db.chat.deleteMessage('owner', c.id, first.id)
      expect(await db.chat.pageMessages('owner', c.id, 1, first.id)).toBeNull()
      expect(await db.chat.pageMessages('owner', c.id, 1)).toEqual({ messages: [], history: { hasMore: false, oldestId: null, total: 0 } })
      const foreign = await db.chat.createConversation('other')
      const message = await db.chat.addMessage('other', foreign.id, 'u1', 'secret', '10:00')
      expect(await db.chat.pageMessages('owner', c.id, 1, message.id)).toBeNull()
      await expect(db.chat.pageMessages('owner', foreign.id, 1)).rejects.toThrow('conversation not found')
    })
  })
}

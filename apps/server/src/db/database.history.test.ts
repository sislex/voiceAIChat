import { randomUUID } from 'node:crypto'
import { createReadStream, mkdtempSync, rmSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { performance } from 'node:perf_hooks'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Sql } from '@sislexa/identity/storage-sql/types'
import type { TurnMeta } from '@voicechat/shared'
import { VoiceChatDb } from './database.js'

for (const engine of ['sqlite', 'postgres'] as const) {
  describe.skipIf(engine === 'postgres' && !process.env.VC_TEST_DB_URL)(`history adapter (${engine})`, () => {
    let db: VoiceChatDb
    let dir: string
    let sql: Sql
    let schema: string
    beforeEach(async () => {
      dir = mkdtempSync(join(process.env.DELIVERY_ATTEMPT_ROOT ? join(process.env.DELIVERY_ATTEMPT_ROOT, 'tmp') : tmpdir(), 'history-'))
      schema = `history_${randomUUID().replace(/-/g, '')}`
      db = new VoiceChatDb(join(dir, 'db.sqlite'), {
        now: () => 1000,
        ...(engine === 'postgres' ? { postgres: { url: process.env.VC_TEST_DB_URL!, schema, dropSchemaOnClose: true } } : {})
      })
      await db.ready
      sql = (db as unknown as { sql: Sql }).sql
    })
    afterEach(async () => { await db?.close(); if (dir) rmSync(dir, { recursive: true, force: true }) })

    const meta: TurnMeta = {
      model: 'sonnet', inputTokens: 7,
      activity: [{ kind: 'tool_result', summary: 'result', detail: 'result', raw: '{}' }],
      request: { provider: 'claude', model: 'sonnet', prompt: 'actual prompt', promptChars: 13, resumed: true,
        messages: [{ role: 'u1', text: 'legacy transcript' }] }
    }

    it('separates writes, compacts requests, bounds UTF-8 entries and cascades deletion', async () => {
      const c = await db.chat.createConversation('owner')
      const message = await db.chat.addMessage('owner', c.id, 'ai', 'answer', '10:00', undefined, {
        ...meta, activity: [{ kind: 'tool_result', summary: 'result', raw: 'я'.repeat(100_000), detail: 'x'.repeat(100_000) }]
      })
      const row = await sql.get<{ meta: string }>('SELECT meta FROM messages WHERE id = ?', [message.id])
      expect(JSON.parse(row!.meta)).not.toHaveProperty('activity')
      expect(JSON.parse(row!.meta)).not.toHaveProperty('request')
      const data = await db.chat.messageServiceData('owner', c.id, message.id)
      expect(data?.request).toMatchObject({ prompt: 'actual prompt', messageCount: 1 })
      expect(data?.request).not.toHaveProperty('messages')
      expect(await db.chat.recentRequestSizes('owner', c.id)).toEqual([{ time: '10:00', provider: 'claude', model: 'sonnet', promptChars: 13, resumed: true }])
      expect((await db.chat.lastMessageRequest('owner', c.id))?.request).toEqual(data?.request)
      expect(Buffer.byteLength(JSON.stringify(data?.activity?.[0]))).toBeLessThanOrEqual(65536)
      expect(data?.activity?.[0].raw).toContain('обрезано')
      expect(await db.chat.messageServiceData('other', c.id, message.id)).toBeNull()
      await db.chat.updateMessageMeta('owner', c.id, message.id, { taskLaunches: [] })
      expect(await db.chat.messageServiceData('owner', c.id, message.id)).toEqual(data)
      await db.chat.deleteMessage('owner', c.id, message.id)
      expect(await sql.get('SELECT message_id FROM message_service_data WHERE message_id = ?', [message.id])).toBeUndefined()
    })

    it('reads legacy diagnostics before migration, keeps history light, and resumes idempotently', async () => {
      const c = await db.chat.createConversation('owner')
      const m = await db.chat.addMessage('owner', c.id, 'ai', 'answer', '10:00')
      await sql.run('UPDATE messages SET meta = ? WHERE id = ?', [JSON.stringify(meta), m.id])
      expect((await db.chat.messageServiceData('owner', c.id, m.id))?.request?.prompt).toBe('actual prompt')
      for (const result of [
        await db.chat.listMessages('owner', c.id),
        (await db.chat.pageMessages('owner', c.id, 10))!.messages,
        await db.chat.conversationHistoryAround('owner', c.id, m.id, 1)
      ]) {
        expect(result[0].meta?.activity).toBeUndefined()
        expect(result[0].meta?.request).toBeUndefined()
        expect(result[0].meta?.serviceData?.requestBytes).toBeGreaterThan(0)
      }
      while (await db.chat.migrateMessageServiceDataBatch()) { /* drain bounded batches */ }
      const stored = await sql.get<{ meta: string }>('SELECT meta FROM messages WHERE id = ?', [m.id])
      expect(JSON.parse(stored!.meta)).not.toHaveProperty('activity')
      expect(JSON.parse(stored!.meta)).not.toHaveProperty('request')
      expect(await db.chat.migrateMessageServiceDataBatch()).toBe(0)
      expect((await db.chat.messageServiceData('owner', c.id, m.id))?.request).not.toHaveProperty('messages')
      expect((await sql.all('SELECT message_id FROM message_service_data'))).toHaveLength(1)
    })

    it('runs background batches while requests continue and preserves concurrent patches', async () => {
      const c = await db.chat.createConversation('owner')
      await sql.transaction(async () => {
        for (let i = 0; i < 105; i++) {
          await sql.run("INSERT INTO messages (id, conversation_id, role, text, time, created_at, state, history_position, meta) VALUES (?, ?, 'ai', 'answer', '10:00', 1, 'published', ?, ?)",
            [`legacy-${String(i).padStart(3, '0')}`, c.id, i, JSON.stringify(meta)])
        }
      })
      // Restart against pre-existing rows, as production does after deploying the schema.
      ;(db as unknown as { dropSchemaOnClose: string | null }).dropSchemaOnClose = null
      await db.close()
      db = new VoiceChatDb(join(dir, 'db.sqlite'), {
        ...(engine === 'postgres' ? { postgres: { url: process.env.VC_TEST_DB_URL!, schema, dropSchemaOnClose: true } } : {})
      })
      await db.ready
      sql = (db as unknown as { sql: Sql }).sql
      await db.chat.updateMessageMeta('owner', c.id, 'legacy-050', { taskLaunches: [] })
      await vi.waitFor(async () => {
        expect(await sql.all('SELECT message_id FROM message_service_data')).toHaveLength(105)
      }, { timeout: 10_000, interval: 50 })
      expect((await db.chat.getMessage('owner', c.id, 'legacy-050'))?.meta?.taskLaunches).toEqual([])
      expect(await db.chat.getConversation('owner', c.id)).not.toBeNull()
    })

    it.skipIf(!process.env.VC_SERVICE_DATA_STRESS)('reads 647 messages with 94 MiB legacy diagnostics in seconds after migration', async () => {
      const timer = (db as unknown as { serviceDataTimer: ReturnType<typeof setTimeout> | null }).serviceDataTimer
      if (timer) clearTimeout(timer)
      const c = await db.chat.createConversation('owner')
      const heavy = JSON.stringify({ ...meta,
        activity: [{ kind: 'tool_result', summary: 'large output', raw: 'x'.repeat(160_000) }],
        request: { ...meta.request, messages: [{ role: 'u1', text: 'y'.repeat(144_000) }] } })
      await sql.transaction(async () => {
        for (let i = 0; i < 647; i++) {
          await sql.run("INSERT INTO messages (id, conversation_id, role, text, time, created_at, state, history_position, meta) VALUES (?, ?, ?, 'answer', '10:00', 1, 'published', ?, ?)",
            [`stress-${String(i).padStart(3, '0')}`, c.id, i % 2 ? 'u1' : 'ai', i, i % 2 ? null : heavy])
        }
      })
      while (await db.chat.migrateMessageServiceDataBatch()) { /* drain */ }
      const start = performance.now()
      const messages = await db.chat.listMessages('owner', c.id)
      const elapsedMs = performance.now() - start
      const bytes = Buffer.byteLength(JSON.stringify(messages))
      expect(messages).toHaveLength(647)
      expect(messages.every(message => !message.meta?.activity && !message.meta?.request)).toBe(true)
      expect(elapsedMs).toBeLessThan(5000)
      expect(bytes).toBeLessThan(1_000_000)
      console.info('service-data stress', { engine, count: 647, legacyBytes: Buffer.byteLength(heavy) * 324, elapsedMs, bytes })
    }, 120_000)

    it.skipIf(!process.env.VC_SERVICE_DATA_BENCHMARK)('benchmarks a production message export before and after backfill', async () => {
      const timer = (db as unknown as { serviceDataTimer: ReturnType<typeof setTimeout> | null }).serviceDataTimer
      if (timer) clearTimeout(timer)
      const c = await db.chat.createConversation('owner')
      let count = 0
      let legacyBytes = 0
      await sql.transaction(async () => {
        const lines = createInterface({ input: createReadStream(process.env.VC_SERVICE_DATA_BENCHMARK!), crlfDelay: Infinity })
        for await (const line of lines) {
          if (!line.trim()) continue
          const row = JSON.parse(line)
          const rawMeta = typeof row.meta === 'string' ? row.meta : JSON.stringify(row.meta)
          legacyBytes += Buffer.byteLength(rawMeta ?? '')
          await sql.run('INSERT INTO messages (id, conversation_id, role, text, time, created_at, engine, meta, exec_target, attachments, state, history_position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [row.id, c.id, row.role, row.text, row.time, row.created_at, row.engine, rawMeta, row.exec_target, row.attachments, row.state, row.history_position])
          count++
        }
      })
      const oldStart = performance.now()
      const legacy = await sql.all<{ meta: string | null }>('SELECT * FROM messages WHERE conversation_id = ?', [c.id])
      for (const row of legacy) if (row.meta) JSON.parse(row.meta)
      const oldMs = performance.now() - oldStart
      const fallbackStart = performance.now()
      expect(await db.chat.listMessages('owner', c.id)).toHaveLength(count)
      const fallbackMs = performance.now() - fallbackStart
      while (await db.chat.migrateMessageServiceDataBatch()) { /* bounded transactions */ }
      const start = performance.now()
      const messages = await db.chat.listMessages('owner', c.id)
      const elapsedMs = performance.now() - start
      const bytes = Buffer.byteLength(JSON.stringify(messages))
      expect(messages).toHaveLength(count)
      expect(messages.every(message => !message.meta?.activity && !message.meta?.request)).toBe(true)
      expect(elapsedMs).toBeLessThan(5000)
      expect(bytes).toBeLessThan(legacyBytes / 10)
      console.info('service-data benchmark', { engine, count, legacyBytes, oldMs, fallbackMs, elapsedMs, bytes })
    }, 120_000)

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

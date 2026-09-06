// Сквозной тест среза: ход TurnManager через фейкового исполнителя на 127.0.0.1
// должен дать РОВНО те же события, что ход через локальный spawn — turns.ts и
// парсеры shared про транспорт не знают.

import { describe, it, expect, vi } from 'vitest'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ServerMessage } from '@voicechat/shared'
import { createTurnManager } from '../turns.js'
import { VoiceChatDb } from '../db/database.js'
import { ClaudeCli, type SpawnFn } from '../claude/claudeCli.js'
import type { LlmClient } from '../claude/types.js'
import { RemoteLlmClient } from './remoteClient.js'
import type { RunnerRunBody } from './protocol.js'

const U = 'admin'

const LINES = [
  JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'sonnet' }),
  JSON.stringify({
    type: 'stream_event',
    event: { type: 'message_start', message: { id: 'm1', usage: { input_tokens: 10 } } }
  }),
  JSON.stringify({
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Готово' } }
  }),
  JSON.stringify({
    type: 'stream_event',
    event: { type: 'message_delta', usage: { output_tokens: 2 } }
  }),
  JSON.stringify({
    type: 'result',
    is_error: false,
    result: 'Готово',
    session_id: 's1',
    duration_ms: 42,
    usage: { input_tokens: 10, output_tokens: 2 }
  })
]

/** Фейковый исполнитель: отдаёт строки stdout конвертами NDJSON. */
async function startRunner(
  handle: (res: ServerResponse, body: RunnerRunBody, req: IncomingMessage) => void
): Promise<{ url: string; posts: RunnerRunBody[]; deletes: string[]; close(): Promise<void> }> {
  const posts: RunnerRunBody[] = []
  const deletes: string[] = []
  const server = createServer((req, res) => {
    if (req.method === 'DELETE') {
      deletes.push(req.url ?? '')
      res.writeHead(204).end()
      return
    }
    let raw = ''
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString()
    })
    req.on('end', () => {
      const body = JSON.parse(raw) as RunnerRunBody
      posts.push(body)
      handle(res, body, req)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    posts,
    deletes,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}

/** Локальный CLI на фейковом процессе: печатает те же строки и выходит с 0. */
function localClaude(lines: string[]): LlmClient {
  const spawn: SpawnFn = vi.fn(() => {
    const stdout = new PassThrough()
    const child = Object.assign(new EventEmitter(), {
      stdout,
      stderr: new PassThrough(),
      stdin: new PassThrough(),
      kill: vi.fn()
    })
    setImmediate(() => {
      for (const line of lines) stdout.write(`${line}\n`)
      stdout.end()
      setImmediate(() => child.emit('close', 0))
    })
    return child as never
  })
  return new ClaudeCli({ spawn })
}

/** Ход в свежей БД: возвращает поток событий хода до claude.done/claude.error. */
async function turnEvents(client: LlmClient): Promise<ServerMessage[]> {
  const db = new VoiceChatDb(':memory:')
  db.identity.createUser(U, '', 'admin')
  const conv = db.chat.createConversation(U, 'Чат')
  // В реальном потоке клиент сохраняет реплику пользователя до claude.send,
  // и TurnManager для нового разговора собирает prompt именно из истории БД.
  db.chat.addMessage(U, conv.id, 'u1', 'привет', '10:00')
  const turns = createTurnManager({ db, claude: client })
  const events: ServerMessage[] = []
  await new Promise<void>((resolve) => {
    const off = turns.subscribe((m) => {
      events.push(m)
      if (m.t === 'claude.done' || m.t === 'claude.error') {
        off()
        resolve()
      }
    })
    void turns.start({ userId: U, conversationId: conv.id, segments: [{ speakerId: 1, text: 'привет' }] })
  })
  db.close()
  return events
}

/**
 * У двух прогонов свои БД и свои стенные часы: id разговора, id сохранённого
 * сообщения и метки времени записей активности совпасть не могут. Сравниваем всё
 * остальное — тексты, счётчики, метаданные хода.
 */
function normalize(events: ServerMessage[]): unknown[] {
  return events.map((m) => {
    const copy: Record<string, unknown> = { ...m, conversationId: '<conv>' }
    delete copy.message
    const meta = copy.meta as { activity?: Array<Record<string, unknown>> } | undefined
    if (meta?.activity) {
      copy.meta = { ...meta, activity: meta.activity.map((entry) => ({ ...entry, ts: 0 })) }
    }
    return copy
  })
}

describe('ход модели через исполнителя по HTTP', () => {
  it('события совпадают с локальным spawn', async () => {
    const runner = await startRunner((res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      for (const s of LINES) res.write(`${JSON.stringify({ t: 'out', s })}\n`)
      res.end(`${JSON.stringify({ t: 'exit', code: 0 })}\n`)
    })
    try {
      const remote = await turnEvents(
        new RemoteLlmClient({ kind: 'claude', baseUrl: runner.url })
      )
      const local = await turnEvents(localClaude(LINES))
      expect(normalize(remote)).toEqual(normalize(local))
      expect(remote.map((m) => m.t)).toEqual([
        'claude.start',
        'claude.usage',
        'claude.token',
        'claude.usage',
        'claude.done'
      ])
      const done = remote.at(-1) as Extract<ServerMessage, { t: 'claude.done' }>
      expect(done.text).toBe('Готово')
      expect(done.meta?.inputTokens).toBe(10)
      // Промпт ушёл исполнителю, а не в spawn.
      expect(runner.posts[0].prompt).toContain('привет')
    } finally {
      await runner.close()
    }
  })

  it('отмена хода доходит до DELETE /v1/run/:id', async () => {
    const runner = await startRunner((res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      // Ход «идёт»: одна строка и тишина — закрывает его отмена.
      res.write(`${JSON.stringify({ t: 'out', s: LINES[0] })}\n`)
    })
    try {
      const db = new VoiceChatDb(':memory:')
      db.identity.createUser(U, '', 'admin')
      const conv = db.chat.createConversation(U, 'Чат')
      const turns = createTurnManager({
        db,
        claude: new RemoteLlmClient({ kind: 'claude', baseUrl: runner.url })
      })
      await turns.start({
        userId: U,
        conversationId: conv.id,
        segments: [{ speakerId: 1, text: 'привет' }]
      })
      // Ждём, пока исполнитель получит ран (иначе отменять ещё нечего).
      while (!runner.posts.length) await new Promise((r) => setImmediate(r))

      turns.cancel(conv.id)
      while (!runner.deletes.length) await new Promise((r) => setTimeout(r, 5))
      expect(runner.deletes[0]).toBe(`/v1/run/${runner.posts[0].runId}`)
      expect(turns.active(U)).toHaveLength(0)
    } finally {
      await runner.close()
    }
  })
})

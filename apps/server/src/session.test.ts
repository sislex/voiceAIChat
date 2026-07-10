import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { buildServer } from './server.js'
import { loadConfig } from './config.js'
import { VoiceChatDb } from './db/database.js'
import type { LlmClient } from './claude/types.js'

// Мок LLM: сразу отдаёт session, две дельты и финал.
const mockClaude: LlmClient = {
  send(_req, h) {
    h.onSession('sess-xyz')
    h.onDelta('При')
    h.onDelta('вет')
    h.onDone('Привет')
    return { cancel: () => {} }
  }
}

let app: FastifyInstance
let db: VoiceChatDb
let port: number

beforeEach(async () => {
  db = new VoiceChatDb(':memory:')
  app = await buildServer({ config: loadConfig({ PORT: '0' }), db, claude: mockClaude })
  await app.listen({ port: 0, host: '127.0.0.1' })
  port = (app.server.address() as AddressInfo).port
})
afterEach(async () => {
  await app.close()
  db.close()
})

function connect(): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
  return new Promise((res, rej) => {
    ws.on('open', () => res(ws))
    ws.on('error', rej)
  })
}

describe('WS: Claude-стрим', () => {
  it('claude.send → token×2 + done; session-id сохранён в БД', async () => {
    const conv = db.createConversation('Чат')
    const ws = await connect()
    const events: unknown[] = []
    const done = new Promise<void>((resolve) => {
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString())
        events.push(m)
        if (m.t === 'claude.done') resolve()
      })
    })
    ws.send(JSON.stringify({ t: 'claude.send', conversationId: conv.id, segments: [{ speakerId: 1, text: 'привет' }] }))
    await done
    ws.close()

    const tokens = events.filter((e) => (e as { t: string }).t === 'claude.token')
    expect(tokens).toHaveLength(2)
    const doneMsg = events.find((e) => (e as { t: string }).t === 'claude.done') as { text: string }
    expect(doneMsg.text).toBe('Привет')
    // session-id записан
    expect(db.getConversation(conv.id)?.claudeSessionId).toBe('sess-xyz')
  })
})

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
    h.onActivity?.({ kind: 'tool_use', summary: 'Bash: npm test', raw: '{}' })
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
    // session-id записан с префиксом провайдера
    expect(db.getConversation(conv.id)?.claudeSessionId).toBe('claude:sess-xyz')
    // без verbose активность НЕ шлётся
    expect(events.some((e) => (e as { t: string }).t === 'claude.log')).toBe(false)
  })

  it('claude.send с verbose → приходит claude.log', async () => {
    const conv = db.createConversation('Чат')
    const ws = await connect()
    const logs: unknown[] = []
    const done = new Promise<void>((resolve) => {
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString())
        if (m.t === 'claude.log') logs.push(m)
        if (m.t === 'claude.done') resolve()
      })
    })
    ws.send(
      JSON.stringify({
        t: 'claude.send',
        conversationId: conv.id,
        segments: [{ speakerId: 1, text: 'привет' }],
        verbose: true
      })
    )
    await done
    ws.close()
    expect(logs).toHaveLength(1)
    expect((logs[0] as { entry: { summary: string } }).entry.summary).toBe('Bash: npm test')
  })
})

describe('WS: выбор движка Codex', () => {
  it('llmProvider=codex → используется codex-клиент; session-id с префиксом codex', async () => {
    const cdb = new VoiceChatDb(':memory:')
    cdb.saveSettings({ ...cdb.getSettings(), llmProvider: 'codex', codexModel: 'gpt-5-codex' })
    const mockCodex: LlmClient = {
      send(req, h) {
        // модель берётся из codexModel
        h.onSession(`thread-${req.model}`)
        h.onDone('Ответ Codex')
        return { cancel: () => {} }
      }
    }
    const capp = await buildServer({
      config: loadConfig({ PORT: '0' }),
      db: cdb,
      claude: mockClaude,
      codex: mockCodex
    })
    await capp.listen({ port: 0, host: '127.0.0.1' })
    const cport = (capp.server.address() as AddressInfo).port
    const conv = cdb.createConversation('Чат')
    const ws = new WebSocket(`ws://127.0.0.1:${cport}/ws`)
    await new Promise((r) => ws.on('open', r as () => void))
    const done = new Promise<{ text: string }>((resolve) => {
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString())
        if (m.t === 'claude.done') resolve(m)
      })
    })
    ws.send(JSON.stringify({ t: 'claude.send', conversationId: conv.id, segments: [{ speakerId: 1, text: 'привет' }] }))
    const doneMsg = await done
    ws.close()
    expect(doneMsg.text).toBe('Ответ Codex')
    // session-id сохранён с префиксом codex и моделью из codexModel
    expect(cdb.getConversation(conv.id)?.claudeSessionId).toBe('codex:thread-gpt-5-codex')
    await capp.close()
    cdb.close()
  })
})

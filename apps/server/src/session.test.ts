import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { buildServer } from './server.js'
import { loadConfig } from './config.js'
import { VoiceChatDb } from './db/database.js'
import { signToken } from './users/accounts.js'
import type { LlmClient } from './claude/types.js'
import { createKbUsageTracker } from './kb/usage.js'
import { PreviewActionRelay } from './mcp/previewMcp.js'

const SECRET = 'test-secret'
const U = 'admin'
const TOKEN = signToken({ name: U, role: 'admin' }, SECRET)

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
  app = await buildServer({
    config: loadConfig({ PORT: '0' }),
    db,
    claude: mockClaude,
    sessionSecret: SECRET
  })
  await app.listen({ port: 0, host: '127.0.0.1' })
  port = (app.server.address() as AddressInfo).port
})
afterEach(async () => {
  await app.close()
  db.close()
})

/** Подключение WS с токеном сессии в query. */
function connect(p = port, token = TOKEN): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${p}/ws?token=${token}`)
  return new Promise((res, rej) => {
    ws.on('open', () => res(ws))
    ws.on('error', rej)
  })
}

describe('WS: аутентификация соединения', () => {
  it('без токена сервер закрывает соединение', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    // Сокет может кратко открыться и тут же закрыться — ждём именно close.
    let opened = false
    const result = await new Promise<'closed' | 'stayed'>((resolve) => {
      ws.on('open', () => {
        opened = true
      })
      ws.on('close', () => resolve('closed'))
      setTimeout(() => resolve(opened ? 'stayed' : 'closed'), 800)
    })
    expect(result).toBe('closed')
    ws.close()
  })
})

describe('WS: Claude-стрим', () => {
  it('claude.send → token×2 + done; session-id сохранён в БД', async () => {
    const conv = db.createConversation(U, 'Чат')
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
    const doneMsg = events.find((e) => (e as { t: string }).t === 'claude.done') as {
      text: string
      message?: { meta?: { activity?: { summary: string }[] } }
    }
    expect(doneMsg.text).toBe('Привет')
    // session-id записан с префиксом провайдера
    expect(db.getConversation(U, conv.id)?.claudeSessionId).toBe('claude:sess-xyz')
    // без verbose активность НЕ шлётся в глобальную консоль (событие claude.log)…
    expect(events.some((e) => (e as { t: string }).t === 'claude.log')).toBe(false)
    // …но собирается всегда и персистится в meta сохранённого сообщения (для подробного вида)
    expect(doneMsg.message?.meta?.activity?.map((a) => a.summary)).toEqual(['Bash: npm test'])
  })

  it('claude.send с verbose → приходит claude.log', async () => {
    const conv = db.createConversation(U, 'Чат')
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

describe('WS /agent: смена политики с машины', () => {
  it('agent.setPolicy сохраняется в БД владельца', async () => {
    const created = db.createAgent('admin', 'Box') // admin засеян buildServer
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent`)
    await new Promise((r) => ws.on('open', r as () => void))
    const registered = new Promise<void>((res) => {
      ws.on('message', (d) => {
        if (JSON.parse(d.toString()).t === 'agent.registered') res()
      })
    })
    ws.send(JSON.stringify({ t: 'agent.register', token: created.token, version: '0.2.0' }))
    await registered
    ws.send(
      JSON.stringify({
        t: 'agent.setPolicy',
        policy: {
          allowedDirs: [],
          allowNetwork: true,
          allowWrite: false,
          denyPatterns: [],
          allowPatterns: [],
          skills: []
        }
      })
    )
    // Ждём применения (сообщение обрабатывается асинхронно).
    for (let i = 0; i < 20 && db.listAgents('admin')[0]?.policy.allowWrite !== false; i++) {
      await new Promise((r) => setTimeout(r, 25))
    }
    expect(db.listAgents('admin')[0].policy.allowWrite).toBe(false)
    ws.close()
  })
})

describe('WS: роль user не выполняет на сервере (форс plan)', () => {
  // Мок, возвращающий полученный permissionMode — проверяем клампинг по роли.
  const echoPerm: LlmClient = {
    send(req, h) {
      h.onDone(`perm:${req.permissionMode ?? 'none'}`)
      return { cancel: () => {} }
    }
  }

  async function permForRole(role: 'admin' | 'user', convMode?: 'plan' | 'acceptEdits' | 'bypassPermissions'): Promise<string> {
    const rdb = new VoiceChatDb(':memory:')
    const rapp = await buildServer({
      config: loadConfig({ PORT: '0' }),
      db: rdb,
      claude: echoPerm,
      sessionSecret: SECRET
    })
    await rapp.listen({ port: 0, host: '127.0.0.1' })
    const rport = (rapp.server.address() as AddressInfo).port
    if (role === 'user') rdb.createUser('user', '', 'user') // admin засеян buildServer'ом
    const conv = rdb.createConversation(role, 'Чат')
    if (convMode) rdb.setConversationExecTarget(role, conv.id, null, undefined, undefined, undefined, undefined, convMode)
    const ws = await connect(rport, signToken({ name: role, role }, SECRET))
    const done = new Promise<string>((resolve) => {
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString())
        if (m.t === 'claude.done') resolve(m.text)
      })
    })
    ws.send(JSON.stringify({ t: 'claude.send', conversationId: conv.id, segments: [{ speakerId: 1, text: 'привет' }] }))
    const text = await done
    ws.close()
    await rapp.close()
    rdb.close()
    return text
  }

  it('user на сервере → permissionMode форсится в plan', async () => {
    expect(await permForRole('user')).toBe('perm:plan')
  })

  it('admin на сервере → permissionMode из настроек (не клампится)', async () => {
    // Дефолтный permissionMode — bypassPermissions.
    expect(await permForRole('admin')).toBe('perm:bypassPermissions')
  })

  it('permissionMode разговора переопределяет общие настройки', async () => {
    expect(await permForRole('admin', 'plan')).toBe('perm:plan')
  })

  it('переопределение разговора не даёт роли user обойти форс plan на сервере', async () => {
    expect(await permForRole('user', 'bypassPermissions')).toBe('perm:plan')
  })
})

describe('WS: блок STT/TTS при нехватке ресурсов контейнера', () => {
  // Завышаем порог памяти через env → capabilities помечает STT/TTS недоступными,
  // и сервер обязан жёстко отклонять audio.start / tts.speak с ошибкой.
  async function buildBlocked(): Promise<{ bapp: FastifyInstance; bdb: VoiceChatDb; bport: number }> {
    const bdb = new VoiceChatDb(':memory:')
    const bapp = await buildServer({
      config: loadConfig({ PORT: '0', VC_MIN_MEM_STT: '999999999999', VC_MIN_MEM_TTS: '999999999999' }),
      db: bdb,
      claude: mockClaude,
      sessionSecret: SECRET
    })
    await bapp.listen({ port: 0, host: '127.0.0.1' })
    const bport = (bapp.server.address() as AddressInfo).port
    return { bapp, bdb, bport }
  }

  it('audio.start → stt.error (распознавание не запускается)', async () => {
    const { bapp, bdb, bport } = await buildBlocked()
    const ws = await connect(bport)
    const err = new Promise<{ t: string; message: string }>((resolve) => {
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString())
        if (m.t === 'stt.error') resolve(m)
      })
    })
    ws.send(JSON.stringify({ t: 'audio.start', sampleRate: 16000 }))
    const m = await err
    expect(m.message).toContain('распознавания')
    ws.close()
    await bapp.close()
    bdb.close()
  })

  it('tts.speak → tts.error (озвучка не запускается)', async () => {
    const { bapp, bdb, bport } = await buildBlocked()
    const ws = await connect(bport)
    const err = new Promise<{ t: string; message: string }>((resolve) => {
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString())
        if (m.t === 'tts.error') resolve(m)
      })
    })
    ws.send(JSON.stringify({ t: 'tts.speak', text: 'привет', voice: '' }))
    const m = await err
    expect(m.message).toContain('озвучки')
    ws.close()
    await bapp.close()
    bdb.close()
  })

  it('GET /api/system/capabilities отражает блок', async () => {
    const { bapp, bdb } = await buildBlocked()
    const res = await bapp.inject({
      method: 'GET',
      url: '/api/system/capabilities',
      headers: { authorization: `Bearer ${TOKEN}` }
    })
    const cap = res.json()
    expect(cap.stt.available).toBe(false)
    expect(cap.tts.available).toBe(false)
    await bapp.close()
    bdb.close()
  })
})

describe('WS: выбор движка Codex', () => {
  it('llmProvider=codex → используется codex-клиент; session-id с префиксом codex', async () => {
    const cdb = new VoiceChatDb(':memory:')
    cdb.saveSettings(U, { ...cdb.getSettings(U), llmProvider: 'codex', codexModel: 'gpt-5-codex' })
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
      codex: mockCodex,
      sessionSecret: SECRET
    })
    await capp.listen({ port: 0, host: '127.0.0.1' })
    const cport = (capp.server.address() as AddressInfo).port
    const conv = cdb.createConversation(U, 'Чат')
    const ws = await connect(cport)
    const done = new Promise<{ text: string; engine?: string }>((resolve) => {
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString())
        if (m.t === 'claude.done') resolve(m)
      })
    })
    ws.send(JSON.stringify({ t: 'claude.send', conversationId: conv.id, segments: [{ speakerId: 1, text: 'привет' }] }))
    const doneMsg = await done
    ws.close()
    expect(doneMsg.text).toBe('Ответ Codex')
    // движок ответа запечён в событие claude.done
    expect(doneMsg.engine).toBe('codex')
    // session-id сохранён с префиксом codex и моделью из codexModel
    expect(cdb.getConversation(U, conv.id)?.claudeSessionId).toBe('codex:thread-gpt-5-codex')
    await capp.close()
    cdb.close()
  })
})

describe('WS: ходы переживают обрыв соединения (TurnManager)', () => {
  // Медленный мок: дельты и финал приходят по таймерам — можно оборвать WS посреди хода.
  function makeSlowClaude(deltas: string[], finalText: string, doneAfterMs: number): LlmClient {
    return {
      send(_req, h) {
        h.onSession('sess-slow')
        let at = 5
        for (const d of deltas) {
          setTimeout(() => h.onDelta(d), at)
          at += 5
        }
        const timer = setTimeout(() => h.onDone(finalText), doneAfterMs)
        return { cancel: () => clearTimeout(timer) }
      }
    }
  }

  async function buildSlow(claude: LlmClient): Promise<{
    sapp: FastifyInstance
    sdb: VoiceChatDb
    sport: number
  }> {
    const sdb = new VoiceChatDb(':memory:')
    const sapp = await buildServer({
      config: loadConfig({ PORT: '0' }),
      db: sdb,
      claude,
      sessionSecret: SECRET
    })
    await sapp.listen({ port: 0, host: '127.0.0.1' })
    const sport = (sapp.server.address() as AddressInfo).port
    return { sapp, sdb, sport }
  }

  function connectTo(sport: number): Promise<WebSocket> {
    const ws = new WebSocket(`ws://127.0.0.1:${sport}/ws?token=${TOKEN}`)
    return new Promise((res, rej) => {
      ws.on('open', () => res(ws))
      ws.on('error', rej)
    })
  }

  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  it('обрыв WS не отменяет ход: ответ сохраняет в БД сам сервер', async () => {
    const { sapp, sdb, sport } = await buildSlow(makeSlowClaude(['Ча', 'сть'], 'Часть ответа', 60))
    const conv = sdb.createConversation(U, 'Чат')
    const ws = await connectTo(sport)
    ws.send(
      JSON.stringify({
        t: 'claude.send',
        conversationId: conv.id,
        segments: [{ speakerId: 1, text: 'привет' }]
      })
    )
    await wait(20)
    ws.close() // «обновление страницы» посреди генерации
    await wait(90)

    const saved = sdb.listMessages(U, conv.id).filter((m) => m.role === 'ai')
    expect(saved).toHaveLength(1)
    expect(saved[0].text).toBe('Часть ответа')
    expect(saved[0].engine).toBe('claude')
    expect(saved[0].meta?.request?.provider).toBe('claude')
    await sapp.close()
    sdb.close()
  })

  it('новое подключение получает claude.active с накопленным текстом, а затем done с сообщением из БД', async () => {
    const { sapp, sdb, sport } = await buildSlow(makeSlowClaude(['Ча', 'сть'], 'Часть ответа', 80))
    const conv = sdb.createConversation(U, 'Чат')
    const ws1 = await connectTo(sport)
    // Ждём сами дельты, а не фиксированную паузу: под нагрузкой (полный прогон
    // сюиты) вторая не успевала за 25 мс и в накопленном тексте была одна «Ча».
    const streamed = new Promise<void>((resolve) => {
      let text = ''
      ws1.on('message', (d) => {
        const m = JSON.parse(d.toString())
        if (m.t === 'claude.token') text += m.delta
        if (text === 'Часть') resolve()
      })
    })
    ws1.send(
      JSON.stringify({
        t: 'claude.send',
        conversationId: conv.id,
        segments: [{ speakerId: 1, text: 'привет' }]
      })
    )
    await streamed
    ws1.close()

    // Второй клиент («страница после обновления»); слушатель вешаем ДО open,
    // чтобы не потерять claude.active, который сервер шлёт сразу при подключении.
    const ws2 = new WebSocket(`ws://127.0.0.1:${sport}/ws?token=${TOKEN}`)
    const events: Array<{ t: string } & Record<string, unknown>> = []
    const done = new Promise<void>((resolve) => {
      ws2.on('message', (d) => {
        const m = JSON.parse(d.toString())
        events.push(m)
        if (m.t === 'claude.done') resolve()
      })
    })
    await done
    ws2.close()

    const active = events.find((e) => e.t === 'claude.active') as unknown as {
      turns: Array<{ conversationId: string; partial: string }>
    }
    expect(active).toBeDefined()
    expect(active.turns).toHaveLength(1)
    expect(active.turns[0].conversationId).toBe(conv.id)
    expect(active.turns[0].partial).toBe('Часть')

    // done несёт сохранённое сервером сообщение — оно же лежит в БД.
    const doneMsg = events.find((e) => e.t === 'claude.done') as unknown as {
      text: string
      message?: { id: string; text: string; role: string }
    }
    expect(doneMsg.text).toBe('Часть ответа')
    expect(doneMsg.message?.role).toBe('ai')
    const saved = sdb.listMessages(U, conv.id).filter((m) => m.role === 'ai')
    expect(saved).toHaveLength(1)
    expect(doneMsg.message?.id).toBe(saved[0].id)
    await sapp.close()
    sdb.close()
  })

  it('claude.cancel с conversationId снимает ход: ничего не сохраняется, приходит пустой done', async () => {
    const { sapp, sdb, sport } = await buildSlow(makeSlowClaude(['Ча'], 'Часть ответа', 60))
    const conv = sdb.createConversation(U, 'Чат')
    const ws = await connectTo(sport)
    const events: Array<{ t: string; text?: string }> = []
    const emptyDone = new Promise<void>((resolve) => {
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString())
        events.push(m)
        if (m.t === 'claude.done' && m.text === '') resolve()
      })
    })
    ws.send(
      JSON.stringify({
        t: 'claude.send',
        conversationId: conv.id,
        segments: [{ speakerId: 1, text: 'привет' }]
      })
    )
    await wait(15)
    ws.send(JSON.stringify({ t: 'claude.cancel', conversationId: conv.id }))
    await emptyDone
    await wait(80) // финал мока уже не должен ничего записать
    expect(sdb.listMessages(U, conv.id).filter((m) => m.role === 'ai')).toHaveLength(0)
    ws.close()
    await sapp.close()
    sdb.close()
  })
})

describe('WS: relay действий веб-превью', () => {
  it('preview.action доходит только своему пользователю, preview.result закрывает запрос', async () => {
    await app.close()
    const relay = new PreviewActionRelay()
    app = await buildServer({ config: loadConfig({ PORT: '0' }), db, claude: mockClaude, sessionSecret: SECRET, previewRelay: relay })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const p2 = (app.server.address() as AddressInfo).port
    db.createUser('bob', '', 'user')

    const mine = await connect(p2)
    const other = await connect(p2, signToken({ name: 'bob', role: 'user' }, SECRET))
    const otherFrames: Array<{ t: string }> = []
    other.on('message', (d) => otherFrames.push(JSON.parse(d.toString())))
    // Клиент-автоответчик: получил preview.action — вернул результат чтения.
    mine.on('message', (d) => {
      const frame = JSON.parse(d.toString()) as { t: string; requestId?: string }
      if (frame.t !== 'preview.action') return
      mine.send(JSON.stringify({ t: 'preview.result', requestId: frame.requestId, ok: true, result: { url: 'https://shop.example' } }))
    })

    const outcome = await relay.request(U, 'conv-1', { kind: 'open', url: 'https://shop.example' }, 3_000)
    expect(outcome).toEqual({ ok: true, result: { url: 'https://shop.example' } })
    await new Promise((r) => setTimeout(r, 100))
    expect(otherFrames.some((f) => f.t === 'preview.action')).toBe(false)
    mine.close()
    other.close()
  })
})

describe('WS: кадры использования базы знаний', () => {
  it('kb.usage доходит только своему пользователю', async () => {
    // Свой сервер с инжектированным трекером: обращения к БЗ в этом тесте
    // создаём напрямую, а проверяем именно маршрутизацию кадров по владельцу.
    await app.close()
    const tracker = createKbUsageTracker({ db })
    app = await buildServer({ config: loadConfig({ PORT: '0' }), db, claude: mockClaude, sessionSecret: SECRET, kbUsage: tracker })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const p2 = (app.server.address() as AddressInfo).port
    db.createUser('bob', '', 'user')
    const conv = db.createConversation(U, 'Чат')

    const mine = await connect(p2)
    const other = await connect(p2, signToken({ name: 'bob', role: 'user' }, SECRET))
    const mineFrames: Array<{ t: string; query?: { status: string; chars: number } }> = []
    const otherFrames: Array<{ t: string }> = []
    mine.on('message', (d) => mineFrames.push(JSON.parse(d.toString())))
    other.on('message', (d) => otherFrames.push(JSON.parse(d.toString())))

    tracker.begin({ userId: U, conversationId: conv.id, source: 'tool_search' }, 'ws').complete({ deliveredChars: 42 })
    await new Promise((r) => setTimeout(r, 200))
    mine.close()
    other.close()

    const usage = mineFrames.filter((f) => f.t === 'kb.usage')
    expect(usage).toHaveLength(2) // pending + delivered
    expect(usage[0].query?.status).toBe('pending')
    expect(usage[1].query).toMatchObject({ status: 'delivered', chars: 42 })
    expect(otherFrames.some((f) => f.t === 'kb.usage')).toBe(false)
  })
})

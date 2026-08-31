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
import { AuthStatusState } from './auth/statusState.js'

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
let authStatus: AuthStatusState
let sentMail: { to: string; text: string }[]

beforeEach(async () => {
  db = new VoiceChatDb(':memory:')
  sentMail = []
  authStatus = new AuthStatusState(async () => ({
    claude: { provider: 'claude', loggedIn: true, detail: 'подтверждено' },
    codex: { provider: 'codex', loggedIn: false, detail: 'вход не выполнен' }
  }))
  app = await buildServer({
    config: loadConfig({ PORT: '0' }),
    db,
    claude: mockClaude,
    authStatus,
    sessionSecret: SECRET,
    mailer: { configured: true, send: async (message) => { sentMail.push({ to: message.to, text: message.text }) } }
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
    // На загруженной машине соединение может не успеть установиться за 800 мс.
    // `close()` по такому сокету бросает «WebSocket was closed before the
    // connection was established», и vitest считает это ошибкой всего прогона;
    // `terminate()` безопасен в любом состоянии, а пустой обработчик error
    // гасит гонку «сервер разорвал соединение уже после нашего решения».
    ws.on('error', () => {})
    ws.terminate()
  })
})

describe('WS: живые изменения списка сессий', () => {
  /** Собирает кадры сессий, пришедшие на соединение. */
  const collect = (ws: WebSocket): Array<Record<string, unknown>> => {
    const frames: Array<Record<string, unknown>> = []
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString()) as Record<string, unknown>
      if (message.t === 'sessions.update' || message.t === 'session.revoked') frames.push(message)
    })
    return frames
  }
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

  it('отзыв своей сессии доезжает адресно, соседняя получает только инвалидацию', async () => {
    db.createUser('wsuser', 'ws-user-pass-2026', 'developer')
    const login = async (ua: string): Promise<string> =>
      (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'wsuser', password: 'ws-user-pass-2026' }, headers: { 'user-agent': ua } })).json().token as string
    const victimToken = await login('Phone/1.0')
    const observerToken = await login('Laptop/2.0')
    const victim = await connect(port, victimToken)
    const observer = await connect(port, observerToken)
    const victimFrames = collect(victim)
    const observerFrames = collect(observer)

    const victimSid = db.listSessions('wsuser').find((s) => s.userAgent === 'Phone/1.0')!.sid
    await app.inject({ method: 'DELETE', url: `/api/session/${victimSid}`, headers: { authorization: `Bearer ${observerToken}` } })
    await settle()

    expect(victimFrames).toEqual([{ t: 'session.revoked', v: 1, sid: victimSid }])
    expect(observerFrames).toEqual([{ t: 'sessions.update', v: 1 }])
    victim.close()
    observer.close()
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('«выйти везде» адресно гасит каждую убитую вкладку', async () => {
    db.createUser('bulk', 'bulk-user-pass-2026', 'developer')
    const login = async (ua: string): Promise<string> =>
      (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'bulk', password: 'bulk-user-pass-2026' }, headers: { 'user-agent': ua } })).json().token as string
    const phoneToken = await login('Phone/1.0')
    const laptopToken = await login('Laptop/2.0')
    const phone = await connect(port, phoneToken)
    const laptop = await connect(port, laptopToken)
    const phoneFrames = collect(phone)
    const laptopFrames = collect(laptop)
    const phoneSid = db.listSessions('bulk').find((s) => s.userAgent === 'Phone/1.0')!.sid

    // «Выйти на других» с ноутбука: телефон мёртв и должен узнать это сразу.
    await app.inject({ method: 'POST', url: '/api/session/logout-all', headers: { authorization: `Bearer ${laptopToken}` } })
    await settle()
    expect(phoneFrames).toEqual([{ t: 'session.revoked', v: 1, sid: phoneSid }])
    // Оставшемуся ноутбуку тот же кадр приходит как обычная инвалидация списка.
    expect(laptopFrames).toEqual([{ t: 'sessions.update', v: 1 }])
    phone.close()
    laptop.close()
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('чужому пользователю кадры не приходят', async () => {
    db.createUser('mine', 'mine-user-pass-2026', 'developer')
    db.createUser('other', 'other-user-pass-2026', 'developer')
    const mineToken = (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'mine', password: 'mine-user-pass-2026' } })).json().token as string
    const otherToken = (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'other', password: 'other-user-pass-2026' } })).json().token as string
    const otherWs = await connect(port, otherToken)
    const otherFrames = collect(otherWs)
    await app.inject({ method: 'POST', url: '/api/session/logout-all', payload: { includeCurrent: true }, headers: { authorization: `Bearer ${mineToken}` } })
    await settle()
    expect(otherFrames).toEqual([])
    otherWs.close()
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('переименование и админский отзыв тоже обновляют список живьём', async () => {
    db.createUser('renamer', 'renamer-pass-2026-ok', 'developer')
    const token = (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'renamer', password: 'renamer-pass-2026-ok' } })).json().token as string
    const ws = await connect(port, token)
    const frames = collect(ws)
    const sid = db.listSessions('renamer')[0]!.sid
    await app.inject({ method: 'PATCH', url: `/api/session/${sid}`, payload: { label: 'Ноут' }, headers: { authorization: `Bearer ${token}` } })
    await settle()
    expect(frames).toEqual([{ t: 'sessions.update', v: 1 }])
    // Отзыв администратором приходит владельцу так же адресно, как свой.
    await app.inject({ method: 'DELETE', url: `/api/admin/sessions/${sid}`, headers: { authorization: `Bearer ${TOKEN}` } })
    await settle()
    expect(frames.at(-1)).toEqual({ t: 'session.revoked', v: 1, sid })
    ws.close()
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })
})

describe('WS: auth status', () => {
  it('шлёт полный снимок при каждом подключении и только содержательные обновления', async () => {
    const connectWithAuth = (): Promise<{ ws: WebSocket; message: any }> => new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${TOKEN}`)
      ws.on('error', reject)
      ws.on('message', (data) => {
        const message = JSON.parse(data.toString())
        if (message.t === 'auth.status') resolve({ ws, message })
      })
    })
    const { ws: first, message: snapshot } = await connectWithAuth()
    expect(snapshot).toMatchObject({ t: 'auth.status', v: 1, status: { claude: { loggedIn: true }, codex: { loggedIn: false } } })
    let updates = 0
    first.on('message', (data) => { if (JSON.parse(data.toString()).t === 'auth.status') updates += 1 })
    authStatus.set(U, snapshot.status)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(updates).toBe(0)
    authStatus.reportRunError(U, 'claude', 'вход в Claude не выполнен')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(updates).toBe(1)
    first.close()

    const { ws: second, message: reconnectSnapshot } = await connectWithAuth()
    expect(reconnectSnapshot.status.claude.loggedIn).toBe(true)
    second.close()
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

  async function permForRole(role: 'admin' | 'developer', convMode?: 'plan' | 'acceptEdits' | 'bypassPermissions'): Promise<string> {
    const rdb = new VoiceChatDb(':memory:')
    const rapp = await buildServer({
      config: loadConfig({ PORT: '0' }),
      db: rdb,
      claude: echoPerm,
      sessionSecret: SECRET
    })
    await rapp.listen({ port: 0, host: '127.0.0.1' })
    const rport = (rapp.server.address() as AddressInfo).port
    if (role === 'developer') rdb.createUser('developer', '', 'developer') // admin засеян buildServer'ом
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
    expect(await permForRole('developer')).toBe('perm:plan')
  })

  it('admin на сервере → permissionMode из настроек (не клампится)', async () => {
    // Дефолтный permissionMode — bypassPermissions.
    expect(await permForRole('admin')).toBe('perm:bypassPermissions')
  })

  it('permissionMode разговора переопределяет общие настройки', async () => {
    expect(await permForRole('admin', 'plan')).toBe('perm:plan')
  })

  it('переопределение разговора не даёт роли user обойти форс plan на сервере', async () => {
    expect(await permForRole('developer', 'bypassPermissions')).toBe('perm:plan')
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
  const slowApps = new Set<FastifyInstance>()
  const slowDbs = new Set<VoiceChatDb>()
  const slowSockets = new Set<WebSocket>()

  afterEach(async () => {
    await Promise.all([...slowSockets].map(closeWs))
    slowSockets.clear()
    await Promise.all([...slowApps].map((server) => server.close()))
    slowApps.clear()
    for (const database of slowDbs) database.close()
    slowDbs.clear()
  })

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
    slowApps.add(sapp)
    slowDbs.add(sdb)
    return { sapp, sdb, sport }
  }

  function connectTo(sport: number): Promise<WebSocket> {
    const ws = new WebSocket(`ws://127.0.0.1:${sport}/ws?token=${TOKEN}`)
    return new Promise((res, rej) => {
      ws.on('open', () => {
        slowSockets.add(ws)
        res(ws)
      })
      ws.on('error', rej)
    })
  }

  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  /** close() только начинает handshake; session cleanup выполняется на событии close. */
  function closeWs(ws: WebSocket): Promise<void> {
    if (ws.readyState === WebSocket.CLOSED) return Promise.resolve()
    return new Promise((resolve) => {
      ws.once('close', resolve)
      if (ws.readyState === WebSocket.CONNECTING) ws.once('open', () => ws.close())
      else ws.close()
    })
  }

  async function cleanupSlow(sapp: FastifyInstance, sdb: VoiceChatDb, sockets: WebSocket[]): Promise<void> {
    await Promise.all(sockets.map(closeWs))
    for (const ws of sockets) slowSockets.delete(ws)
    await sapp.close()
    slowApps.delete(sapp)
    sdb.close()
    slowDbs.delete(sdb)
  }

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
    await closeWs(ws) // «обновление страницы» посреди генерации
    await wait(90)

    const saved = sdb.listMessages(U, conv.id).filter((m) => m.role === 'ai')
    expect(saved).toHaveLength(1)
    expect(saved[0].text).toBe('Часть ответа')
    expect(saved[0].engine).toBe('claude')
    expect(saved[0].meta?.request?.provider).toBe('claude')
    await cleanupSlow(sapp, sdb, [ws])
  })

  it('новое подключение получает claude.active с накопленным текстом, а затем done с сообщением из БД', async () => {
    let finish: (() => void) | undefined
    const controlledClaude: LlmClient = {
      send(_req, h) {
        h.onSession('sess-slow')
        setTimeout(() => h.onDelta('Ча'), 5)
        setTimeout(() => h.onDelta('сть'), 10)
        finish = () => h.onDone('Часть ответа')
        return { cancel: () => { finish = undefined } }
      }
    }
    const { sapp, sdb, sport } = await buildSlow(controlledClaude)
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
    await closeWs(ws1)
    slowSockets.delete(ws1)

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
    await new Promise<void>((resolve, reject) => {
      ws2.on('open', () => {
        slowSockets.add(ws2)
        resolve()
      })
      ws2.on('error', reject)
    })
    expect(finish).toBeDefined()
    finish?.()
    await done
    await closeWs(ws2)

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
    await cleanupSlow(sapp, sdb, [ws2])
  })

  it('claude.cancel с conversationId снимает ход: partial сохраняется как interrupted и поздний done игнорируется', async () => {
    const { sapp, sdb, sport } = await buildSlow(makeSlowClaude(['Ча'], 'Часть ответа', 60))
    const conv = sdb.createConversation(U, 'Чат')
    const ws = await connectTo(sport)
    const events: Array<{ t: string; text?: string }> = []
    let firstTokenResolve: (() => void) | undefined
    const firstToken = new Promise<void>((resolve) => { firstTokenResolve = resolve })
    const cancelledDone = new Promise<void>((resolve) => {
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString())
        events.push(m)
        if (m.t === 'claude.token') firstTokenResolve?.()
        if (m.t === 'claude.done') resolve()
      })
    })
    ws.send(
      JSON.stringify({
        t: 'claude.send',
        conversationId: conv.id,
        segments: [{ speakerId: 1, text: 'привет' }]
      })
    )
    await firstToken
    ws.send(JSON.stringify({ t: 'claude.cancel', conversationId: conv.id }))
    await cancelledDone
    await wait(80) // финал мока уже не должен записать второе сообщение
    const saved = sdb.listMessages(U, conv.id).filter((m) => m.role === 'ai')
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ text: 'Ча', meta: { interrupted: true } })
    expect(events.filter((event) => event.t === 'claude.done')).toHaveLength(1)
    await cleanupSlow(sapp, sdb, [ws])
  })
})

describe('WS: relay действий веб-превью', () => {
  it('preview.action доходит только своему пользователю, preview.result закрывает запрос', async () => {
    await app.close()
    const relay = new PreviewActionRelay()
    app = await buildServer({ config: loadConfig({ PORT: '0' }), db, claude: mockClaude, sessionSecret: SECRET, previewRelay: relay })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const p2 = (app.server.address() as AddressInfo).port
    db.createUser('bob', '', 'developer')

    const mine = await connect(p2)
    const other = await connect(p2, signToken({ name: 'bob', role: 'developer' }, SECRET))
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
    db.createUser('bob', '', 'developer')
    const conv = db.createConversation(U, 'Чат')

    const mine = await connect(p2)
    const other = await connect(p2, signToken({ name: 'bob', role: 'developer' }, SECRET))
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

describe('сброс пароля по подтверждённому email', () => {
  it('не раскрывает наличие адреса, шлёт ссылку и одноразово меняет пароль с отзывом сессий', async () => {
    db.createEmailVerification({ token: 'verify-reset-user', name: 'reset-user', email: 'reset@example.test', password: 'old-password-1', ttlMs: 60_000 })
    expect(db.redeemEmailVerification('verify-reset-user', 'developer')).not.toBeNull()

    const existing = await app.inject({ method: 'POST', url: '/api/session/reset/request', payload: { email: 'reset@example.test' } })
    const missing = await app.inject({ method: 'POST', url: '/api/session/reset/request', payload: { email: 'missing@example.test' } })
    expect(existing.statusCode).toBe(200)
    expect(missing.statusCode).toBe(200)
    expect(existing.json()).toEqual(missing.json())
    expect(sentMail).toHaveLength(1)
    const token = /#\/reset\/([^\s]+)/.exec(sentMail[0]!.text)?.[1]
    expect(token).toBeTruthy()

    const login = await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'reset-user', password: 'old-password-1' } })
    const oldToken = login.json<{ token: string }>().token
    const changed = await app.inject({ method: 'POST', url: '/api/session/reset/email', payload: { token, password: 'new-password-2' } })
    expect(changed.statusCode).toBe(200)
    expect(db.verifyUserPassword('reset-user', 'new-password-2')).not.toBeNull()
    expect((await app.inject({ method: 'GET', url: '/api/settings', headers: { authorization: `Bearer ${oldToken}` } })).statusCode).toBe(401)

    const reused = await app.inject({ method: 'POST', url: '/api/session/reset/email', payload: { token, password: 'another-password-3' } })
    expect(reused.statusCode).toBe(400)
    expect(reused.json<{ error: string }>().error).toMatch(/уже использована/)
    expect(db.listSecurityEvents({ user: 'reset-user', limit: 10 }).some((event) => event.type === 'password_reset' && event.details.includes('email'))).toBe(true)
  })

  it('отличает истёкшую ссылку и ограничивает запросы', async () => {
    db.createEmailVerification({ token: 'verify-expired-user', name: 'expired-user', email: 'expired@example.test', password: 'old-password-1', ttlMs: 60_000 })
    expect(db.redeemEmailVerification('verify-expired-user', 'developer')).not.toBeNull()
    db.createPasswordResetToken('expired-user', 'expired-token', -1)
    const expired = await app.inject({ method: 'POST', url: '/api/session/reset/email', payload: { token: 'expired-token', password: 'new-password-2' } })
    expect(expired.statusCode).toBe(410)
    expect(expired.json<{ error: string }>().error).toMatch(/истекла/)

    const responses = []
    for (let i = 0; i < 6; i += 1) responses.push(await app.inject({ method: 'POST', url: '/api/session/reset/request', payload: { email: `rate-${i}@example.test` } }))
    expect(responses.at(-1)?.statusCode).toBe(429)
    expect(responses.at(-1)?.headers['retry-after']).toBeTruthy()
  })
})

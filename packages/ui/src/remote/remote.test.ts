// Рантайм-склейка удалённых мостов (WS-роутинг/очередь, REST-запросы,
// декодирование base64-TTS). Контракт провода — общие типы @shared; здесь сама
// реализация мостов, общая для web и desktop-клиента.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { WsClient } from './wsClient'
import { createHttpApi } from './httpApi'
import { base64ToArrayBuffer } from './decode'
import { makeBoardBridge, makeClaudeBridge, makePreviewBridge, makeRealtimeBridge, makeSessionBridge, migrateDesktopLegacy } from './index'

class FakeWebSocket {
  static OPEN = 1
  static last: FakeWebSocket | null = null
  readyState = 0
  binaryType = 'blob'
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: unknown[] = []
  constructor(public url: string) {
    FakeWebSocket.last = this
  }
  send(d: unknown): void {
    this.sent.push(d)
  }
  close(): void {
    this.readyState = 3
    this.onclose?.()
  }
  _open(): void {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }
  _emit(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) })
  }
}

describe('WsClient', () => {
  const realWs = globalThis.WebSocket
  beforeEach(() => {
    ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket
  })
  afterEach(() => {
    ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = realWs
  })

  it('очередь до open, флаш после open', () => {
    const c = new WsClient('ws://x/ws')
    const ws = FakeWebSocket.last!
    c.send({ t: 'audio.stop' })
    expect(ws.sent).toHaveLength(0)
    ws._open()
    expect(ws.sent).toEqual([JSON.stringify({ t: 'audio.stop' })])
    c.close()
  })

  it('роутинг по типу сообщения + отписка', async () => {
    const c = new WsClient('ws://x/ws')
    const ws = FakeWebSocket.last!
    ws._open()
    const tokens: string[] = []
    const off = c.on('claude.token', (m) => tokens.push(m.delta))
    await Promise.resolve() // флаш буфера подписок (микротаск) → далее прямая доставка
    ws._emit({ t: 'claude.token', conversationId: 'c1', delta: 'Привет' })
    ws._emit({ t: 'claude.done', conversationId: 'c1', text: 'Привет' })
    expect(tokens).toEqual(['Привет'])
    off()
    ws._emit({ t: 'claude.token', conversationId: 'c1', delta: '!' })
    expect(tokens).toEqual(['Привет'])
    c.close()
  })

  it('доставляет lifecycle подключения и invalidation уведомлений подготовки', async () => {
    const c = new WsClient('ws://x/ws')
    const ws = FakeWebSocket.last!
    const connected = vi.fn()
    const invalidated = vi.fn()
    const bridge = makeRealtimeBridge(c)
    bridge.onConnected(connected)
    bridge.onTaskPreparationNotificationsInvalidated(invalidated)
    expect(bridge.connected()).toBe(false)
    ws._open()
    await Promise.resolve()
    expect(bridge.connected()).toBe(true)
    ws._emit({ t: 'task-preparation.notifications.invalidate', v: 1, projectId: 'p1' })
    expect(connected).toHaveBeenCalledTimes(1)
    expect(invalidated).toHaveBeenCalledWith({ projectId: 'p1' })
    c.close()
  })

  it('передаёт мету сообщения из claude.done в renderer-мост', async () => {
    const c = new WsClient('ws://x/ws')
    const ws = FakeWebSocket.last!
    ws._open()
    const done = vi.fn()
    makeClaudeBridge(c).onDone(done)
    await Promise.resolve()

    ws._emit({
      t: 'claude.done',
      conversationId: 'c1',
      text: 'Выберите вариант.',
      meta: { taskLaunch: { title: 'Исправить запуск', description: 'Описание', acceptanceCriteria: 'Карточка открывается' } }
    })

    expect(done).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'c1',
      meta: { taskLaunch: { title: 'Исправить запуск', description: 'Описание', acceptanceCriteria: 'Карточка открывается' } }
    }))
    c.close()
  })

  it('мост превью: preview.action доходит подписчику, result уходит кадром preview.result', async () => {
    const c = new WsClient('ws://x/ws')
    const ws = FakeWebSocket.last!
    ws._open()
    const bridge = makePreviewBridge(c)
    const actions: unknown[] = []
    bridge.onAction((m) => actions.push(m))
    await Promise.resolve()
    ws._emit({ t: 'preview.action', conversationId: 'c1', requestId: 'r1', action: { kind: 'open', url: 'https://a.b' } })
    expect(actions).toEqual([{ conversationId: 'c1', requestId: 'r1', action: { kind: 'open', url: 'https://a.b' } }])
    bridge.result({ requestId: 'r1', ok: true, result: { url: 'https://a.b' } })
    expect(ws.sent).toContain(JSON.stringify({ t: 'preview.result', requestId: 'r1', ok: true, result: { url: 'https://a.b' } }))
    bridge.result({ requestId: 'r2', ok: false, error: 'превью не открыто' })
    expect(ws.sent).toContain(JSON.stringify({ t: 'preview.result', requestId: 'r2', ok: false, error: 'превью не открыто' }))
    c.close()
  })

  it('маршрутизирует preparation-run и отличает reconnect от первого подключения', async () => {
    const c = new WsClient('ws://x/ws')
    const first = FakeWebSocket.last!
    const updates = vi.fn()
    const reconnects = vi.fn()
    const bridge = makeBoardBridge(c)
    bridge.onPreparationRunUpdated(updates)
    bridge.onReconnect(reconnects)
    first._open()
    await Promise.resolve()
    expect(reconnects).not.toHaveBeenCalled()
    first._emit({ t: 'preparation.run.updated', projectId: 'p1', taskId: 't1', runId: 'r1' })
    expect(updates).toHaveBeenCalledWith({ projectId: 'p1', taskId: 't1', runId: 'r1' })

    c.reconnect()
    FakeWebSocket.last!._open()
    expect(reconnects).toHaveBeenCalledOnce()
    c.close()
  })

  it('доставляет agents (живой статус машин) подписчику', async () => {
    const c = new WsClient('ws://x/ws')
    const ws = FakeWebSocket.last!
    ws._open()
    const got: Array<{ agents: unknown[] }> = []
    c.on('agents', (m) => got.push(m as never))
    await Promise.resolve()
    ws._emit({ t: 'agents', agents: [{ id: 'a1', name: 'M', online: true }] })
    expect(got).toHaveLength(1)
    expect(got[0].agents).toHaveLength(1)
    c.close()
  })

  it('буферизует сообщения до подписки и доставляет в исходном порядке', async () => {
    const c = new WsClient('ws://x/ws')
    const ws = FakeWebSocket.last!
    ws._open()
    // Сервер прислал снапшот и токен ДО того, как клиент успел подписаться (гонка
    // при обновлении страницы: сокет открыт раньше React-эффекта с подписками).
    ws._emit({ t: 'claude.active', turns: [{ conversationId: 'c1', partial: 'Нача' }] })
    ws._emit({ t: 'claude.token', conversationId: 'c1', delta: 'ло' })
    const order: string[] = []
    // Подписку на token регистрируем раньше active — но буфер флашится глобально в
    // исходном FIFO-порядке, поэтому active доставляется перед token.
    c.on('claude.token', (m) => order.push('token:' + m.delta))
    c.on('claude.active', (m) => order.push('active:' + m.turns[0].partial))
    await Promise.resolve()
    expect(order).toEqual(['active:Нача', 'token:ло'])
    // После флаша новые сообщения доставляются напрямую.
    ws._emit({ t: 'claude.token', conversationId: 'c1', delta: '!' })
    expect(order).toEqual(['active:Нача', 'token:ло', 'token:!'])
    c.close()
  })
})

describe('createHttpApi', () => {
  let calls: Array<{ url: string; init?: RequestInit }>
  function mockFetch(handler: (url: string, init?: RequestInit) => Partial<Response> & { _text?: string }) {
    calls = []
    ;(globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      const r = handler(url, init)
      return {
        ok: r.ok ?? true,
        status: r.status ?? 200,
        text: async () => r._text ?? '',
        json: async () => JSON.parse(r._text ?? 'null'),
        ...r
      } as Response
    })
  }

  it('httpBase учитывается в URL', async () => {
    mockFetch(() => ({ _text: JSON.stringify([{ id: 'c1' }]) }))
    const api = createHttpApi('http://srv:8787', 'ws://srv:8787/agent')
    await api['conversations:list']({})
    expect(calls[0].url).toBe('http://srv:8787/api/conversations')
  })

  it('conversations:get на 404 → null', async () => {
    mockFetch(() => ({ ok: false, status: 404 }))
    const api = createHttpApi('', 'ws://x/agent')
    expect(await api['conversations:get']({ id: 'nope' })).toBeNull()
    expect(calls[0].url).toBe('/api/conversations/nope')
  })

  it('показывает серверную причину HTTP-ошибки', async () => {
    mockFetch(() => ({ ok: false, status: 400, _text: JSON.stringify({ error: 'Другой production deploy уже выполняется' }) }))
    const api = createHttpApi('', 'ws://x/agent')
    await expect(api['releases:deploy']({ projectId: 'p1', branch: 'release/1.2.3' })).rejects.toThrow('Другой production deploy уже выполняется')
  })

  it('сохраняет машину проекта по серверному REST-контракту', async () => {
    mockFetch(() => ({ _text: JSON.stringify({ id: 'p1', defaultAgentId: 'mac' }) }))
    const api = createHttpApi('', 'ws://x/agent')

    await api['projects:setDefaultMachine']({ id: 'p1', agentId: 'mac' })

    expect(calls[0]).toMatchObject({
      url: '/api/projects/p1/default-machine',
      init: { method: 'POST', body: JSON.stringify({ agentId: 'mac' }) }
    })
  })

  it('сохраняет персональную машину по умолчанию отдельным REST-маршрутом', async () => {
    mockFetch(() => ({ _text: JSON.stringify({ id: 'p1' }) }))
    const api = createHttpApi('', 'ws://x/agent')

    await api['projects:setUserDefaultMachine']({ id: 'p1', agentId: 'mac' })

    expect(calls[0]).toMatchObject({
      url: '/api/projects/p1/machines/default',
      init: { method: 'PUT', body: JSON.stringify({ agentId: 'mac' }) }
    })
  })

  it('agents:connectionString использует agentWsUrl', async () => {
    mockFetch(() => ({ _text: '' }))
    const api = createHttpApi('http://srv:8787', 'ws://srv:8787/agent')
    const str = await api['agents:connectionString']({ token: 'tok' })
    expect(str.startsWith('vcagent:')).toBe(true)
  })

  it('downloads:url собирает абсолютный URL', async () => {
    mockFetch(() => ({ _text: '' }))
    const api = createHttpApi('http://srv:8787', 'ws://srv:8787/agent')
    expect(await api['downloads:url']({ kind: 'agent-app' })).toBe('http://srv:8787/api/agents/app')
  })

  it('messages:search собирает параметры (projectId=none — без проекта)', async () => {
    mockFetch(() => ({ _text: JSON.stringify({ hits: [], nextCursor: null, match: '' }) }))
    const api = createHttpApi('', 'ws://x/agent')

    await api['messages:search']({ query: 'миграция канбана', projectId: null, limit: 20 })
    // URLSearchParams кодирует пробел как «+», и Fastify разбирает его обратно
    // в пробел — иначе завершающий пробел (признак «слово закончено») терялся бы.
    expect(calls[0].url).toBe(`/api/search?q=${new URLSearchParams({ q: 'миграция канбана' }).toString().slice(2)}&projectId=none&limit=20`)

    await api['messages:search']({ query: 'q', projectId: 'p1', conversationId: 'c1', cursor: 'cur' })
    expect(calls[1].url).toBe('/api/search?q=q&projectId=p1&conversationId=c1&cursor=cur')

    // Без projectId — поиск по всем беседам, параметра в URL нет.
    await api['messages:search']({ query: 'q' })
    expect(calls[2].url).toBe('/api/search?q=q')
  })

  it('новый поиск отменяет предыдущий запрос (AbortController)', async () => {
    // Ответ не приходит: так видно, что отменяется именно живая заявка.
    mockFetch(() => ({ text: async () => new Promise<string>(() => {}) }) as never)
    const api = createHttpApi('', 'ws://x/agent')

    void api['messages:search']({ query: 'ми' })
    void api['messages:search']({ query: 'миграция' })

    expect(calls).toHaveLength(2)
    expect(calls[0].init?.signal?.aborted).toBe(true)
    expect(calls[1].init?.signal?.aborted).toBe(false)
  })
})

describe('base64ToArrayBuffer', () => {
  it('декодирует RIFF', () => {
    expect(new TextDecoder().decode(base64ToArrayBuffer('UklGRg=='))).toBe('RIFF')
  })
})

describe('session bridge logout', () => {
  beforeEach(() => localStorage.clear())

  it('вызывает server logout с Bearer и удаляет локальный токен только после успеха', async () => {
    localStorage.setItem('vc.session.token', 'session-token')
    const ws = { reconnect: vi.fn() } as unknown as WsClient
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    ;(globalThis as unknown as { fetch: unknown }).fetch = fetchMock

    await makeSessionBridge('http://srv', ws).logout()

    expect(fetchMock).toHaveBeenCalledWith('http://srv/api/session/logout', {
      method: 'POST',
      headers: { authorization: 'Bearer session-token' }
    })
    expect(localStorage.getItem('vc.session.token')).toBeNull()
    expect(ws.reconnect).toHaveBeenCalledOnce()
  })

  it('при ошибке сервера сохраняет токен и сообщает понятную ошибку', async () => {
    localStorage.setItem('vc.session.token', 'session-token')
    const ws = { reconnect: vi.fn() } as unknown as WsClient
    ;(globalThis as unknown as { fetch: unknown }).fetch = vi.fn().mockResolvedValue({ ok: false })

    await expect(makeSessionBridge('', ws).logout()).rejects.toThrow('Не удалось завершить сессию')
    expect(localStorage.getItem('vc.session.token')).toBe('session-token')
    expect(ws.reconnect).not.toHaveBeenCalled()
  })
})

describe('desktop legacy migration', () => {
  it('отправляет bundle с Bearer и помечает успешный импорт', async () => {
    const bundle = { conversations: [] }
    const markLegacyMigrated = vi.fn(async () => {})
    ;(globalThis as unknown as { window: unknown }).window = { remoteClient: { exportLegacyData: vi.fn(async () => bundle), markLegacyMigrated } }
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }))
    ;(globalThis as unknown as { fetch: unknown }).fetch = fetchMock
    await migrateDesktopLegacy('http://srv:8787', 'secret')
    expect(fetchMock).toHaveBeenCalledWith('http://srv:8787/api/migrations/desktop', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer secret' }) }))
    expect(markLegacyMigrated).toHaveBeenCalledOnce()
  })
})

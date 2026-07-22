// Рантайм-склейка удалённых мостов (WS-роутинг/очередь, REST-запросы,
// декодирование base64-TTS). Контракт провода — общие типы @shared; здесь сама
// реализация мостов, общая для web и desktop-клиента.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { WsClient } from './wsClient'
import { createHttpApi } from './httpApi'
import { base64ToArrayBuffer } from './decode'

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

  it('роутинг по типу сообщения + отписка', () => {
    const c = new WsClient('ws://x/ws')
    const ws = FakeWebSocket.last!
    ws._open()
    const tokens: string[] = []
    const off = c.on('claude.token', (m) => tokens.push(m.delta))
    ws._emit({ t: 'claude.token', conversationId: 'c1', delta: 'Привет' })
    ws._emit({ t: 'claude.done', conversationId: 'c1', text: 'Привет' })
    expect(tokens).toEqual(['Привет'])
    off()
    ws._emit({ t: 'claude.token', conversationId: 'c1', delta: '!' })
    expect(tokens).toEqual(['Привет'])
    c.close()
  })

  it('доставляет agents (живой статус машин) подписчику', () => {
    const c = new WsClient('ws://x/ws')
    const ws = FakeWebSocket.last!
    ws._open()
    const got: Array<{ agents: unknown[] }> = []
    c.on('agents', (m) => got.push(m as never))
    ws._emit({ t: 'agents', agents: [{ id: 'a1', name: 'M', online: true }] })
    expect(got).toHaveLength(1)
    expect(got[0].agents).toHaveLength(1)
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
    await api['conversations:list']()
    expect(calls[0].url).toBe('http://srv:8787/api/conversations')
  })

  it('conversations:get на 404 → null', async () => {
    mockFetch(() => ({ ok: false, status: 404 }))
    const api = createHttpApi('', 'ws://x/agent')
    expect(await api['conversations:get']({ id: 'nope' })).toBeNull()
    expect(calls[0].url).toBe('/api/conversations/nope')
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
})

describe('base64ToArrayBuffer', () => {
  it('декодирует RIFF', () => {
    expect(new TextDecoder().decode(base64ToArrayBuffer('UklGRg=='))).toBe('RIFF')
  })
})

// Ф11: рантайм-склейка мостов веб-клиента (WS-роутинг/очередь, REST-запросы,
// декодирование base64-TTS). Контракт провода гарантирован общими типами
// @voicechat/shared и покрыт тестами сервера; здесь — сама реализация мостов.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { WsClient } from './wsClient'
import { createHttpApi } from './httpApi'
import { base64ToArrayBuffer } from './decode'

// --- Fake WebSocket -------------------------------------------------------
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
    expect(ws.sent).toHaveLength(0) // ещё не открыт — в очереди
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
    ws._emit({ t: 'claude.done', conversationId: 'c1', text: 'Привет' }) // другой тип — игнор
    expect(tokens).toEqual(['Привет'])
    off()
    ws._emit({ t: 'claude.token', conversationId: 'c1', delta: '!' })
    expect(tokens).toEqual(['Привет']) // после отписки не приходит
    c.close()
  })

  it('бинарные кадры уходят после open', () => {
    const c = new WsClient('ws://x/ws')
    const ws = FakeWebSocket.last!
    ws._open()
    const buf = new Int16Array([1, 2, 3]).buffer
    c.sendBinary(buf)
    expect(ws.sent).toEqual([buf])
    c.close()
  })
})

describe('createHttpApi', () => {
  let calls: Array<{ url: string; init?: RequestInit }>
  function mockFetch(handler: (url: string, init?: RequestInit) => Partial<Response> & { _text?: string }) {
    calls = []
    ;(globalThis as unknown as { fetch: unknown }).fetch = vi.fn(
      async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        const r = handler(url, init)
        return {
          ok: r.ok ?? true,
          status: r.status ?? 200,
          text: async () => r._text ?? '',
          json: async () => JSON.parse(r._text ?? 'null'),
          ...r
        } as Response
      }
    )
  }

  it('conversations:list → GET /api/conversations', async () => {
    mockFetch(() => ({ _text: JSON.stringify([{ id: 'c1' }]) }))
    const api = createHttpApi()
    const list = await api['conversations:list']()
    expect(list).toEqual([{ id: 'c1' }])
    expect(calls[0].url).toBe('/api/conversations')
  })

  it('conversations:get на 404 → null', async () => {
    mockFetch(() => ({ ok: false, status: 404 }))
    const api = createHttpApi()
    const res = await api['conversations:get']({ id: 'nope' })
    expect(res).toBeNull()
    expect(calls[0].url).toBe('/api/conversations/nope')
  })

  it('messages:add → POST без conversationId в теле', async () => {
    mockFetch(() => ({ _text: JSON.stringify({ id: 'm1' }) }))
    const api = createHttpApi()
    await api['messages:add']({ conversationId: 'c1', role: 'u0', text: 'hi', time: 't' })
    expect(calls[0].url).toBe('/api/conversations/c1/messages')
    expect(calls[0].init?.method).toBe('POST')
    const body = JSON.parse(calls[0].init!.body as string)
    expect(body).toEqual({ role: 'u0', text: 'hi', time: 't' })
    expect(body).not.toHaveProperty('conversationId')
  })

  it('messages:delete → DELETE без Content-Type (иначе Fastify 400 на пустом теле)', async () => {
    mockFetch(() => ({ _text: '' }))
    const api = createHttpApi()
    await api['messages:delete']({ conversationId: 'c1', messageId: 'm1' })
    expect(calls[0].url).toBe('/api/conversations/c1/messages/m1')
    expect(calls[0].init?.method).toBe('DELETE')
    const headers = (calls[0].init?.headers ?? {}) as Record<string, string>
    expect(headers['content-type']).toBeUndefined()
  })

  it('settings:save → PUT /api/settings', async () => {
    mockFetch(() => ({ _text: '' }))
    const api = createHttpApi()
    await api['settings:save']({ model: 'sonnet' } as never)
    expect(calls[0].url).toBe('/api/settings')
    expect(calls[0].init?.method).toBe('PUT')
  })
})

describe('base64ToArrayBuffer', () => {
  it('декодирует WAV-заголовок RIFF', () => {
    const buf = base64ToArrayBuffer('UklGRg==') // "RIFF"
    expect(new TextDecoder().decode(buf)).toBe('RIFF')
  })
})

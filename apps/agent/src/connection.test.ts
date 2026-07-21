import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

// Мок ws: фейковый WebSocket-класс, копящий отправленное; инстансы доступны тесту.
const instances: FakeWS[] = []
class FakeWS extends EventEmitter {
  static OPEN = 1
  readyState = 1
  sent: string[] = []
  constructor(public url: string) {
    super()
    instances.push(this)
  }
  send(data: string): void {
    this.sent.push(data)
  }
  close(): void {
    this.emit('close')
  }
}
vi.mock('ws', () => ({ default: FakeWS }))

// Импорт после vi.mock (hoisted), чтобы connection увидел мок.
const { startConnection } = await import('./connection')

describe('startConnection (handlers)', () => {
  beforeEach(() => {
    instances.length = 0
  })

  it('шлёт agent.register на open и статус connecting→online', () => {
    const h = { onStatus: vi.fn(), onRegistered: vi.fn() }
    startConnection({ serverUrl: 'ws://x/agent', token: 'tok' }, h)
    expect(h.onStatus).toHaveBeenCalledWith('connecting')
    const ws = instances[0]
    ws.emit('open')
    expect(JSON.parse(ws.sent[0])).toEqual({ t: 'agent.register', token: 'tok' })

    ws.emit('message', JSON.stringify({ t: 'agent.registered', name: 'MacBook' }))
    expect(h.onStatus).toHaveBeenCalledWith('online')
    expect(h.onRegistered).toHaveBeenCalledWith('MacBook')
  })

  it('exec.start → onExec с командой', () => {
    const h = { onExec: vi.fn() }
    startConnection({ serverUrl: 'ws://x/agent', token: 't' }, h)
    const ws = instances[0]
    ws.emit('open')
    ws.emit('message', JSON.stringify({ t: 'exec.start', execId: 'e1', command: 'true', timeoutMs: 5000 }))
    expect(h.onExec).toHaveBeenCalledWith('true')
  })

  it('agent.denied → onDenied без выхода процесса', () => {
    const h = { onDenied: vi.fn() }
    startConnection({ serverUrl: 'ws://x/agent', token: 'bad' }, h)
    const ws = instances[0]
    ws.emit('message', JSON.stringify({ t: 'agent.denied', reason: 'Неверный токен' }))
    expect(h.onDenied).toHaveBeenCalledWith('Неверный токен')
  })

  it('stop() закрывает и ставит статус stopped', () => {
    const h = { onStatus: vi.fn() }
    const conn = startConnection({ serverUrl: 'ws://x/agent', token: 't' }, h)
    conn.stop()
    expect(h.onStatus).toHaveBeenCalledWith('stopped')
  })
})

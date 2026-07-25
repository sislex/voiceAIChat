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
    startConnection({ serverUrl: 'ws://x/agent', token: 'tok', rootDir: '/tmp' }, h)
    expect(h.onStatus).toHaveBeenCalledWith('connecting')
    const ws = instances[0]
    ws.emit('open')
    const reg = JSON.parse(ws.sent[0])
    expect(reg.t).toBe('agent.register')
    expect(reg.token).toBe('tok')
    expect(typeof reg.version).toBe('string') // рапортует свою версию

    ws.emit('message', JSON.stringify({ t: 'agent.registered', name: 'MacBook' }))
    expect(h.onStatus).toHaveBeenCalledWith('online')
    expect(h.onRegistered).toHaveBeenCalledWith('MacBook')
  })

  it('agent.updateAvailable → onUpdateAvailable(version)', () => {
    const h = { onUpdateAvailable: vi.fn() }
    startConnection({ serverUrl: 'ws://x/agent', token: 't', rootDir: '/tmp' }, h)
    const ws = instances[0]
    ws.emit('message', JSON.stringify({ t: 'agent.updateAvailable', version: '9.9.9' }))
    expect(h.onUpdateAvailable).toHaveBeenCalledWith('9.9.9')
  })

  it('exec.start → onExec с командой', () => {
    const h = { onExec: vi.fn() }
    startConnection({ serverUrl: 'ws://x/agent', token: 't', rootDir: '/tmp' }, h)
    const ws = instances[0]
    ws.emit('open')
    ws.emit('message', JSON.stringify({ t: 'exec.start', execId: 'e1', command: 'true', timeoutMs: 5000 }))
    expect(h.onExec).toHaveBeenCalledWith('true')
  })

  it('запрещённая политикой команда → exec.error без спавна', () => {
    const h = { onExecDone: vi.fn() }
    startConnection({ serverUrl: 'ws://x/agent', token: 't', rootDir: '/tmp' }, h)
    const ws = instances[0]
    ws.emit('open')
    // Политика: запись запрещена.
    ws.emit(
      'message',
      JSON.stringify({
        t: 'agent.registered',
        name: 'M',
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
    ws.sent.length = 0
    ws.emit('message', JSON.stringify({ t: 'exec.start', execId: 'e9', command: 'rm file', timeoutMs: 5000 }))
    const err = ws.sent.map((s) => JSON.parse(s)).find((m) => m.t === 'exec.error')
    expect(err).toBeTruthy()
    expect(err.message).toContain('политик')
  })

  it('agent.denied → onDenied без выхода процесса', () => {
    const h = { onDenied: vi.fn() }
    startConnection({ serverUrl: 'ws://x/agent', token: 'bad', rootDir: '/tmp' }, h)
    const ws = instances[0]
    ws.emit('message', JSON.stringify({ t: 'agent.denied', reason: 'Неверный токен' }))
    expect(h.onDenied).toHaveBeenCalledWith('Неверный токен')
  })

  it('stop() закрывает и ставит статус stopped', () => {
    const h = { onStatus: vi.fn() }
    const conn = startConnection({ serverUrl: 'ws://x/agent', token: 't', rootDir: '/tmp' }, h)
    conn.stop()
    expect(h.onStatus).toHaveBeenCalledWith('stopped')
  })
})

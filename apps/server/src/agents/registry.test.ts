import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AgentRegistry, type AgentSocket } from './registry'
import { DEFAULT_AGENT_POLICY, type ServerToAgent } from '@voicechat/shared'

/** Фейковый сокет: копит отправленные сообщения. */
function fakeSocket(): AgentSocket & { sent: ServerToAgent[]; closed: boolean } {
  const s = {
    sent: [] as ServerToAgent[],
    closed: false,
    send(data: string) {
      s.sent.push(JSON.parse(data) as ServerToAgent)
    },
    close() {
      s.closed = true
    }
  }
  return s
}

function makeRegistry(): AgentRegistry {
  let n = 0
  return new AgentRegistry({ newId: () => `exec-${++n}` })
}

describe('AgentRegistry', () => {
  it('exec: шлёт exec.start, копит chunks и резолвится по done', async () => {
    const reg = makeRegistry()
    const sock = fakeSocket()
    reg.register('a1', 'Мак', sock)

    const p = reg.exec('a1', 'df -h', 1000)
    expect(sock.sent[0]).toEqual({ t: 'exec.start', execId: 'exec-1', command: 'df -h', timeoutMs: 1000 })

    reg.handleMessage('a1', { t: 'exec.chunk', execId: 'exec-1', stream: 'stdout', data: 'диск ' })
    reg.handleMessage('a1', { t: 'exec.chunk', execId: 'exec-1', stream: 'stderr', data: 'warn' })
    reg.handleMessage('a1', { t: 'exec.done', execId: 'exec-1', exitCode: 0 })

    await expect(p).resolves.toEqual({ exitCode: 0, output: 'диск warn', timedOut: false })
  })

  it('exec: офлайн-агент → reject сразу', async () => {
    const reg = makeRegistry()
    await expect(reg.exec('нет', 'ls', 1000)).rejects.toThrow('не в сети')
  })

  it('exec: команда, запрещённая политикой, → reject без отправки', async () => {
    const reg = makeRegistry()
    const sock = fakeSocket()
    reg.register('a1', 'Мак', sock, {
      allowedDirs: [],
      allowNetwork: true,
      allowWrite: false,
      denyPatterns: [],
      allowPatterns: [],
      skills: []
    })
    await expect(reg.exec('a1', 'rm -rf x', 1000)).rejects.toThrow('политик')
    expect(sock.sent.some((m) => m.t === 'exec.start')).toBe(false)
  })

  it('updatePolicy шлёт agent.policy онлайн-агенту', () => {
    const reg = makeRegistry()
    const sock = fakeSocket()
    reg.register('a1', 'Мак', sock)
    reg.updatePolicy('a1', { ...DEFAULT_AGENT_POLICY, allowNetwork: false })
    const msg = sock.sent.find((m) => m.t === 'agent.policy')
    expect(msg).toBeTruthy()
  })

  it('onChange вызывается на register/unregister', () => {
    const reg = makeRegistry()
    let n = 0
    reg.onChange(() => n++)
    reg.register('a1', 'Мак', fakeSocket())
    reg.unregister('a1')
    expect(n).toBe(2)
  })

  it('exec.error → reject с сообщением', async () => {
    const reg = makeRegistry()
    reg.register('a1', 'Мак', fakeSocket())
    const p = reg.exec('a1', 'x', 1000)
    reg.handleMessage('a1', { t: 'exec.error', execId: 'exec-1', message: 'spawn failed' })
    await expect(p).rejects.toThrow('spawn failed')
  })

  it('дисконнект агента отклоняет незавершённые команды', async () => {
    const reg = makeRegistry()
    reg.register('a1', 'Мак', fakeSocket())
    const p = reg.exec('a1', 'sleep 5', 1000)
    reg.unregister('a1')
    await expect(p).rejects.toThrow('отключилась')
    expect(reg.isOnline('a1')).toBe(false)
  })

  it('кап вывода: лишние чанки отбрасываются с маркером', async () => {
    const reg = makeRegistry()
    reg.register('a1', 'Мак', fakeSocket())
    const p = reg.exec('a1', 'cat big', 1000)
    const big = 'x'.repeat(120 * 1024)
    reg.handleMessage('a1', { t: 'exec.chunk', execId: 'exec-1', stream: 'stdout', data: big })
    reg.handleMessage('a1', { t: 'exec.chunk', execId: 'exec-1', stream: 'stdout', data: big })
    reg.handleMessage('a1', { t: 'exec.chunk', execId: 'exec-1', stream: 'stdout', data: 'хвост' })
    reg.handleMessage('a1', { t: 'exec.done', execId: 'exec-1', exitCode: 0 })
    const res = await p
    expect(res.output).toContain('…[вывод обрезан]')
    expect(res.output).not.toContain('хвост')
    expect(res.output.length).toBeLessThan(130 * 1024)
  })

  describe('таймауты (fake timers)', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('страховочный таймаут → resolve с timedOut и exec.cancel агенту', async () => {
      const reg = makeRegistry()
      const sock = fakeSocket()
      reg.register('a1', 'Мак', sock)
      const p = reg.exec('a1', 'sleep 999', 1000)
      vi.advanceTimersByTime(1000 + 10_000 + 1)
      const res = await p
      expect(res.timedOut).toBe(true)
      expect(sock.sent.some((m) => m.t === 'exec.cancel')).toBe(true)
    })
  })

  it('повторная регистрация того же агента вытесняет старый сокет', () => {
    const reg = makeRegistry()
    const oldSock = fakeSocket()
    const newSock = fakeSocket()
    reg.register('a1', 'Мак', oldSock)
    reg.register('a1', 'Мак', newSock)
    expect(oldSock.closed).toBe(true)
    expect(reg.isOnline('a1')).toBe(true)
    expect(reg.nameOf('a1')).toBe('Мак')
  })

  it('cancelAll отклоняет команды и шлёт exec.cancel', async () => {
    const reg = makeRegistry()
    const sock = fakeSocket()
    reg.register('a1', 'Мак', sock)
    const p = reg.exec('a1', 'sleep 5', 1000)
    reg.cancelAll('a1')
    await expect(p).rejects.toThrow('отменена')
    expect(sock.sent.some((m) => m.t === 'exec.cancel')).toBe(true)
  })
})

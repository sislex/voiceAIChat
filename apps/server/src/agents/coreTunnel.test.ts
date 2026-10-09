import { describe, expect, it, vi } from 'vitest'
import { once } from 'node:events'
import { request } from 'node:http'
import { CoreTunnel } from './coreTunnel.js'
import { AgentRegistry } from './registry.js'
import { AGENT_VERSION } from '@sislexa/agent-contracts'

describe('Core-terminated tunnel', () => {
  it('waits for connection, propagates peer and websocket backpressure, bounds frames', async () => {
    vi.useFakeTimers()
    const frames: Array<Record<string, unknown>> = []
    let buffered = 0
    const cleanup = vi.fn()
    const stream = new CoreTunnel(frame => frames.push(frame), () => buffered, cleanup)
    try {
      const done = vi.fn()
      stream.write(Buffer.alloc(96 * 1024), done)
      expect(frames).toHaveLength(0)
      stream.frame({ t: 'tunnel.connected' })
      expect(frames).toHaveLength(1)
      buffered = 1024 * 1024
      await vi.advanceTimersByTimeAsync(50); expect(frames).toHaveLength(1)
      buffered = 0; stream.frame({ t: 'tunnel.pause' })
      await vi.advanceTimersByTimeAsync(50); expect(frames).toHaveLength(1)
      stream.frame({ t: 'tunnel.resume' })
      await vi.advanceTimersByTimeAsync(50)
      expect(frames.filter(f => f.t === 'tunnel.data')).toHaveLength(3)
      expect(done).toHaveBeenCalledOnce()
      stream.frame({ t: 'tunnel.data', data: Buffer.alloc(128 * 1024).toString('base64') })
      expect(frames.at(-1)?.t).toBe('tunnel.pause')
      stream.read()
      expect(frames.at(-1)?.t).toBe('tunnel.resume')
    } finally { stream.destroy(); vi.useRealTimers() }
    await once(stream, 'close')
    expect(cleanup).toHaveBeenCalledOnce()
  })
  it('routes only the target agent frames and aborts on disconnect', async () => {
    const registry = new AgentRegistry()
    const frames: Array<Record<string, string>> = []
    registry.register('m', 'machine', { send: raw => frames.push(JSON.parse(raw)), close() {} }, undefined, AGENT_VERSION)
    const stream = registry.connectCoreTunnel('m', 24019)
    const id = frames[0]!.tunnelId!
    expect(frames[0]).toMatchObject({ t: 'tunnel.connect', port: 24019 })
    await registry.handleMessage('other', { t: 'tunnel.data', tunnelId: id, connectionId: id, data: 'eA==' })
    expect(stream.readableLength).toBe(0)
    const error = once(stream, 'error')
    registry.unregister('m')
    expect((await error)[0].message).toBe('Machine disconnected')
    expect(stream.destroyed).toBe(true)
  })
  it('serves HTTP streaming and raw upgrade over a Duplex with no local TCP fallback', async () => {
    for (const upgrade of [false, true]) {
      let input = ''
      let responded = false
      let stream: CoreTunnel
      stream = new CoreTunnel(frame => {
        if (frame.t !== 'tunnel.data') return
        const chunk = Buffer.from(String(frame.data), 'base64').toString()
        input += chunk
        if (responded) {
          if (upgrade) queueMicrotask(() => stream.frame({ t: 'tunnel.data', data: Buffer.from(chunk).toString('base64') }))
          return
        }
        if (!input.includes('\r\n\r\n')) return
        responded = true
        queueMicrotask(() => {
          const reply = upgrade ? 'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'
            : 'HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\nd\r\ndata: first\n\n\r\n'
          stream.frame({ t: 'tunnel.data', data: Buffer.from(reply).toString('base64') })
        })
      }, () => 0, () => {})
      stream.frame({ t: 'tunnel.connected' })
      try {
        const req = request({ host: 'not-a-real-host.invalid', createConnection: () => stream,
          headers: upgrade ? { connection: 'Upgrade', upgrade: 'websocket' } : {} })
        if (upgrade) {
          const upgraded = once(req, 'upgrade'); req.end()
          const [, socket] = await upgraded
          const echo = once(socket, 'data'); socket.write('echo')
          expect((await echo)[0].toString()).toBe('echo')
        } else {
          const response = once(req, 'response'); req.end()
          const [res] = await response
          const chunk = once(res, 'data')
          expect((await chunk)[0].toString()).toBe('data: first\n\n')
          const ended = once(res, 'end')
          stream.frame({ t: 'tunnel.data', data: Buffer.from('0\r\n\r\n').toString('base64') })
          await ended
        }
      } finally { stream.destroy() }
    }
  })
})


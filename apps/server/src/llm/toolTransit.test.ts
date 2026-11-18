import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { ToolTransitHub, transitRequest, type TransitSink } from './toolTransit.js'

function socket() {
  const emitter = new EventEmitter()
  const sent: Record<string, unknown>[] = []
  return { sent, emitter,
    api: { send: (data: string) => { sent.push(JSON.parse(data)) }, close: () => { emitter.emit('close') },
      on: (event: string, listener: (...args: unknown[]) => void) => emitter.on(event, listener) } }
}
function sink() {
  const events: unknown[] = []
  const api: TransitSink = { head: (status, headers) => events.push(['head', status, headers]), chunk: (data) => events.push(['chunk', data.toString()]),
    end: () => events.push(['end']), fail: (status, message) => events.push(['fail', status, message]) }
  return { events, api }
}
const SLOT = 'AAAAAAAAAAAAAAAAAAAAAAAA'

describe('ToolTransitHub', () => {
  it('binds a run to the token session that owns the connection', () => {
    const hub = new ToolTransitHub('http://core:8787/')
    const s = socket()
    const id = hub.attach(s.api as never, 'sid-1')
    expect(s.sent[0]).toEqual({ t: 'ready', id })
    expect(hub.open('sid-2', id, [SLOT])).toBeNull()
    expect(hub.open('sid-1', 'other', [SLOT])).toBeNull()
    expect(hub.open('sid-1', id, [SLOT, SLOT])).toBeNull()
    const run = hub.open('sid-1', id, [SLOT])!
    expect(run.url({ slot: SLOT, query: 'make=1' })).toBe(`http://core:8787/mcp/transit/${run.token}/${SLOT}?make=1`)
  })

  it('times a silent call out and reports the counters when the run closes', () => {
    vi.useFakeTimers()
    try {
      const hub = new ToolTransitHub('http://core', { callTimeoutMs: 1000 })
      const s = socket()
      const run = hub.open('sid', hub.attach(s.api as never, 'sid'), [SLOT])!
      const out = sink()
      hub.relay(run.token, SLOT, { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'private' }, body: Buffer.from('{}') }, out.api)
      expect(s.sent[1]).toMatchObject({ t: 'req', slot: SLOT, method: 'POST', headers: { 'content-type': 'application/json' }, body: 'e30=' })
      expect(s.sent[1]!.headers).not.toHaveProperty('cookie')
      vi.advanceTimersByTime(1001)
      expect(out.events).toEqual([['fail', 504, 'call_timeout']])
      expect(s.sent[2]).toMatchObject({ t: 'abort' })
      expect(run.close()).toEqual({ calls: 1, failed: 1 })
      const late = sink()
      hub.relay(run.token, SLOT, { method: 'POST', headers: {} }, late.api)
      expect(late.events).toEqual([['fail', 404, 'unknown_endpoint']])
    } finally { vi.useRealTimers() }
  })

  it('enforces request, response and call limits', () => {
    const hub = new ToolTransitHub('http://core', { requestBytes: 4, responseBytes: 5, callsPerRun: 3 })
    const s = socket()
    const run = hub.open('sid', hub.attach(s.api as never, 'sid'), [SLOT])!
    const big = sink()
    hub.relay(run.token, SLOT, { method: 'POST', headers: {}, body: Buffer.from('12345') }, big.api)
    expect(big.events).toEqual([['fail', 413, 'request_too_large']])
    const out = sink()
    hub.relay(run.token, SLOT, { method: 'POST', headers: {} }, out.api)
    const call = (s.sent.at(-1) as { call: string }).call
    s.emitter.emit('message', JSON.stringify({ t: 'head', call, status: 200, headers: { 'content-type': 'text/plain', 'set-cookie': 'x' } }))
    s.emitter.emit('message', JSON.stringify({ t: 'chunk', call, data: Buffer.from('123456').toString('base64') }))
    expect(out.events).toEqual([['head', 200, { 'content-type': 'text/plain' }], ['fail', 502, 'response_too_large']])
    for (let i = 0; i < 2; i++) hub.relay(run.token, SLOT, { method: 'POST', headers: {} }, sink().api)
    const over = sink()
    hub.relay(run.token, SLOT, { method: 'POST', headers: {} }, over.api)
    expect(over.events).toEqual([['fail', 429, 'call_limit_exceeded']])
  })
})

describe('transitRequest', () => {
  it('takes placeholders only and never gives the runner a built-in tool', () => {
    const built = transitRequest({ kbMcpUrl: `transit:${SLOT}`, kbMode: 'manual', permissionMode: 'bypassPermissions', disallowedTools: ['mcp__kb__search'], cwd: '/x', textOnly: false })!
    expect(built.slots).toEqual([SLOT])
    expect(built.build(({ slot }) => 'http://core/' + slot)).toEqual({ toolOnly: true, executionDisabled: true, kbMcpUrl: 'http://core/' + SLOT,
      kbMode: 'manual', permissionMode: 'bypassPermissions', disallowedTools: ['mcp__kb__search'] })
    expect(transitRequest({ kbMcpUrl: 'http://127.0.0.1/kb' })).toBeNull()
    expect(transitRequest({ kbMcpUrl: `transit:${SLOT}`, historyMcpUrl: `transit:${SLOT}` })).toBeNull()
    expect(transitRequest({ remote: { mcpUrl: `transit:${SLOT}`, agentName: '' } })).toBeNull()
    expect(transitRequest({ kbMcpUrl: `transit:${SLOT}`, permissionMode: 'root' })).toBeNull()
    expect(transitRequest({})).toBeNull()
    const remote = transitRequest({ remote: { mcpUrl: `transit:${SLOT}?make=1`, agentName: 'M' } })!.build(({ slot, query }) => `u/${slot}?${query}`)
    expect(remote).toEqual({ toolOnly: true, remote: { mcpUrl: `u/${SLOT}?make=1`, agentName: 'M' } })
  })
})

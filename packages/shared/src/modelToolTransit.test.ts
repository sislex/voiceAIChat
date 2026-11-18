import { describe, expect, it } from 'vitest'
import {
  modelToolTransitPlaceholder, parseModelToolTransitApplicationFrame, parseModelToolTransitPlaceholder, parseModelToolTransitProviderFrame
} from './modelToolTransit'

describe('model tool transit contract', () => {
  it('accepts only opaque placeholders with plain flags', () => {
    const slot = 'AbCdEf0123456789_-AbCdEf'
    expect(parseModelToolTransitPlaceholder(modelToolTransitPlaceholder(slot))).toEqual({ slot, query: '' })
    expect(parseModelToolTransitPlaceholder(modelToolTransitPlaceholder(slot, 'make=1'))).toEqual({ slot, query: 'make=1' })
    for (const value of ['http://127.0.0.1/mcp', 'transit:short', `transit:${slot}?k=a/b`, `transit:${slot}/x`, `transit:${slot}?next=http://x`, 7, null]) {
      expect(parseModelToolTransitPlaceholder(value)).toBeNull()
    }
  })

  it('parses frames of both directions and drops malformed ones', () => {
    const slot = 'AbCdEf0123456789'
    expect(parseModelToolTransitProviderFrame(JSON.stringify({ t: 'ready', id: 'c1' }))).toEqual({ t: 'ready', id: 'c1' })
    expect(parseModelToolTransitProviderFrame(JSON.stringify({ t: 'req', call: 'k', slot, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'e30=' })))
      .toEqual({ t: 'req', call: 'k', slot, method: 'POST', headers: { 'content-type': 'application/json' }, body: 'e30=' })
    expect(parseModelToolTransitProviderFrame(JSON.stringify({ t: 'req', call: 'k', slot: '../x', method: 'POST', headers: {} }))).toBeNull()
    expect(parseModelToolTransitProviderFrame('not json')).toBeNull()
    expect(parseModelToolTransitApplicationFrame(JSON.stringify({ t: 'head', call: 'k', status: 200, headers: { 'Content-Type': 'text/event-stream' } })))
      .toEqual({ t: 'head', call: 'k', status: 200, headers: { 'content-type': 'text/event-stream' } })
    expect(parseModelToolTransitApplicationFrame(JSON.stringify({ t: 'head', call: 'k', status: 99, headers: {} }))).toBeNull()
    expect(parseModelToolTransitApplicationFrame(JSON.stringify({ t: 'chunk', call: 'k', data: 'YQ==' }))).toEqual({ t: 'chunk', call: 'k', data: 'YQ==' })
    expect(parseModelToolTransitApplicationFrame(JSON.stringify({ t: 'end' }))).toBeNull()
    expect(parseModelToolTransitApplicationFrame(JSON.stringify({ t: 'err', call: 'k', message: 'x'.repeat(900) }))).toMatchObject({ t: 'err', call: 'k' })
  })
})

import { describe, expect, it } from 'vitest'
import { MakeHub } from './hub'

describe('MakeHub presence (roadmap-2 п.14)', () => {
  it('heartbeat добавляет/обновляет вкладку, leave убирает, протухшие выбрасываются', () => {
    const hub = new MakeHub()
    const t0 = 1_000_000
    expect(hub.heartbeat('c1', { clientId: 'a', user: 'u', path: 'x.css', editing: true, at: t0 })).toHaveLength(1)
    expect(hub.heartbeat('c1', { clientId: 'b', user: 'u', path: null, editing: false, at: t0 + 1 })).toHaveLength(2)
    expect(hub.heartbeat('c1', { clientId: 'b', user: 'u', path: null, editing: false, at: t0 + 60_000 }).map((c) => c.clientId)).toEqual(['b'])
    expect(hub.heartbeat('c1', { clientId: 'b', user: 'u', path: null, editing: false, at: t0 + 60_001 }, true)).toEqual([])
    const got: unknown[] = []
    hub.subscribe('u', (m) => got.push(m))
    hub.broadcastPresence('u', 'c1', [])
    expect(got[0]).toMatchObject({ t: 'make.presence', conversationId: 'c1', clients: [] })
  })
})

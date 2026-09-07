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

describe('MakeHub: ретрансляция между процессами', () => {
  it('listener получает события, apply воспроизводит их без повторной отправки', () => {
    const remote = new MakeHub()
    const sent: unknown[] = []
    remote.setListener((event) => sent.push(event))
    remote.changed('ann', 'c1', 3, ['a.css'])
    remote.broadcastPresence('ann', 'c1', [{ clientId: 'k', user: 'ann', at: 1 } as never])
    remote.rememberTurnSnapshot('t1', 'snap-1')
    expect(sent).toEqual([
      { kind: 'changed', userId: 'ann', conversationId: 'c1', rev: 3, paths: ['a.css'] },
      { kind: 'presence', userId: 'ann', conversationId: 'c1', clients: [{ clientId: 'k', user: 'ann', at: 1 }] },
      { kind: 'turnSnapshot', turn: 't1', snapshotId: 'snap-1' }
    ])

    const local = new MakeHub()
    const echoed: unknown[] = []
    local.setListener((event) => echoed.push(event))
    const frames: unknown[] = []
    local.subscribe('ann', (m) => frames.push(m))
    for (const event of sent) local.apply(event as never)
    expect(frames).toEqual([
      { t: 'make.changed', conversationId: 'c1', rev: 3, paths: ['a.css'] },
      { t: 'make.presence', conversationId: 'c1', clients: [{ clientId: 'k', user: 'ann', at: 1 }] }
    ])
    expect(local.turnSnapshot('t1')).toBe('snap-1')
    expect(echoed).toEqual([])
  })
})

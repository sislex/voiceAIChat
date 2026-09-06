import { describe, it, expect, vi } from 'vitest'
import { createAgentWatchdog } from './watchdog'
import type { ServerMessage } from '@voicechat/shared'

function setup(thresholdMs = 10 * 60_000) {
  let now = 1_000_000
  const online = new Set<string>()
  const changeListeners = new Set<() => void>()
  const agents = [
    { id: 'a1', name: 'Мак', lastSeen: 1_000_000 - 20 * 60_000, userId: 'bob' },
    { id: 'a2', name: 'Прод', lastSeen: 1_000_000 - 60_000, userId: 'bob' },
    { id: 'never', name: 'Новая', lastSeen: null, userId: 'bob' }
  ]
  const logged: unknown[] = []
  const published: Array<{ m: ServerMessage; user: string }> = []
  const wd = createAgentWatchdog({
    db: {machines:{listAllAgents: () => agents,logMachineEvent: (e) => logged.push(e)}},
    registry: { isOnline: (id) => online.has(id), onChange: (cb) => { changeListeners.add(cb); return () => changeListeners.delete(cb) } },
    publish: (m, user) => published.push({ m, user }),
    thresholdMs,
    now: () => now
  })
  return { wd, online, logged, published, agents, advance: (ms: number) => { now += ms }, change: () => changeListeners.forEach((cb) => cb()) }
}

describe('agent watchdog', () => {
  it('тревога только по машине, пропавшей дольше порога и имевшей агента; повторно не шлётся', () => {
    const s = setup()
    const events = s.wd.tick()
    expect(events.map((e) => e.machineId)).toEqual(['a1'])
    expect(s.published[0]).toMatchObject({ user: 'bob', m: { t: 'machine.status', event: { machineId: 'a1', state: 'offline', offlineForMs: 20 * 60_000 } } })
    expect(s.wd.tick()).toEqual([])
    expect(s.wd.alerted()).toEqual(['a1'])
    // a2 дозрела до порога
    s.advance(10 * 60_000)
    expect(s.wd.tick().map((e) => e.machineId)).toEqual(['a2'])
    expect(s.logged).toHaveLength(2)
  })

  it('возврат машины в сеть снимает тревогу и публикует «вернулась» с длительностью простоя', () => {
    const s = setup()
    s.wd.tick()
    s.advance(5 * 60_000)
    s.online.add('a1')
    s.change()
    expect(s.wd.alerted()).toEqual([])
    const back = s.published.at(-1)!.m as Extract<ServerMessage, { t: 'machine.status' }>
    expect(back.event).toMatchObject({ machineId: 'a1', state: 'online', offlineForMs: 25 * 60_000 })
    // без тревог onChange ничего не делает
    const before = s.published.length
    s.change()
    expect(s.published).toHaveLength(before)
    s.wd.stop()
    vi.restoreAllMocks()
  })
})

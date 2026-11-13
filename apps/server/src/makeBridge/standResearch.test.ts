import { describe, expect, it } from 'vitest'
import { StandResearch, type StandResearchRunner } from './standResearch.js'
import { UserStands } from './userStand.js'

function fakeRunner() {
  const calls: Array<{ tabId?: string; command: { type: string; url?: string; action?: { kind: string; url?: string } } }> = []
  let tabs = 0, incarnation = 'i1', stale = false
  const urls = new Map<string, string>()
  const runner: StandResearchRunner = {
    start: async () => ({ incarnation, activeTabId: null, tabs: [] }) as never,
    async command(_session, request) {
      if (stale && request.incarnation !== incarnation) throw new Error('stale_incarnation')
      const command = request.command as never as { type: string; url?: string; action?: { kind: string; url?: string } }
      calls.push({ tabId: request.tabId, command })
      if (command.type === 'newTab') return { activeTabId: 't' + (++tabs), tabs: [] }
      if (command.type === 'navigate') { urls.set(request.tabId!, command.url!); return {} }
      if (command.type === 'status') return { tabs: [...urls].map(([id, url]) => ({ id, url })) }
      return { ok: true, kind: command.action!.kind, url: command.action!.url }
    },
  }
  return { runner, calls, restart: () => { incarnation = 'i2'; stale = true } }
}
const lookup = async (host: string) => [{ address: host === 'inside.test' ? '10.0.0.5' : '93.184.216.34', family: 4 }]

describe('StandResearch', () => {
  it('keeps a tab per stand, navigates on a new tab, navigate or reload and guards every URL', async () => {
    const fake = fakeRunner()
    const research = new StandResearch({ runner: () => fake.runner, allowLoopback: false, guard: { lookup } })
    const stands = new UserStands({ db: {} as never, machines: {} as never, previews: {} as never, reservedPorts: [], research })
    const op = (stand: string, url: string | null, action: object, extra: object = {}) => stands.userStand('alice', { op: 'research', conversationId: 'c1', stand, url, action, ...extra } as never)
    expect(await op('s3', 'https://money.example/', { kind: 'tree' }, { navigate: 'https://money.example/a' })).toEqual({ research: { ok: true, kind: 'tree' } })
    await op('s3', 'https://money.example/', { kind: 'styles', element: 'e1' })
    await op('s4', 'https://habr.example/p', { kind: 'network' })
    await op('s4', 'https://habr.example/p', { kind: 'network' }, { reload: true })
    expect(fake.calls.filter(call => call.command.type === 'navigate').map(call => [call.tabId, call.command.url]))
      .toEqual([['t1', 'https://money.example/a'], ['t2', 'https://habr.example/p'], ['t2', 'https://habr.example/p']])
    expect(await op('s4', null, { kind: 'resource', url: '/img/arrow.svg' })).toEqual({ research: { ok: true, kind: 'resource', url: 'https://habr.example/img/arrow.svg' } })
    await expect(op('s5', 'http://inside.test/', { kind: 'tree' })).rejects.toThrow('stand_url_forbidden')
    await expect(op('s4', null, { kind: 'resource', url: 'http://127.0.0.1:8787/internal' })).rejects.toThrow('stand_url_forbidden')
    fake.restart()
    await op('s3', 'https://money.example/', { kind: 'tree' })
    expect(fake.calls.at(-2)).toMatchObject({ command: { type: 'navigate', url: 'https://money.example/' } })
  })

  it('allows loopback stands only by switch and reports a missing runner', async () => {
    const fake = fakeRunner()
    const local = new StandResearch({ runner: () => fake.runner, allowLoopback: true, guard: { lookup } })
    expect(await local.research('alice', { op: 'research', conversationId: 'c1', stand: 'bound', url: 'http://127.0.0.1:23002/', action: { kind: 'tree' } })).toEqual({ research: { ok: true, kind: 'tree' } })
    const none = new UserStands({ db: {} as never, machines: {} as never, previews: {} as never, reservedPorts: [] })
    await expect(none.userStand('alice', { op: 'research', conversationId: 'c1', stand: 'x', url: null, action: { kind: 'tree' } })).rejects.toThrow('stand_proxy_unavailable')
  })
})

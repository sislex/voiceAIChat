import { expect, it, vi } from 'vitest'
import type { AgentInfo } from '@sislexa/agent-contracts'
import type { AgentUpdateStatus } from './agents/registry.js'
import { setupRestHarness } from './routes/restHarness.js'

const harness = setupRestHarness()
type Row = AgentInfo & { updateStatus?: AgentUpdateStatus }

async function withFeed(run: (frames: Row[][]) => Promise<void>) {
  const frames: Row[][] = []
  await harness.app.ready()
  const socket = await harness.app.injectWS('/ws?token=' + harness.token, {}, {
    onInit: ws => ws.on('message', data => {
      const message = JSON.parse(String(data))
      if (message.t === 'agents') frames.push(message.agents)
    })
  })
  try {
    await vi.waitFor(() => expect(frames).toHaveLength(1))
    await run(frames)
  } finally {
    socket.terminate()
  }
}

async function machine(name: string, owner = harness.U) {
  const created = await harness.db.machines.createAgent(owner, name)
  harness.agentRegistry.register(created.id, name, { send: vi.fn(), close: vi.fn() }, undefined, '0.25.0')
  return created.id
}

async function report(id: string, status: AgentUpdateStatus['status'], message: string, at: number) {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(at)
  try {
    await harness.agentRegistry.handleMessage(id, { t: 'agent.updateResult', status, message })
  } finally {
    clock.mockRestore()
  }
  return { status, message, at }
}

// @testCase TC-1
it('delivers the registry outcome unchanged in the initial feed and subscription updates', async () => {
  const id = await machine('Updated')
  const initial = await report(id, 'rolled_back', 'health check failed', 1700000000123)
  await withFeed(async frames => {
    expect(frames[0]!.find(a => a.id === id)?.updateStatus).toEqual(initial)
    expect(harness.agentRegistry.updateStatusOf(id)).toEqual(initial)
    const initialRest = await harness.inj({ method: 'GET', url: '/api/agents' })
    expect(initialRest.statusCode).toBe(200)
    expect(initialRest.json().find((a: Row) => a.id === id).updateStatus).toEqual(initial)
    const next = await report(id, 'applied', 'update completed', 1700000000456)
    await vi.waitFor(() => expect(frames).toHaveLength(2))
    expect(frames[1]!.find(a => a.id === id)?.updateStatus).toEqual(next)
    expect(harness.agentRegistry.updateStatusOf(id)).toEqual(next)
    const rest = await harness.inj({ method: 'GET', url: '/api/agents' })
    expect(rest.statusCode).toBe(200)
    expect(rest.json().find((a: Row) => a.id === id).updateStatus).toEqual(next)
  })
})

// @testCase TC-2
it('omits updateStatus from serialized initial and subsequent rows without a result', async () => {
  const id = await machine('No result')
  const updated = await machine('Updated')
  await withFeed(async frames => {
    expect(harness.agentRegistry.updateStatusOf(id)).toBeUndefined()
    expect(Object.hasOwn(frames[0]!.find(a => a.id === id)!, 'updateStatus')).toBe(false)
    await report(updated, 'rolled_back', 'another machine', 1700000000789)
    await vi.waitFor(() => expect(frames).toHaveLength(2))
    expect(Object.hasOwn(frames[1]!.find(a => a.id === id)!, 'updateStatus')).toBe(false)
    expect(frames[1]!.find(a => a.id === updated)?.updateStatus).toEqual(harness.agentRegistry.updateStatusOf(updated))
  })
})

// @testCase TC-3
it('preserves all existing fields, owner isolation and offline outcomes on both deliveries', async () => {
  const id = await machine('Online')
  const offline = await machine('Offline')
  await harness.db.identity.createUser('other', '', 'developer')
  const foreign = await machine('Foreign', 'other')
  const ownResult = await report(id, 'rolled_back', 'online result', 1700000000100)
  const offlineResult = await report(offline, 'rolled_back', 'offline result', 1700000000200)
  await report(foreign, 'rolled_back', 'private result', 1700000000300)
  harness.agentRegistry.unregister(offline)
  const imageHost = { port: 12345, hosts: ['192.0.2.1'] }
  harness.agentRegistry.setImageHost(id, imageHost)
  const telemetry = {
    ts: 1700000000000,
    os: { platform: 'darwin', release: 'test', arch: 'arm64', isAndroid: false },
    cpu: { count: 8, loadPct: 12 }, mem: { totalBytes: 16000, usedBytes: 8000 }, disk: {}
  }
  await harness.agentRegistry.handleMessage(id, { t: 'agent.telemetry', telemetry })
  const rows = await harness.db.machines.listAgents(harness.U)
  const expected = JSON.parse(JSON.stringify(rows.map(a => ({
    ...a,
    online: a.id === id,
    version: a.id === id ? '0.25.0' : undefined,
    telemetry: a.id === id ? telemetry : undefined,
    imageHost: a.id === id ? imageHost : undefined,
    updateStatus: a.id === id ? ownResult : offlineResult
  }))))
  await withFeed(async frames => {
    expect(frames[0]).toEqual(expected)
    expect(frames[0]!.some(a => a.id === foreign)).toBe(false)
    await report(foreign, 'rolled_back', 'private change', 1700000000400)
    await vi.waitFor(() => expect(frames).toHaveLength(2))
    expect(frames[1]).toEqual(expected)
  })
})

it('delivers an empty list initially and after an unrelated registry change', async () => {
  await withFeed(async frames => {
    expect(frames[0]).toEqual([])
    harness.agentRegistry.register('unowned', 'Unowned', { send: vi.fn(), close: vi.fn() })
    await vi.waitFor(() => expect(frames).toHaveLength(2))
    expect(frames[1]).toEqual([])
  })
})

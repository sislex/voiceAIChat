import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import { VoiceChatDb } from '../db/database.js'
import { AgentRegistry, type AgentSocket } from './registry.js'
import { LinkManager } from './linkManager.js'
import type { EnvironmentLinkInput } from '../db/repos/environments.js'
import { registerMachinesInternalApi } from '../machines/internalApi.js'
import { HttpMachines } from '../machinesBridge/httpMachines.js'

describe('persistent environment links', () => {
  let db: VoiceChatDb
  let agents: AgentRegistry
  let manager: LinkManager
  let input: EnvironmentLinkInput
  const sent: Record<string, Array<Record<string, unknown>>> = {}
  function connect(id: string, version = '0.21.0') {
    sent[id] ??= []
    const socket: AgentSocket = {
      close() {},
      send(raw) {
        const message = JSON.parse(raw)
        sent[id]!.push(message)
        if (message.t === 'tunnel.listen') queueMicrotask(() => {
          void agents.handleMessage(id, { t: 'tunnel.listening', tunnelId: message.tunnelId, port: message.port })
        })
      }
    }
    agents.register(id, id, socket, undefined, version)
  }
  beforeEach(async () => {
    db = new VoiceChatDb(':memory:')
    await db.ready
    await db.identity.createUser('owner', randomUUID(), 'developer')
    const project = await db.projects.createProject('owner', { name: 'Links' })
    await db.environments.upsertEnvironment('owner', project.id, { id: 'stage', name: 'Stage', machines: ['server'], checkoutPath: '/stage' })
    input = { projectId: project.id, environmentId: 'stage', clientMachineId: 'client', serverMachineId: 'server', servicePort: 5432, listenerPort: 17001 }
    sent.client = []; sent.server = []
    agents = new AgentRegistry()
    connect('client'); connect('server')
    manager = new LinkManager(db.environments, agents)
    agents.linkManager = manager
    await manager.start()
  })
  afterEach(async () => { vi.useRealTimers(); await manager?.stop(); await db?.close() })

  it('authorizes data frames from a short cache instead of reading the database per frame', async () => {
    const link = await manager.ensureLink(input)
    await agents.handleMessage('client', { t: 'tunnel.open', tunnelId: link.id, connectionId: 'c1' })
    const reads = vi.spyOn(db.environments, 'authorizeLink')
    for (let i = 0; i < 20; i++) await agents.handleMessage('server', { t: 'tunnel.data', tunnelId: link.id, connectionId: 'c1', data: 'YWJj' })
    expect(reads.mock.calls.length).toBeLessThanOrEqual(1)
    expect(sent.client.filter(m => m.t === 'tunnel.data')).toHaveLength(20)
  })

  it('opens a fixed docker listener, relays traffic, has no idle TTL and deletes', async () => {
    const link = await manager.ensureLink(input)
    expect(link.state).toBe('open')
    expect(sent.client).toContainEqual({ t: 'tunnel.listen', tunnelId: link.id, host: 'docker-host', port: 17001 })
    expect(await manager.ensureLink(input)).toEqual(link)
    expect(sent.client.filter(m => m.t === 'tunnel.listen')).toHaveLength(1)
    await agents.handleMessage('client', { t: 'tunnel.open', tunnelId: link.id, connectionId: 'connection' })
    expect(sent.server).toContainEqual({ t: 'tunnel.connect', tunnelId: link.id, connectionId: 'connection', port: 5432 })
    vi.useFakeTimers()
    await agents.handleMessage('server', { t: 'tunnel.data', tunnelId: link.id, connectionId: 'connection', data: 'YWJj' })
    await vi.advanceTimersByTimeAsync(31 * 60_000)
    expect(agents.tunnelPort(link.id)).toBe(17001)
    vi.useRealTimers()
    await manager.deleteLink(input.projectId, input.environmentId, link.id)
    expect(await manager.listLinks(input.projectId, input.environmentId)).toEqual([])
    expect(agents.tunnelPort(link.id)).toBeNull()
    expect(sent.server).toContainEqual({ t: 'tunnel.close', tunnelId: link.id })
  })

  it.each(['client', 'server'])('reopens after %s reconnects', async machine => {
    const link = await manager.ensureLink(input)
    agents.unregister(machine)
    await manager.reconcile()
    expect((await manager.listLinks(input.projectId, input.environmentId))[0]?.state).toBe('down')
    connect(machine)
    await manager.reconcile()
    expect((await manager.listLinks(input.projectId, input.environmentId))[0]?.state).toBe('open')
    expect(sent.client.filter(m => m.t === 'tunnel.listen')).toHaveLength(2)
    expect(agents.tunnelPort(link.id)).toBe(17001)
  })

  it('restores persisted links on server startup', async () => {
    const link = await manager.ensureLink(input)
    await manager.stop()
    // Simulate a crash leaving an open marker in durable storage.
    await db.environments.setLinkState(link.id, 'open')
    agents = new AgentRegistry()
    connect('client'); connect('server')
    manager = new LinkManager(db.environments, agents)
    await manager.start()
    expect(agents.tunnelPort(link.id)).toBe(17001)
    expect((await manager.listLinks(input.projectId, input.environmentId))[0]?.state).toBe('open')
  })

  it('denies traffic after the environment is removed', async () => {
    const link = await manager.ensureLink(input)
    await db.environments.setEnvironmentState(input.projectId, input.environmentId, { state: 'removed' })
    await agents.handleMessage('client', { t: 'tunnel.open', tunnelId: link.id, connectionId: 'denied' })
    await manager.reconcile()
    expect(agents.tunnelPort(link.id)).toBeNull()
    expect(sent.server.some(m => m.t === 'tunnel.connect')).toBe(false)
    expect((await manager.listLinks(input.projectId, input.environmentId))[0]?.state).toBe('down')
  })

  it.each(['client', 'server'])('requires 0.21.0 on %s', async machine => {
    connect(machine, '0.20.0')
    await expect(manager.ensureLink(input)).rejects.toThrow('Agent 0.21.0 or newer is required')
    expect(await manager.listLinks(input.projectId, input.environmentId)).toEqual([])
  })

  it('round trips ensure/list/delete through the authenticated machines RPC adapter', async () => {
    const token = randomUUID()
    const app = Fastify()
    await app.register(websocket)
    registerMachinesInternalApi(app, { registry: agents, token })
    const remote = new HttpMachines({
      machinesUrl: 'http://machines.test', token, publish() {},
      fetchImpl: (async (url, options) => {
        const response = await app.inject({ method: 'POST', url: new URL(String(url)).pathname, headers: options?.headers as Record<string, string>, payload: String(options?.body) })
        return new Response(response.body, { status: response.statusCode })
      }) as typeof fetch
    })
    try {
      const link = await remote.ensureLink(input)
      expect(link.state).toBe('open')
      expect(await remote.listLinks(input.projectId, input.environmentId)).toEqual([link])
      await remote.deleteLink(input.projectId, 'other', link.id)
      expect(await remote.listLinks(input.projectId, input.environmentId)).toHaveLength(1)
      await remote.deleteLink(input.projectId, input.environmentId, link.id)
      expect(await remote.listLinks(input.projectId, input.environmentId)).toEqual([])
      connect('server', '0.20.0')
      await expect(remote.ensureLink(input)).rejects.toThrow('Agent 0.21.0 or newer is required')
    } finally { await app.close() }
  })
})

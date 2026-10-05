import { VpnService, type VpnRepository } from '../machines/vpn/service.js'
import { encryptVpnSecret, TailscaleApi, environmentTag, vpnTag } from '../machines/vpn/tailscale.js'
import type { AgentTelemetry, VpnObservation } from '@sislexa/agent-contracts'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import { VoiceChatDb } from '../db/database.js'
import { AgentRegistry, TUNNEL_RELAY_HIGH_WATER_MARK, TUNNEL_RELAY_LOW_WATER_MARK, type AgentSocket } from './registry.js'
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
  const buffered: Record<string, number> = {}
  function connect(id: string, version = '0.21.0') {
    sent[id] ??= []
    const socket: AgentSocket = {
      get bufferedAmount() { return buffered[id] ?? 0 },
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
    sent.client = []; sent.server = []; buffered.client = 0; buffered.server = 0
    agents = new AgentRegistry()
    connect('client'); connect('server')
    manager = new LinkManager(db.environments, agents)
    agents.linkManager = manager
    await manager.start()
  })
  afterEach(async () => { vi.useRealTimers(); await manager?.stop(); await db?.close() })

  function vpnFixture() {
    const tag = environmentTag(input)
    const observations = Object.fromEntries(['client', 'server'].map((id, i) => [id, {
      observedAt: Date.now(), mode: 'off', deviceId: id, tailnet: 'owner.ts.net',
      addresses: ['100.64.0.' + (i + 1)], error: null
    } as VpnObservation]))
    const data = {
      states: {}, grants: [], verifiedAt: Date.now(),
      bindings: Object.fromEntries(Object.entries(observations).map(([id, o]) => [id, { deviceId: id, apiId: id, addresses: o.addresses, approved: false }])),
      environments: { [tag]: { environment: input, tag, machines: ['client', 'server'], ports: [5432], phase: 'applied', appliedAt: Date.now() } }
    }
    const key = 'a'.repeat(64)
    const encryptedSecret = encryptVpnSecret(randomUUID(), key, 'owner')
    const repo: VpnRepository = {
      agentOwnerId: async () => 'owner', listAgents: async () => [],
      readVpnNetwork: async owner => owner === 'owner' ? { tailnet: 'owner.ts.net', encryptedSecret, generation: 1, state: JSON.stringify(data) } : null,
      saveVpnNetwork: async (_owner, row) => { Object.assign(data, JSON.parse(row.state)); return true }
    }
    const api = new TailscaleApi(randomUUID(), 'owner.ts.net')
    vi.spyOn(api, 'devices').mockResolvedValue(Object.entries(observations).map(([id, o]) => ({ id, nodeId: id, authorized: true, addresses: o.addresses, tags: [tag] })))
    vi.spyOn(api, 'policy').mockResolvedValue({ value: {
      grants: [],
      tagOwners: Object.fromEntries([tag, ...Object.keys(observations).map(vpnTag)].map(t => [t, ['autogroup:admin']]))
    }, etag: '1' })
    vi.spyOn(api, 'setPolicy').mockResolvedValue(undefined)
    vi.spyOn(api, 'setDeviceTags').mockResolvedValue(undefined)
    agents.vpnService = new VpnService(repo, agents, () => key, () => api)
    const publish = async () => {
      for (const id of ['client', 'server']) await agents.handleMessage(id, { t: 'agent.telemetry', telemetry: { vpn: observations[id] } as AgentTelemetry })
      await manager.reconcile()
    }
    return { data, observations, publish, repo, api }
  }

  it('selects a persisted VPN address without opening a tunnel and removes the link', async () => {
    const vpn = vpnFixture()
    await vpn.publish()
    const link = await manager.ensureLink(input)
    expect(link).toMatchObject({ transport: 'vpn', address: '100.64.0.2:5432', state: 'open' })
    expect(sent.client.some(m => m.t === 'tunnel.listen')).toBe(false)
    await db.environments.setEnvironmentState(input.projectId, input.environmentId, { state: 'removed' })
    await manager.reconcile()
    expect((await manager.listLinks(input.projectId, input.environmentId))[0]?.state).toBe('down')
    await manager.deleteLink(input.projectId, input.environmentId, link.id)
    expect(await manager.listLinks(input.projectId, input.environmentId)).toEqual([])
  })

  it.each(['client', 'server'])('switches both ways when %s reconnects with or without VPN', async machine => {
    const vpn = vpnFixture()
    await vpn.publish()
    const link = await manager.ensureLink(input)
    agents.unregister(machine)
    connect(machine)
    await manager.reconcile()
    expect((await manager.listLinks(input.projectId, input.environmentId))[0]).toMatchObject({ transport: 'tunnel', address: 'host.docker.internal:17001', state: 'open' })
    expect(agents.tunnelPort(link.id)).toBe(17001)
    await vpn.publish()
    await manager.reconcile()
    expect((await manager.listLinks(input.projectId, input.environmentId))[0]).toMatchObject({ transport: 'vpn', state: 'open' })
    expect(agents.tunnelPort(link.id)).toBeNull()
  })

  it('reconciles grant removal and application automatically through the VPN service', async () => {
    const vpn = vpnFixture()
    await vpn.publish()
    const link = await manager.ensureLink(input)
    await agents.removeEnvironmentGrant('owner', input)
    for (const id of ['client', 'server']) {
      expect(vpn.api.setDeviceTags).toHaveBeenCalledWith(expect.objectContaining({ id }), [vpnTag(id)])
    }
    await vi.waitFor(async () => {
      expect((await manager.listLinks(input.projectId, input.environmentId))[0]?.transport).toBe('tunnel')
    })
    await agents.ensureEnvironmentGrant('owner', input, ['client', 'server'], [5432])
    await vi.waitFor(async () => {
      expect((await manager.listLinks(input.projectId, input.environmentId))[0]).toMatchObject({ transport: 'vpn', state: 'open' })
    })
    expect(agents.tunnelPort(link.id)).toBeNull()
  })

  it('rejects a machine owned outside the project owner network', async () => {
    const vpn = vpnFixture()
    vpn.repo.agentOwnerId = async id => id === 'client' ? 'foreign' : 'owner'
    await vpn.publish()
    expect((await manager.ensureLink(input)).transport).toBe('tunnel')
  })

  it.each(['port', 'grant', 'tailnet', 'binding', 'stale', 'ipv6'])('falls back when VPN eligibility fails: %s', async reason => {
    const vpn = vpnFixture()
    const grant = vpn.data.environments[environmentTag(input)]
    if (reason === 'port') grant.ports = [80]
    if (reason === 'grant') grant.phase = 'error'
    if (reason === 'tailnet') vpn.observations.client.tailnet = 'foreign.ts.net'
    if (reason === 'binding') vpn.observations.client.deviceId = 'foreign'
    if (reason === 'stale') vpn.observations.client.observedAt = 1
    if (reason === 'ipv6') vpn.observations.server.addresses = ['fd7a:115c:a1e0::1']
    await vpn.publish()
    expect(await manager.ensureLink(input)).toMatchObject({ transport: 'tunnel', address: 'host.docker.internal:17001' })
  })

  it('authorizes data frames from a short cache instead of reading the database per frame', async () => {
    const link = await manager.ensureLink(input)
    await agents.handleMessage('client', { t: 'tunnel.open', tunnelId: link.id, connectionId: 'c1' })
    const reads = vi.spyOn(db.environments, 'authorizeLink')
    for (let i = 0; i < 20; i++) await agents.handleMessage('server', { t: 'tunnel.data', tunnelId: link.id, connectionId: 'c1', data: 'YWJj' })
    expect(reads.mock.calls.length).toBeLessThanOrEqual(1)
    expect(sent.client.filter(m => m.t === 'tunnel.data')).toHaveLength(20)
  })

  it('keeps tunnel frames in order when authorization of tunnel.open is slower than a cached data frame', async () => {
    const link = await manager.ensureLink(input)
    const original = db.environments.authorizeLink.bind(db.environments)
    // tunnel.open always reads the database; make that read slow so a cached data frame could overtake it.
    vi.spyOn(db.environments, 'authorizeLink').mockImplementation(async id => { await new Promise(resolve => setTimeout(resolve, 50)); return original(id) })
    const open = agents.handleMessage('client', { t: 'tunnel.open', tunnelId: link.id, connectionId: 'c1' })
    const data = agents.handleMessage('client', { t: 'tunnel.data', tunnelId: link.id, connectionId: 'c1', data: 'R0VU' })
    await Promise.all([open, data])
    const toServer = sent.server.filter(m => m.connectionId === 'c1').map(m => m.t)
    expect(toServer).toEqual(['tunnel.connect', 'tunnel.data'])
  })

  it('relays agent backpressure frames to the other side of the link', async () => {
    const link = await manager.ensureLink(input)
    await agents.handleMessage('client', { t: 'tunnel.open', tunnelId: link.id, connectionId: 'c1' })
    await agents.handleMessage('server', { t: 'tunnel.pause', tunnelId: link.id, connectionId: 'c1' } as never)
    await agents.handleMessage('client', { t: 'tunnel.resume', tunnelId: link.id, connectionId: 'c1' } as never)
    expect(sent.client).toContainEqual({ t: 'tunnel.pause', tunnelId: link.id, connectionId: 'c1' })
    expect(sent.server).toContainEqual({ t: 'tunnel.resume', tunnelId: link.id, connectionId: 'c1' })
  })

  it('pauses a fast producer while the consumer socket is backlogged and resumes it after drain', async () => {
    const link = await manager.ensureLink(input)
    await agents.handleMessage('client', { t: 'tunnel.open', tunnelId: link.id, connectionId: 'c1' })
    vi.useFakeTimers()
    const flow = (side: 'client' | 'server') => sent[side]!.filter(m => m.t === 'tunnel.pause' || m.t === 'tunnel.resume').map(m => m.t)
    await agents.handleMessage('server', { t: 'tunnel.data', tunnelId: link.id, connectionId: 'c1', data: 'YWJj' })
    expect(flow('server')).toEqual([])
    buffered.client = TUNNEL_RELAY_HIGH_WATER_MARK
    await agents.handleMessage('server', { t: 'tunnel.data', tunnelId: link.id, connectionId: 'c1', data: 'YWJj' })
    await agents.handleMessage('server', { t: 'tunnel.data', tunnelId: link.id, connectionId: 'c1', data: 'YWJj' })
    expect(sent.client.filter(m => m.t === 'tunnel.data')).toHaveLength(3)
    expect(flow('server')).toEqual(['tunnel.pause'])
    // A resume relayed from the consumer agent must not release the producer while Core's backlog stays high.
    await agents.handleMessage('client', { t: 'tunnel.pause', tunnelId: link.id, connectionId: 'c1' } as never)
    await agents.handleMessage('client', { t: 'tunnel.resume', tunnelId: link.id, connectionId: 'c1' } as never)
    await vi.advanceTimersByTimeAsync(200)
    expect(flow('server')).toEqual(['tunnel.pause', 'tunnel.pause'])
    buffered.client = TUNNEL_RELAY_LOW_WATER_MARK
    await vi.advanceTimersByTimeAsync(50)
    expect(flow('server')).toEqual(['tunnel.pause', 'tunnel.pause', 'tunnel.resume'])
    await vi.advanceTimersByTimeAsync(200)
    expect(flow('server')).toHaveLength(3)
  })

  it('keeps a producer paused by the consumer agent when Core drains its own backlog', async () => {
    const link = await manager.ensureLink(input)
    await agents.handleMessage('client', { t: 'tunnel.open', tunnelId: link.id, connectionId: 'c1' })
    vi.useFakeTimers()
    buffered.client = TUNNEL_RELAY_HIGH_WATER_MARK
    await agents.handleMessage('server', { t: 'tunnel.data', tunnelId: link.id, connectionId: 'c1', data: 'YWJj' })
    await agents.handleMessage('client', { t: 'tunnel.pause', tunnelId: link.id, connectionId: 'c1' } as never)
    buffered.client = 0
    await vi.advanceTimersByTimeAsync(100)
    expect(sent.server.filter(m => m.t === 'tunnel.resume')).toEqual([])
    await agents.handleMessage('client', { t: 'tunnel.resume', tunnelId: link.id, connectionId: 'c1' } as never)
    expect(sent.server.filter(m => m.t === 'tunnel.resume')).toHaveLength(1)
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

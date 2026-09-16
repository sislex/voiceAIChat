import { describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { registerVpnRoutes } from './routes.js'
import { type VpnObservation, type VpnChange } from '@voicechat/shared'
import { VpnService, type VpnRepository } from './service.js'
import { TailscaleApi, type TailPolicy } from './tailscale.js'
const command = (mode: 'off' | 'server' | 'client', revision = 0): VpnChange => ({
  mode, gatewayId: mode === 'client' ? 'gateway' : null, allowLan: false,
  operationId: 'operation-' + mode + '-' + revision, expectedRevision: revision
})
function setup() {
  let row: Awaited<ReturnType<VpnRepository['readVpnNetwork']>> = null
  const owners: Record<string, string> = { client: 'alice', gateway: 'alice', foreign: 'bob' }
  const repo: VpnRepository = {
    agentOwnerId: async id => owners[id] ?? null,
    listAgents: async user => Object.keys(owners).filter(id => owners[id] === user).map(id => ({ id, name: id, pinIp: false })),
    readVpnNetwork: async () => row ? structuredClone(row) : null,
    saveVpnNetwork: async (_user, next, expected) => { if ((row?.generation ?? null) !== expected) return false; row = structuredClone(next); return true }
  }
  const devices = ['client', 'gateway'].map((id, i) => ({ id: 'api-' + id, nodeId: 'node-' + id, authorized: true, addresses: ['100.64.0.' + (i + 1)], tags: [] as string[], enabledRoutes: ['0.0.0.0/0', '::/0'] }))
  let policy: TailPolicy = { acls: [] }
  const api = new TailscaleApi('test-secret', 'test.ts.net')
  vi.spyOn(api, 'devices').mockImplementation(async () => devices)
  vi.spyOn(api, 'policy').mockImplementation(async () => ({ value: structuredClone(policy), etag: '"1"' }))
  vi.spyOn(api, 'setPolicy').mockImplementation(async value => { policy = structuredClone(value) })
  vi.spyOn(api, 'prepareExit').mockImplementation(async (device, tag) => { devices.find(d => d.id === device.id)!.tags.push(tag) })
  const states: Record<string, VpnObservation> = Object.fromEntries(devices.map(d => [d.id.slice(4), {
    observedAt: Date.now(), mode: 'off', deviceId: d.nodeId, addresses: d.addresses, tailnet: 'test.ts.net',
    gatewayDeviceId: null, gatewayOnline: null, allowLan: false, externalIp: null,
    protected: false, recoveryReady: true, error: null
  }]))
  const agents = {
    isOnline: () => true,
    vpn: vi.fn(async (id: string, request: import('@voicechat/shared').VpnAgentRequest) => {
      if (request.action === 'apply') states[id] = { ...states[id], mode: request.desired.mode, gatewayDeviceId: request.gatewayDeviceId, revision: request.revision, operationId: request.operationId,
        protected: request.desired.mode === 'client', allowLan: request.desired.allowLan }
      return { ...states[id], observedAt: Date.now() }
    })
  }
  const service = new VpnService(repo, agents, () => 'ab'.repeat(32), () => api)
  return { service, repo, agents, api, states, owners, ciphertext: () => row?.encryptedSecret, policy: () => policy }
}
describe('VPN owner boundary and persistent transitions', () => {
  // @testCase TC-API
  it('enforces owner isolation and safe validation over the HTTP routes', async () => {
    const s = setup(), app = Fastify()
    app.addHook('onRequest', async (request, reply) => {
      if (!request.headers.authorization) return reply.code(401).send({})
      Object.assign(request, { user: { name: request.headers.authorization === 'Bearer alice' ? 'alice' : 'bob' } })
    })
    registerVpnRoutes(app, s.service)
    try {
      expect((await app.inject({ method: 'GET', url: '/api/agents/client/vpn' })).statusCode).toBe(401)
      expect((await app.inject({ method: 'GET', url: '/api/agents/client/vpn', headers: { authorization: 'Bearer bob' } })).statusCode).toBe(404)
      const connected = await app.inject({ method: 'POST', url: '/api/agents/vpn/network', headers: { authorization: 'Bearer alice' },
        payload: { tailnet: 'test.ts.net', secret: 'tskey-http-test-secret' } })
      expect(connected.statusCode).toBe(200)
      expect(connected.body).not.toContain('secret')
      const response = await app.inject({ method: 'PUT', url: '/api/agents/client/vpn', headers: { authorization: 'Bearer alice' },
        payload: { ...command('client'), gatewayId: 'foreign' } })
      expect(response.statusCode).toBe(404)
      expect(s.agents.vpn).not.toHaveBeenCalled()
    } finally { await app.close() }
  })
  // @testCase TC-API
  it('rejects foreign, project-shared, unknown and self gateways before dispatch', async () => {
    const s = setup()
    await s.service.connect('alice', 'test.ts.net', 'tskey-test-secret-123')
    await expect(s.service.change('bob', 'client', command('server'))).rejects.toThrow('invalid')
    await expect(s.service.change('alice', 'client', { ...command('client'), gatewayId: 'foreign' })).rejects.toThrow('invalid')
    await expect(s.service.change('alice', 'client', { ...command('client'), gatewayId: 'missing' })).rejects.toThrow('invalid')
    await expect(s.service.change('alice', 'client', { ...command('client'), gatewayId: 'client' })).rejects.toThrow('invalid')
    expect(s.agents.vpn).not.toHaveBeenCalled()
  })
  // @testCase TC-API
  // @testCase TC-STATE
  it('prepares its own gateway, limits routing with via, rejects cycles and protects dependent clients', async () => {
    const s = setup()
    await s.service.connect('alice', 'test.ts.net', 'tskey-test-secret-123')
    expect((await s.service.change('alice', 'gateway', command('server'))).state.phase).toBe('idle')
    expect(s.api.prepareExit).toHaveBeenCalled()
    const view = await s.service.read('alice', 'client')
    expect(view.gateways).toEqual([{ id: 'gateway', name: 'gateway' }])
    const result = await s.service.change('alice', 'client', command('client'))
    expect(result.state.observed?.mode).toBe('client')
    expect(s.policy().grants).toEqual([expect.objectContaining({ src: ['100.64.0.1'], dst: ['autogroup:internet'], via: [expect.stringMatching(/^tag:chatai-vpn-/)] })])
    await expect(s.service.change('alice', 'gateway', command('off', 1))).rejects.toThrow('conflict')
    await expect(s.service.change('alice', 'gateway', { ...command('client', 1), gatewayId: 'client' })).rejects.toThrow('conflict')
  })
  // @testCase TC-STATE
  it('does not redispatch repeated operations and rejects stale revisions', async () => {
    const s = setup()
    await s.service.connect('alice', 'test.ts.net', 'tskey-test-secret-123')
    await s.service.change('alice', 'gateway', command('server'))
    const calls = s.agents.vpn.mock.calls.length
    await s.service.change('alice', 'gateway', command('server'))
    expect(s.agents.vpn).toHaveBeenCalledTimes(calls)
    await expect(s.service.change('alice', 'gateway', command('off'))).rejects.toThrow('conflict')
  })
  // @testCase TC-STATE
  it('serializes concurrent requests for both endpoints', async () => {
    const s = setup()
    await s.service.connect('alice', 'test.ts.net', 'tskey-test-secret-123')
    const outcomes = await Promise.allSettled([s.service.change('alice', 'gateway', command('server')), s.service.change('alice', 'client', command('server'))])
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter(o => o.status === 'rejected')).toHaveLength(1)
  })
  // @testCase TC-API
  it('revalidates device identity and ownership after gateway preparation', async () => {
    const s = setup()
    await s.service.connect('alice', 'test.ts.net', 'tskey-test-secret-123')
    await s.service.change('alice', 'gateway', command('server'))
    s.states.gateway.deviceId = 'foreign-node'
    await expect(s.service.change('alice', 'client', command('client'))).rejects.toThrow('gateway')
    s.owners.gateway = 'bob'
    await expect(s.service.change('alice', 'client', command('client'))).rejects.toThrow('invalid')
  })
  // @testCase TC-STATE
  it('can explicitly disable after an unresolved operation even with revoked API access', async () => {
    const s = setup()
    await s.service.connect('alice', 'test.ts.net', 'tskey-test-secret-123')
    await s.service.change('alice', 'gateway', command('server'))
    await s.service.change('alice', 'client', command('client'))
    vi.mocked(s.api.devices).mockRejectedValue(new Error('revoked credential'))
    vi.mocked(s.api.policy).mockRejectedValue(new Error('revoked credential'))
    const off = await s.service.change('alice', 'client', command('off', 1))
    expect(off.state.observed?.mode).toBe('off')
    expect(off.state.phase).toBe('idle')
  })
  // @testCase TC-API
  it.each(['client', 'off'] as const)('does not acknowledge %s from an expired apply result', async mode => {
    const s = setup()
    await s.service.connect('alice', 'test.ts.net', 'tskey-test-secret-123')
    await s.service.change('alice', 'gateway', command('server'))
    if (mode === 'off') await s.service.change('alice', 'client', command('client'))
    const dispatch = s.agents.vpn.getMockImplementation()!
    s.agents.vpn.mockImplementation(async (id, request) => {
      const observation = await dispatch(id, request)
      return request.action === 'apply' ? { ...observation, observedAt: Date.now() - 100_000 } : observation
    })
    const result = await s.service.change('alice', 'client', command(mode, mode === 'off' ? 1 : 0))
    expect(result.state.desired.mode).toBe(mode)
    expect(result.state.phase).toBe('error')
    expect(result.state.error).toBe('apply')
  })
  // @testCase TC-API
  it('blocks activation when client readiness is stale', async () => {
    const s = setup()
    await s.service.connect('alice', 'test.ts.net', 'tskey-test-secret-123')
    await s.service.change('alice', 'gateway', command('server'))
    s.agents.vpn.mockImplementation(async id => ({ ...s.states[id], observedAt: Date.now() - 100_000 }))
    s.agents.vpn.mockClear()
    await expect(s.service.change('alice', 'client', command('client'))).rejects.toThrow('apply')
    expect(s.agents.vpn.mock.calls.every(([, request]) => request.action === 'inspect')).toBe(true)
  })
  // @testCase TC-ISOLATION
  it('rejects a gateway whose ownership changes without dispatching any client configuration', async () => {
    const s = setup()
    await s.service.connect('alice', 'test.ts.net', 'tskey-test-secret-123')
    await s.service.change('alice', 'gateway', command('server'))
    s.owners.gateway = 'bob'
    s.agents.vpn.mockClear()
    await expect(s.service.change('alice', 'client', command('client'))).rejects.toThrow('invalid')
    expect(s.agents.vpn).not.toHaveBeenCalled()
    expect((await s.repo.readVpnNetwork('alice'))?.state).not.toContain('"mode":"client"')
  })
  // @testCase TC-MIGRATION
  it('preserves the active legacy network when replacement is attempted', async () => {
    const s = setup()
    await s.service.connect('alice', 'test.ts.net', 'tskey-test-secret-123')
    await s.service.change('alice', 'gateway', command('server'))
    await s.service.change('alice', 'client', command('client'))
    const before = await s.repo.readVpnNetwork('alice')
    s.agents.vpn.mockClear()
    vi.mocked(s.api.setPolicy).mockClear()
    await expect(s.service.connect('alice', 'different.ts.net', 'tskey-replacement-secret')).rejects.toThrow('conflict')
    expect(await s.repo.readVpnNetwork('alice')).toEqual(before)
    expect(s.agents.vpn).not.toHaveBeenCalled()
    expect(s.api.setPolicy).not.toHaveBeenCalled()
  })
  // @testCase TC-API
  // @testCase TC-ISOLATION
  it('rejects foreign HTTP writes without changing stored state or upstream policy', async () => {
    const s = setup(), app = Fastify()
    await s.service.connect('alice', 'test.ts.net', 'tskey-test-secret-123')
    const before = await s.repo.readVpnNetwork('alice')
    vi.mocked(s.api.setPolicy).mockClear()
    app.addHook('onRequest', async request => { Object.assign(request, { user: { name: 'bob' } }) })
    registerVpnRoutes(app, s.service)
    try {
      const response = await app.inject({ method: 'PUT', url: '/api/agents/client/vpn', payload: command('server') })
      expect(response.statusCode).toBe(404)
      expect(await s.repo.readVpnNetwork('alice')).toEqual(before)
      expect(s.agents.vpn).not.toHaveBeenCalled()
      expect(s.api.setPolicy).not.toHaveBeenCalled()
    } finally { await app.close() }
  })
  // @testCase TC-MIGRATION
  it('preserves active state and bindings when renewing credentials for the same network', async () => {
    const s = setup()
    await s.service.connect('alice', 'test.ts.net', 'tskey-test-secret-123')
    await s.service.change('alice', 'gateway', command('server'))
    await s.service.change('alice', 'client', command('client'))
    const before = (await s.repo.readVpnNetwork('alice'))!
    const policy = structuredClone(s.policy())
    s.agents.vpn.mockClear()
    await s.service.connect('alice', 'test.ts.net', 'tskey-renewed-secret-123')
    const after = (await s.repo.readVpnNetwork('alice'))!
    expect(JSON.parse(after.state)).toMatchObject({
      states: JSON.parse(before.state).states,
      bindings: JSON.parse(before.state).bindings,
      grants: JSON.parse(before.state).grants
    })
    expect(after.generation).toBe(before.generation + 1)
    expect(after.encryptedSecret).not.toBe(before.encryptedSecret)
    expect(after.encryptedSecret).not.toContain('tskey-renewed-secret-123')
    expect(s.policy()).toEqual(policy)
    expect(s.agents.vpn).not.toHaveBeenCalled()
  })
  // @testCase TC-SECRETS
  it('never returns a credential in successful DTOs or failed observations', async () => {
    const s = setup(), secret = 'tskey-secret-never-in-dto'
    await s.service.connect('alice', 'test.ts.net', secret)
    expect(s.ciphertext()).not.toContain(secret)
    s.agents.vpn.mockRejectedValueOnce(new Error(secret))
    expect(JSON.stringify(await s.service.read('alice', 'client'))).not.toContain(secret)
  })
})

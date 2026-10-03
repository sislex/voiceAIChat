import { randomBytes } from 'node:crypto'
import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import { describe, expect, it, vi } from 'vitest'
import { AgentRegistry } from '../../agents/registry.js'
import { registerMachinesInternalApi } from '../internalApi.js'
import { HttpMachines } from '../../machinesBridge/httpMachines.js'
import { createKanbanCoreRpcDispatcher } from '../../kanbanBridge/internal.js'
import type { KanbanCore } from '../../kanban/core.js'
import type { VpnService } from './service.js'

const fixtureCredential1 = randomBytes(24).toString('hex')


describe('environment VPN RPC adapters', () => {
  it('carries grant operations through the HTTP machines adapter and Kanban dispatcher', async () => {
    const environment = { projectId: 'project', environmentId: 'test' }
    const state = { environment, tag: 'tag:chatai-env-test', machines: ['worker'], ports: [443], phase: 'applied', appliedAt: 1 }
    const vpn = { ensureEnvironmentGrant: vi.fn(async () => state), removeEnvironmentGrant: vi.fn(async () => ({ ...state, phase: 'removed' })), environmentGrantState: vi.fn(async () => state) }
    const registry = new AgentRegistry()
    registry.vpnService = vpn as unknown as VpnService
    const app = Fastify()
    await app.register(websocket)
    registerMachinesInternalApi(app, { registry, token: fixtureCredential1 })
    const fetchImpl: typeof fetch = async (_url, init) => {
      const response = await app.inject({ method: 'POST', url: '/internal/machines/rpc',
        headers: { authorization: `Bearer ${fixtureCredential1}`, 'content-type': 'application/json' }, payload: String(init?.body) })
      return new Response(response.body, { status: response.statusCode, headers: { 'content-type': 'application/json' } })
    }
    const machines = new HttpMachines({ machinesUrl: 'http://machines.invalid', token: fixtureCredential1, publish: () => {}, fetchImpl })
    const dispatch = createKanbanCoreRpcDispatcher({ core: { machines } as unknown as KanbanCore, machinesSnapshot: () => [],
      tunnels: { authorize: async () => false, closed: async () => {} } })
    try {
      expect(await dispatch({ method: 'machines.ensureEnvironmentGrant', args: ['owner', environment, ['worker'], [443]] })).toEqual(state)
      expect(vpn.ensureEnvironmentGrant).toHaveBeenCalledWith('owner', environment, ['worker'], [443])
      expect(await dispatch({ method: 'machines.environmentGrantState', args: ['owner', environment] })).toEqual(state)
      expect(await dispatch({ method: 'machines.removeEnvironmentGrant', args: ['owner', environment] })).toMatchObject({ phase: 'removed' })
      expect(await dispatch({ method: 'machines.vpnAddressOf', args: ['offline'] })).toBeNull()
      expect((await app.inject({ method: 'POST', url: '/internal/machines/rpc', payload: { method: 'environmentGrantState', args: ['owner', environment] } })).statusCode).toBe(401)
    } finally { machines.stop(); await app.close() }
  })
})

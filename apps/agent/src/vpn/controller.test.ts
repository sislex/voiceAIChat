import { describe, expect, it, vi } from 'vitest'
import type { VpnAgentRequest, VpnObservation } from '@voicechat/shared'
import { VpnController, unknownVpn, type VpnJournal } from './controller.js'
const request = (revision: number, mode: 'client' | 'off' = 'client'): Extract<VpnAgentRequest, { action: 'apply' }> =>
  ({ action: 'apply', revision, operationId: 'operation-' + revision, deviceId: 'node1', gatewayDeviceId: mode === 'client' ? 'node2' : null,
    desired: { mode, gatewayId: mode === 'client' ? 'machine2' : null, allowLan: false } })
function setup() {
  let observed: VpnObservation = { ...unknownVpn('guard'), mode: 'off', error: null, deviceId: 'node1', recoveryReady: true }
  let entry: Awaited<ReturnType<VpnJournal['read']>> = null
  const journal = { read: async () => entry, write: async (value: Parameters<VpnJournal['write']>[0]) => { entry = value } }
  const events: string[] = []
  const system = {
    inspect: vi.fn(async () => ({ ...observed })),
    protect: vi.fn(async () => { events.push('arm'); observed.protected = true }),
    set: vi.fn(async (r: Extract<VpnAgentRequest, { action: 'apply' }>) => {
      events.push(r.desired.mode); observed = { ...observed, mode: r.desired.mode, gatewayDeviceId: r.gatewayDeviceId }
    }),
    release: vi.fn(async () => { events.push('release'); observed.protected = false })
  }
  return { system, journal, events, controller: new VpnController(system, journal), patch: (p: Partial<VpnObservation>) => { observed = { ...observed, ...p } } }
}
describe('serialized system VPN', () => {
  // @testCase TC-STATE
  it('arms before changing routes, serializes off, and restores only after observation', async () => {
    const s = setup()
    await Promise.all([s.controller.handle(request(1)), s.controller.handle(request(2, 'off'))])
    expect(s.events).toEqual(['arm', 'client', 'off', 'release'])
  })
  // @testCase TC-STATE
  it('reconciles repeated delivery after restart and rejects older or conflicting revisions', async () => {
    const s = setup()
    await s.controller.handle(request(2))
    const restarted = new VpnController(s.system, s.journal)
    await restarted.handle(request(2))
    expect(s.system.set).toHaveBeenCalledTimes(1)
    expect((await restarted.handle(request(1))).error).toBe('conflict')
    expect((await restarted.handle({ ...request(2), operationId: 'different-op' })).error).toBe('conflict')
  })
  // @testCase TC-STATE
  // @testCase TC-SECRETS
  it('retains protection on a partial failure without echoing CLI secrets', async () => {
    const s = setup()
    s.system.set.mockRejectedValue(new Error('tskey-test-secret https://login.tailscale.com/secret'))
    const result = await s.controller.handle(request(1))
    expect(s.system.release).not.toHaveBeenCalled()
    expect(result.protected).toBe(true)
    expect(result.error).toBe('apply')
    expect(JSON.stringify(result)).not.toContain('secret')
  })
  // @testCase TC-STATE
  it('refuses client routing without a recovery channel or a matching bound identity', async () => {
    const s = setup()
    s.patch({ recoveryReady: false })
    expect((await s.controller.handle(request(1))).error).toBe('guard')
    s.patch({ deviceId: 'other' })
    expect((await s.controller.handle(request(1))).error).toBe('binding')
    expect(s.system.set).not.toHaveBeenCalled()
    expect(s.system.protect).not.toHaveBeenCalled()
  })
})

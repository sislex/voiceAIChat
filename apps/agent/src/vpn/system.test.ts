import { describe, expect, it, vi } from 'vitest'
import { TailscaleSystem } from './system.js'
describe('Tailscale system observation', () => {
  // @testCase TC-STATE
  it.each(['linux', 'darwin'] as const)('reports unavailable gateways and keeps protected state on %s', async platform => {
    const run = vi.fn(async (args: string[]) => JSON.stringify(args[0] === 'status'
      ? { Version: '1.88.0', BackendState: 'Running', Self: { ID: 'node1', TailscaleIPs: ['100.64.0.1'] }, CurrentTailnet: { Name: 'test.ts.net' }, ExitNodeStatus: { ID: 'node2', Online: false } }
      : { ExitNodeID: 'node2' }))
    const guard = { status: async () => ({ protected: true, recoveryReady: true, allowLan: false }), arm: vi.fn(), release: vi.fn() }
    const ip = vi.fn(async () => '203.0.113.1')
    const system = new TailscaleSystem(run, guard, platform, ip)
    expect(await system.inspect()).toMatchObject({ mode: 'client', protected: true, gatewayOnline: false, externalIp: null })
    expect(ip).not.toHaveBeenCalled()
    expect(guard.release).not.toHaveBeenCalled()
  })
  // @testCase TC-STATE
  it('gives a concrete preparation state for missing CLI, missing permission and unsupported OS', async () => {
    const run = vi.fn().mockRejectedValue({ code: 'ENOENT' })
    const guard = { status: vi.fn(), arm: vi.fn(), release: vi.fn() }
    expect((await new TailscaleSystem(run, guard, 'linux').inspect()).error).toBe('not_installed')
    expect((await new TailscaleSystem(run, guard, 'win32').inspect()).error).toBe('unsupported')
    run.mockResolvedValueOnce(JSON.stringify({ Version: '1.88.0', BackendState: 'Running' })).mockRejectedValueOnce({ code: 'EACCES' })
    expect((await new TailscaleSystem(run, guard, 'darwin').inspect()).error).toBe('permission')
  })
})

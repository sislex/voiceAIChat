import { describe, expect, it, vi } from 'vitest'
import { TailscaleSystem } from './system.js'
describe('Tailscale system observation', () => {
  // @testCase TC-NETWORK
  // This checks preparation failures, not real-host connectivity or WireGuard support.
  it.each([
    ['linux', 'not_installed'],
    ['darwin', 'not_installed'],
    ['win32', 'unsupported']
  ] as const)('does not activate or report an external IP when %s preparation fails', async (platform, error) => {
    const run = vi.fn().mockRejectedValue({ code: 'ENOENT' })
    const guard = { status: vi.fn(), arm: vi.fn(), release: vi.fn() }
    const ip = vi.fn()
    const observed = await new TailscaleSystem(run, guard, platform, ip).inspect()
    expect(observed).toMatchObject({ mode: 'unknown', error, externalIp: null,
      protected: false, recoveryReady: false })
    expect(guard.arm).not.toHaveBeenCalled()
    expect(guard.release).not.toHaveBeenCalled()
    expect(ip).not.toHaveBeenCalled()
    expect(run.mock.calls.every(([args]) => args[0] === 'status')).toBe(true)
    if (platform === 'win32') expect(run).not.toHaveBeenCalled()
  })

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
  // @testCase TC-NETWORK
  it.each(['linux', 'darwin'] as const)('does not probe a direct IP when the protection helper fails on %s', async platform => {
    const run = vi.fn(async (args: string[]) => JSON.stringify(args[0] === 'status'
      ? { Version: '1.88.0', BackendState: 'Running', Self: { ID: 'node1', TailscaleIPs: ['100.64.0.1'] },
        CurrentTailnet: { Name: 'test.ts.net' }, ExitNodeStatus: { ID: 'node2', Online: true } }
      : { ExitNodeID: 'node2' }))
    const guard = { status: vi.fn().mockRejectedValue(new Error('helper unavailable')), arm: vi.fn(), release: vi.fn() }
    const ip = vi.fn(async () => '203.0.113.1')
    const observed = await new TailscaleSystem(run, guard, platform, ip).inspect()
    expect(observed).toMatchObject({ mode: 'client', gatewayOnline: true, error: 'guard',
      protected: false, recoveryReady: false, externalIp: null })
    expect(ip).not.toHaveBeenCalled()
    expect(guard.arm).not.toHaveBeenCalled()
    expect(guard.release).not.toHaveBeenCalled()
    expect(run.mock.calls.map(([args]) => args)).toEqual([['status', '--json'], ['debug', 'prefs']])
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

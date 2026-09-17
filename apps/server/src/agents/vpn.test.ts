import { describe, expect, it, vi } from 'vitest'
import { AGENT_VERSION, sanitizeVpnObservation } from '@voicechat/shared'
import { AgentRegistry } from './registry.js'
describe('dedicated VPN transport', () => {
  // @testCase TC-STATE
  // @testCase TC-SECRETS
  it('correlates replies to both agent and request without emitting command logs', async () => {
    const registry = new AgentRegistry(), send = vi.fn(), logged = vi.fn()
    registry.register('owner-machine', 'machine', { send, close: vi.fn() }, undefined, AGENT_VERSION)
    registry.onCommand(logged)
    const result = registry.vpn('owner-machine', { action: 'inspect' })
    const request = JSON.parse(send.mock.calls[0][0]) as { t: string; requestId: string }
    expect(request.t).toBe('vpn.request')
    const observation = sanitizeVpnObservation({ observedAt: Date.now(), mode: 'off' })!
    let settled = false
    void result.then(() => { settled = true })
    await registry.handleMessage('foreign-machine', { t: 'vpn.result', requestId: request.requestId, observation })
    await Promise.resolve()
    expect(settled).toBe(false)
    await registry.handleMessage('owner-machine', { t: 'vpn.result', requestId: request.requestId, observation })
    expect(await result).toEqual(observation)
    expect(logged).not.toHaveBeenCalled()
    registry.unregister('owner-machine')
  })
  // @testCase TC-STATE
  it('rejects old agents and terminates an outstanding request on disconnect', async () => {
    const registry = new AgentRegistry(), socket = { send: vi.fn(), close: vi.fn() }
    registry.register('old', 'old', socket, undefined, '0.17.0')
    await expect(registry.vpn('old', { action: 'inspect' })).rejects.toThrow('unsupported')
    expect(socket.send).not.toHaveBeenCalled()
    registry.register('new', 'new', socket, undefined, AGENT_VERSION)
    const result = registry.vpn('new', { action: 'inspect' })
    const rejected = expect(result).rejects.toThrow('offline')
    registry.unregister('new')
    await rejected
    registry.unregister('old')
  })
})

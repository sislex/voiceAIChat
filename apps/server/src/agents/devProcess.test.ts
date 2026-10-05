import { describe, expect, it, vi } from 'vitest'
import { AGENT_VERSION, type AgentToServer } from '@sislexa/agent-contracts'
import { AgentRegistry } from './registry.js'

const target = { standId: 'stand', component: 'make' as const }
const answer = (registry: AgentRegistry, agentId: string, msg: unknown) => registry.handleMessage(agentId, msg as AgentToServer)

describe('dev process forwarding', () => {
  it('sends the request to the agent and resolves only on the matching result from the same agent', async () => {
    const registry = new AgentRegistry(), send = vi.fn()
    registry.register('m1', 'M1', { send, close: vi.fn() }, undefined, AGENT_VERSION)
    const result = registry.devProcess('m1', 'devProcess.status', target)
    const request = JSON.parse(send.mock.calls[0][0]) as { t: string; requestId: string; standId: string }
    expect(request).toMatchObject({ t: 'devProcess.status', standId: 'stand', component: 'make' })
    const status = { ...target, state: 'ready' }
    await answer(registry, 'other', { t: 'devProcess.status.result', requestId: request.requestId, result: status })
    await answer(registry, 'm1', { t: 'devProcess.status.result', requestId: request.requestId, result: status })
    expect(await result).toEqual(status)
    registry.unregister('m1')
  })

  it('maps agent errors to a code-prefixed message and rejects pending requests when the agent leaves', async () => {
    const registry = new AgentRegistry(), send = vi.fn()
    registry.register('m1', 'M1', { send, close: vi.fn() }, undefined, AGENT_VERSION)
    const failing = registry.devProcess('m1', 'devProcess.stop', target)
    const { requestId } = JSON.parse(send.mock.calls[0][0]) as { requestId: string }
    await answer(registry, 'm1', { t: 'devProcess.error', requestId, method: 'devProcess.stop', code: 'process_stop_failed', message: 'still running' })
    await expect(failing).rejects.toThrow('process_stop_failed: still running')
    const pending = registry.devProcess('m1', 'devProcess.logs', target)
    registry.unregister('m1')
    await expect(pending).rejects.toThrow(/^machine_unavailable/)
    await expect(registry.devProcess('m1', 'devProcess.status', target)).rejects.toThrow(/^machine_unavailable/)
  })
})

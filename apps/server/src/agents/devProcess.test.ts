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

  it('expands the owner/name repository shorthand into a GitHub clone URL for the agent', () => {
    const registry = new AgentRegistry(), send = vi.fn()
    registry.register('m1', 'M1', { send, close: vi.fn() }, undefined, AGENT_VERSION)
    const start = { ...target, sha: 'a'.repeat(40), command: ['npm', 'run', 'dev:component'] as [string, ...string[]], env: {}, port: 23001 }
    void registry.devProcess('m1', 'devProcess.start', { ...start, repository: 'sislex/voiceAIChat' }).catch(() => undefined)
    void registry.devProcess('m1', 'devProcess.start', { ...start, repository: 'https://github.com/sislex/make.git' }).catch(() => undefined)
    void registry.devProcess('m1', 'devProcess.start', { ...start, repository: './local/checkout' }).catch(() => undefined)
    expect(send.mock.calls.map(call => (JSON.parse(call[0]) as { repository: string }).repository))
      .toEqual(['https://github.com/sislex/voiceAIChat.git', 'https://github.com/sislex/make.git', './local/checkout'])
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

  it('ignores dev stand recovery events without disturbing pending requests', async () => {
    const registry = new AgentRegistry(), send = vi.fn()
    registry.register('m1', 'M1', { send, close: vi.fn() }, undefined, AGENT_VERSION)
    const result = registry.devProcess('m1', 'devProcess.status', target)
    const { requestId } = JSON.parse(send.mock.calls[0][0]) as { requestId: string }
    await answer(registry, 'm1', { t: 'devProcess.recovered', ...target, url: 'http://127.0.0.1:23001' })
    await answer(registry, 'm1', { t: 'devProcess.recoveryFailed', ...target, url: 'http://127.0.0.1:23001', message: 'port busy' })
    const status = { ...target, state: 'ready' }
    await answer(registry, 'm1', { t: 'devProcess.status.result', requestId, result: status })
    expect(await result).toEqual(status)
    registry.unregister('m1')
  })
})

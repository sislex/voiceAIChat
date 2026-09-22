import { describe, expect, it, vi } from 'vitest'
import { unconfiguredLlmClient, unconfiguredLoginStatus, RUNNER_NOT_CONFIGURED } from './unconfigured.js'

describe('Core without an LLM service', () => {
  it('reports unavailable authentication and fails a model turn explicitly', async () => {
    expect(unconfiguredLoginStatus()).toMatchObject({ claude: { loggedIn: false }, codex: { loggedIn: false } })
    const handlers = { onError: vi.fn(), onDone: vi.fn(), onDelta: vi.fn(), onSession: vi.fn() }
    unconfiguredLlmClient().send({ prompt: 'hello', sessionId: null, model: 'sonnet' }, handlers)
    await Promise.resolve()
    expect(handlers.onError).toHaveBeenCalledWith(RUNNER_NOT_CONFIGURED)
    expect(handlers.onDone).not.toHaveBeenCalled()
  })
  it('suppresses a queued error when the host cancels immediately', async () => {
    const handlers = { onError: vi.fn(), onDone: vi.fn(), onDelta: vi.fn(), onSession: vi.fn() }
    unconfiguredLlmClient().send({ prompt: 'hello', sessionId: null, model: 'sonnet' }, handlers).cancel()
    await Promise.resolve()
    expect(handlers.onError).not.toHaveBeenCalled()
  })
})

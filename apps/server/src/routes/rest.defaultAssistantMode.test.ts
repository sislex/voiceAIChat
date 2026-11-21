// A chat-only deployment (VC_DEFAULT_ASSISTANT_MODE=chat) starts ordinary conversations in Chat.
import { describe, expect, it } from 'vitest'
import { setupRestHarness } from './restHarness.js'

const harness = setupRestHarness({ env: { VC_DEFAULT_ASSISTANT_MODE: 'chat' } })

describe('REST: default assistant mode', () => {
  it('creates ordinary conversations in Chat and keeps Make conversations unchanged', async () => {
    const plain = await harness.inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Plain' } })
    expect(plain.statusCode).toBe(200)
    expect(plain.json().assistantMode).toBe('chat')
    const draft = await harness.inj({ method: 'POST', url: '/api/conversations/draft', payload: {
      idempotencyKey: 'default-mode-draft', title: 'Draft', message: { role: 'u1', text: 'Hi', time: '10:00' }
    } })
    expect(draft.statusCode).toBe(200)
    expect(draft.json().conversation.assistantMode).toBe('chat')
  })
})

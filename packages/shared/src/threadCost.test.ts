import { describe, expect, it } from 'vitest'
import { THREAD_COST_REST } from './threadCost'
import { applyChatSettingsPatch, createChatSettingsSnapshot } from './chatContract'

describe('thread cost contract', () => {
  it('encodes conversation routes', () => {
    expect(THREAD_COST_REST.cost('a/b')).toBe('/api/conversations/a%2Fb/thread-cost')
    expect(THREAD_COST_REST.reset('a/b')).toBe('/api/conversations/a%2Fb/thread-reset')
  })
  it('accepts only supported conversation reset modes', () => {
    const current = createChatSettingsSnapshot({ version: 1, revision: 0, account: {}, conversation: {}, device: {} })
    for (const threadReset of ['off', 'hint', 'auto'] as const) {
      expect(applyChatSettingsPatch(current, { version: 1, expectedRevision: 0, owner: 'conversation', values: { threadReset } })).toMatchObject({ conversation: { threadReset } })
    }
    for (const threadReset of ['invalid', ['off'], null, true, 1]) {
      expect(() => createChatSettingsSnapshot({ ...current, conversation: { threadReset } as never })).toThrow('Invalid threadReset mode')
    }
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildConversationPromptWithin } from '@voicechat/shared'
import { coldStartPrompt } from './coldStart.js'

afterEach(() => vi.unstubAllEnvs())

describe('cold-start budget configuration', () => {
  const messages = [{ role: 'u1' as const, text: 'old history' }, { role: 'u1' as const, text: 'new request' }]

  it('applies the environment budget and keeps attachments', () => {
    vi.stubEnv('VC_COLD_START_PROMPT_CHARS', '11')
    expect(coldStartPrompt(messages, ['/data/file'])).toBe(buildConversationPromptWithin(messages, 11, { attachmentPaths: ['/data/file'] }))
    expect(coldStartPrompt(messages)).not.toContain('old history')
  })

  it.each(['', 'invalid', '0', '-1', 'Infinity', '1.5'])('defaults for invalid budget %s', value => {
    vi.stubEnv('VC_COLD_START_PROMPT_CHARS', value)
    expect(coldStartPrompt(messages)).toBe(buildConversationPromptWithin(messages))
  })
})

import { describe, expect, it } from 'vitest'
import { conversationContextUsage, DEFAULT_MODEL_WINDOW_TOKENS, modelWindowTokens } from './contextUsage'

describe('conversation context usage', () => {
  it('counts Claude input and both cache buckets', () => {
    expect(conversationContextUsage('claude', 'claude-sonnet-4-5', {
      inputTokens: 20, cacheReadTokens: 70, cacheCreationTokens: 10
    }, 123)).toEqual({ usedTokens: 100, windowTokens: 200_000, provider: 'claude', model: 'claude-sonnet-4-5', measuredAt: 123 })
  })

  it('uses the last model call of a multi-call Claude turn instead of the sum', () => {
    expect(conversationContextUsage('claude', 'claude-haiku-5-5', {
      inputTokens: 6, cacheReadTokens: 100_000, cacheCreationTokens: 13_000, contextInputTokens: 39_000
    }, 1)?.usedTokens).toBe(39_000)
  })

  it('uses Codex last_token_usage instead of cumulative totals', () => {
    expect(conversationContextUsage('codex', 'gpt-5.4', {
      inputTokens: 900_000, contextInputTokens: 42_000
    }, 456)?.usedTokens).toBe(42_000)
  })

  it('uses a conservative default for an unknown model', () => {
    expect(modelWindowTokens('future-model')).toBe(DEFAULT_MODEL_WINDOW_TOKENS)
  })
})

import { describe, it, expect } from 'vitest'
import { estimateCostUsd, totalTokens } from './pricing'

describe('estimateCostUsd', () => {
  it('undefined без модели или без прайса', () => {
    expect(estimateCostUsd(undefined, { inputTokens: 100 })).toBeUndefined()
    expect(estimateCostUsd('totally-unknown-model', { inputTokens: 100 })).toBeUndefined()
  })

  it('opus: считает по видам токенов (USD / 1M)', () => {
    // 1M input*15 + 1M output*75 + 1M cacheRead*1.5 + 1M cacheWrite*18.75
    const c = estimateCostUsd('claude-opus-4-8', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheCreationTokens: 1_000_000
    })
    expect(c).toBeCloseTo(15 + 75 + 1.5 + 18.75, 5)
  })

  it('gpt/codex попадают в GPT-прайс', () => {
    expect(estimateCostUsd('gpt-5.6-sol', { outputTokens: 1_000_000 })).toBeCloseTo(10, 5)
    expect(estimateCostUsd('codex-mini', { inputTokens: 1_000_000 })).toBeCloseTo(1.25, 5)
  })
})

describe('totalTokens', () => {
  it('суммирует все виды токенов', () => {
    expect(
      totalTokens({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4 })
    ).toBe(10)
    expect(totalTokens({})).toBe(0)
  })
})

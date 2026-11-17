import { describe, it, expect } from 'vitest'
import { estimateCostUsd, totalTokens } from './pricing'

describe('estimateCostUsd', () => {
  // @testCase TC-NEG-1
  it('undefined без точного modelId или без прайса', () => {
    expect(estimateCostUsd(undefined, { inputTokens: 100 })).toBeUndefined()
    expect(estimateCostUsd('', { inputTokens: 100 })).toBeUndefined()
    expect(estimateCostUsd('unknown', { inputTokens: 100 })).toBeUndefined()
    expect(estimateCostUsd('totally-unknown-gpt-model', { inputTokens: 100 })).toBeUndefined()
    expect(estimateCostUsd('gpt-6-astra', { pricingMode: 'fast', inputTokens: 100 })).toBeUndefined()
  })

  it('opus: считает по видам токенов (USD / 1M)', () => {
    // 1M input*5 + 1M output*25 + 1M cacheRead*0.5 + 1M cacheWrite*10
    const c = estimateCostUsd('claude-opus-4-8', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheCreationTokens: 1_000_000
    })
    expect(c).toBeCloseTo(5 + 25 + 0.5 + 10, 5)
  })

  // Смысл этих чисел — не «оценка что-то считает», а «оценка совпадает с тем, что
  // CLI взял на самом деле». Токены и цена взяты из строк `ci_run_usage` реальных
  // ранов; сдвинется прайс — тест покраснеет здесь, а не через полтора месяца в
  // сравнении движков. Допуск 2%: на ходах такого размера расхождение — центы.
  describe('совпадает с фактической ценой CLI', () => {
    const FACTS = [
      {
        what: 'CHAT-68 f08bd335, работа модели',
        model: 'claude-opus-5',
        usage: {
          inputTokens: 317,
          outputTokens: 133_011,
          cacheReadTokens: 30_154_984,
          cacheCreationTokens: 314_450
        },
        cliCostUsd: 21.5532
      },
      {
        what: 'CHAT-70 dfcd9e0e, работа модели',
        model: 'claude-opus-5',
        usage: {
          inputTokens: 345,
          outputTokens: 78_228,
          cacheReadTokens: 24_095_588,
          cacheCreationTokens: 211_933
        },
        cliCostUsd: 16.1266
      },
      {
        what: 'fable, самый крупный ход в ci_run_usage',
        model: 'claude-fable-5',
        usage: {
          inputTokens: 46,
          outputTokens: 32_182,
          cacheReadTokens: 1_225_848,
          cacheCreationTokens: 98_021
        },
        cliCostUsd: 4.7996
      }
    ]

    for (const f of FACTS) {
      it(f.what, () => {
        const estimate = estimateCostUsd(f.model, f.usage) ?? 0
        expect(estimate).toBeGreaterThan(0)
        expect(Math.abs(estimate - f.cliCostUsd) / f.cliCostUsd).toBeLessThan(0.02)
      })
    }
  })

  // @testCase TC-UNIT-1
  it('gpt-6-astra считает четыре вида токенов по точному Standard/short тарифу', () => {
    expect(estimateCostUsd('gpt-6-astra', {
      inputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheCreationTokens: 1_000_000,
      outputTokens: 1_000_000
    })).toBeCloseTo(10 + 1 + 12.5 + 50, 5)
    expect(estimateCostUsd('gpt-6-astra', {
      contextTier: 'long', inputTokens: 1_000_000, outputTokens: 1_000_000
    })).toBeCloseTo(20 + 75, 5)
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

// Published Standard prices, including fractional cache-write rates.
describe('GPT-6 Sol and Luna rates', () => {
  it.each([
    ['gpt-6.1-sol', 14.6, 24.2],
    ['gpt-6-sol', 14.7, 24.4],
    ['gpt-6-luna', 0.735, 1.22]
  ] as const)('%s prices all token types without rounding', (model, short, long) => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheCreationTokens: 1_000_000 }
    expect(estimateCostUsd(model, usage)).toBeCloseTo(short, 6)
    expect(estimateCostUsd(model, { ...usage, contextTier: 'long' })).toBeCloseTo(long, 6)
  })
})

// Rates of https://platform.claude.com/docs/en/about-claude/pricing and of the OpenAI pricing page, 2026-11-17.
describe('current Claude and long-context OpenAI rates', () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheCreationTokens: 1_000_000 }
  it.each([
    ['claude-fable-5-2', 8 + 40 + 0.2 + 16],
    ['claude-fable-5-1', 10 + 50 + 0.25 + 20],
    ['fable', 8 + 40 + 0.2 + 16],
    // The bare `default` alias is Fable 5.2 in the current runner CLI.
    ['default', 8 + 40 + 0.2 + 16],
    ['claude-fable-5', 10 + 50 + 1 + 20],
    ['claude-opus-5-5', 4 + 20 + 0.2 + 8],
    ['claude-opus-5[1m]', 5 + 25 + 0.5 + 10],
    ['claude-opus-4-1', 15 + 75 + 1.5 + 30],
    ['claude-sonnet-5-5', 2 + 10 + 0.1 + 4],
    ['claude-sonnet-5', 2 + 10 + 0.2 + 4],
    ['sonnet', 2 + 10 + 0.1 + 4],
    ['opus[1m]', 4 + 20 + 0.2 + 8],
    ['claude-sonnet-4-6', 3 + 15 + 0.3 + 6],
    ['claude-haiku-5-5', 0.1 + 0.5 + 0.01 + 0.2],
    ['claude-haiku-4-5-20251001', 1 + 5 + 0.1 + 2],
    ['haiku', 0.1 + 0.5 + 0.01 + 0.2]
  ] as const)('%s', (model, expected) => {
    expect(estimateCostUsd(model, usage)).toBeCloseTo(expected, 6)
  })

  it('matches the cost the CLI reported for real text turns of 2026-11-17', () => {
    // Haiku 4.5: 929 input, 125 output, 6363 written to the 1-hour cache.
    expect(estimateCostUsd('claude-haiku-4-5-20251001', { inputTokens: 929, outputTokens: 125, cacheCreationTokens: 6363 })).toBeCloseTo(0.01428, 5)
  })

  it('prices long prompts of Haiku 5.5, GPT-5.5 and GPT-5.4 at the long-context rate', () => {
    expect(estimateCostUsd('claude-haiku-5-5', { ...usage, contextTier: 'long' })).toBeCloseTo(0.5 + 2.5 + 0.05 + 1, 6)
    expect(estimateCostUsd('claude-sonnet-5-5', { ...usage, contextTier: 'long' })).toBeCloseTo(16.1, 6)
    expect(estimateCostUsd('gpt-5.5', { ...usage, contextTier: 'long' })).toBeCloseTo(10 + 45 + 1, 6)
    expect(estimateCostUsd('gpt-5.4', { ...usage, contextTier: 'long' })).toBeCloseTo(5 + 22.5 + 0.5, 6)
  })
})

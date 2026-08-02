import { describe, it, expect } from 'vitest'
import { estimateCostUsd, totalTokens } from './pricing'

describe('estimateCostUsd', () => {
  it('undefined без модели или без прайса', () => {
    expect(estimateCostUsd(undefined, { inputTokens: 100 })).toBeUndefined()
    expect(estimateCostUsd('totally-unknown-model', { inputTokens: 100 })).toBeUndefined()
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
        model: 'opus',
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
        model: 'opus',
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
        model: 'fable',
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

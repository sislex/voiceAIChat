import { describe, expect, it } from 'vitest'
import { formatUsd, summarizeConversationUsage } from './usageSummary'

describe('сводка расхода беседы', () => {
  it('суммирует только ходы ассистента с расходом; реальная цена приоритетнее расчётной', () => {
    const usage = summarizeConversationUsage([
      { role: 'u1', meta: { costUsd: 99 } },
      { role: 'ai', meta: { inputTokens: 1000, outputTokens: 100, costUsd: 0.5 } },
      { role: 'ai', meta: { inputTokens: 2000, outputTokens: 200, model: 'sonnet' } },
      { role: 'ai' }
    ])
    expect(usage).not.toBeNull()
    expect(usage!.turns).toBe(2)
    expect(usage!.inputTokens).toBe(3000)
    expect(usage!.outputTokens).toBe(300)
    expect(usage!.costUsd).toBeGreaterThan(0.5)
    expect(usage!.estimated).toBe(true)
  })

  it('ход без цены и прайса считается неоценённым; пустая беседа → null', () => {
    const usage = summarizeConversationUsage([{ role: 'ai', meta: { inputTokens: 10, outputTokens: 1, model: 'неизвестная-модель' } }])
    expect(usage).toMatchObject({ turns: 1, costUsd: 0, unpriced: 1, estimated: false })
    expect(summarizeConversationUsage([{ role: 'u1' }])).toBeNull()
  })

  it('форматирует доллары', () => {
    expect(formatUsd(0.0123)).toBe('$0.0123')
    expect(formatUsd(1.234, true)).toBe('≈ $1.23')
  })
})

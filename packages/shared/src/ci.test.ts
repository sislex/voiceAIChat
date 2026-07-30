// Чистая логика домена CI: бюджет уточняющих вопросов и полнота списков.
import { describe, it, expect } from 'vitest'
import {
  clarifyBudget,
  CI_CLARIFY_LEVELS,
  CI_CLARIFY_MAX_LIMIT,
  CI_RUN_MODES,
  CI_STATUSES,
  DEFAULT_CI_LLM_CONFIG,
  isTerminalCiStatus
} from './ci'

describe('clarifyBudget', () => {
  it('фиксированные уровни дают 0/3/6', () => {
    expect(clarifyBudget({ clarifyLevel: 'none', clarifyMax: 30 })).toBe(0)
    expect(clarifyBudget({ clarifyLevel: 'few', clarifyMax: 30 })).toBe(3)
    expect(clarifyBudget({ clarifyLevel: 'medium', clarifyMax: 30 })).toBe(6)
  })

  it('детальное уточнение берёт clarifyMax и зажимается в 1..30', () => {
    expect(clarifyBudget({ clarifyLevel: 'detailed', clarifyMax: 12 })).toBe(12)
    expect(clarifyBudget({ clarifyLevel: 'detailed', clarifyMax: 0 })).toBe(1)
    expect(clarifyBudget({ clarifyLevel: 'detailed', clarifyMax: -5 })).toBe(1)
    expect(clarifyBudget({ clarifyLevel: 'detailed', clarifyMax: 999 })).toBe(CI_CLARIFY_MAX_LIMIT)
    expect(clarifyBudget({ clarifyLevel: 'detailed', clarifyMax: 2.6 })).toBe(3)
  })

  it('дефолт конфигурации — разработка с тремя вопросами', () => {
    expect(DEFAULT_CI_LLM_CONFIG.mode).toBe('development')
    expect(clarifyBudget(DEFAULT_CI_LLM_CONFIG)).toBe(3)
  })
})

describe('списки и статусы', () => {
  it('все уровни уточнения дают неотрицательный бюджет', () => {
    for (const clarifyLevel of CI_CLARIFY_LEVELS) {
      expect(clarifyBudget({ clarifyLevel, clarifyMax: 3 })).toBeGreaterThanOrEqual(0)
    }
  })

  it('режимов ровно два', () => {
    expect(CI_RUN_MODES).toEqual(['plan', 'development'])
  })

  it('ожидание ввода — не терминальный статус', () => {
    expect(CI_STATUSES).toContain('awaiting_input')
    expect(isTerminalCiStatus('awaiting_input')).toBe(false)
    expect(isTerminalCiStatus('success')).toBe(true)
  })
})

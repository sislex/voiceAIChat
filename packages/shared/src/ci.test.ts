// Чистая логика домена CI: бюджет уточняющих вопросов и полнота списков.
import { describe, it, expect } from 'vitest'
import {
  canStartCiRun,
  ciCardPulse,
  clarifyBudget,
  CI_CLARIFY_LEVELS,
  CI_CLARIFY_MAX_LIMIT,
  CI_RUN_MODES,
  CI_STATUSES,
  DEFAULT_CI_CLAUDE_MODEL,
  DEFAULT_CI_LLM_CONFIG,
  isActiveCiStatus,
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

  it('дефолтный движок CI — claude opus', () => {
    expect(DEFAULT_CI_LLM_CONFIG.provider).toBe('claude')
    expect(DEFAULT_CI_LLM_CONFIG.model).toBe('opus')
    expect(DEFAULT_CI_CLAUDE_MODEL).toBe('opus')
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

describe('isActiveCiStatus', () => {
  it('активны очередь, работа и ожидание ответа', () => {
    expect(isActiveCiStatus('queued')).toBe(true)
    expect(isActiveCiStatus('running')).toBe(true)
    expect(isActiveCiStatus('awaiting_input')).toBe(true)
  })

  it('терминальные статусы неактивны — запуск снова доступен', () => {
    for (const s of CI_STATUSES.filter(isTerminalCiStatus)) expect(isActiveCiStatus(s)).toBe(false)
    expect(isActiveCiStatus('skipped')).toBe(false)
  })
})

describe('canStartCiRun', () => {
  it('без рана запуск доступен', () => {
    expect(canStartCiRun(null)).toBe(true)
    expect(canStartCiRun(undefined)).toBe(true)
  })

  it('завершённый ран запуску не мешает — «Выполнить» стартует новый', () => {
    for (const s of ['success', 'failed', 'cancelled', 'timeout', 'skipped'] as const) {
      expect(canStartCiRun({ status: s })).toBe(true)
    }
  })

  it('пока ран активен, запуск закрыт', () => {
    for (const s of ['queued', 'running', 'awaiting_input'] as const) {
      expect(canStartCiRun({ status: s })).toBe(false)
    }
  })

  it('покрыты все статусы: запуск закрыт ровно на активных', () => {
    for (const s of CI_STATUSES) expect(canStartCiRun({ status: s })).toBe(!isActiveCiStatus(s))
  })
})

describe('ciCardPulse', () => {
  const sp = (fixing?: boolean): { done: number; total: number; phase: string; fixing?: boolean } =>
    ({ done: 1, total: 4, phase: 'ф', fixing })

  it('без рана подсветки нет', () => {
    expect(ciCardPulse(null)).toBeNull()
    expect(ciCardPulse(undefined)).toBeNull()
  })

  it('ран идёт — голубое «дыхание», а с флагом fixing — красное мигание', () => {
    expect(ciCardPulse({ status: 'running', slotProgress: sp() })).toBe('running')
    expect(ciCardPulse({ status: 'queued', slotProgress: sp() })).toBe('running')
    expect(ciCardPulse({ status: 'running', slotProgress: sp(true) })).toBe('fixing')
  })

  it('ожидание ответа, падение и успех дают свои состояния', () => {
    expect(ciCardPulse({ status: 'awaiting_input', slotProgress: sp() })).toBe('awaiting')
    expect(ciCardPulse({ status: 'failed', slotProgress: sp() })).toBe('failed')
    expect(ciCardPulse({ status: 'timeout', slotProgress: sp() })).toBe('failed')
    expect(ciCardPulse({ status: 'success', slotProgress: sp() })).toBe('done')
  })

  it('ожидание ответа важнее флага fixing', () => {
    expect(ciCardPulse({ status: 'awaiting_input', slotProgress: sp(true) })).toBe('awaiting')
  })

  it('отменённый и пропущенный ран карточку не подсвечивают', () => {
    expect(ciCardPulse({ status: 'cancelled', slotProgress: sp() })).toBeNull()
    expect(ciCardPulse({ status: 'skipped', slotProgress: sp() })).toBeNull()
  })
})

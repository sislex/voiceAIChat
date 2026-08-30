// Разовый прогон набора: деление бюджета, выбор одного сценария и защита от
// параллельного запуска. Пока это жило замыканием в `buildServer`, не
// проверялось ничего из перечисленного.

import { describe, expect, it, vi } from 'vitest'
import type { AutomatedQaScenario } from '@voicechat/shared'
import { createAutomatedQaCheck } from './automatedQaCheck.js'
import type { AutomatedQaScenarioOutcome, AutomatedQaScenarioRunner } from './automatedQaScenario.js'

const scenario = (name: string): AutomatedQaScenario =>
  ({ name, startUrl: 'https://a.b/', steps: [{ id: 's1', title: 'Шаг', action: { kind: 'click', selector: '#a' } }] })

const passed = (): AutomatedQaScenarioOutcome =>
  ({ steps: [{ id: 's1', title: 'Шаг', status: 'passed', detail: '', durationMs: 1 }], screenshotUrl: null, pageErrors: [], blocked: null })

const failed = (): AutomatedQaScenarioOutcome =>
  ({ steps: [{ id: 's1', title: 'Шаг', status: 'failed', detail: 'не найден', durationMs: 1 }], screenshotUrl: null, pageErrors: [], blocked: null })

/**
 * Исполнитель-двойник. `spend` — какую долю выданного бюджета сценарий реально
 * тратит: без движения часов остаток каждый раз доставался бы следующему
 * целиком, и деление бюджета было бы не видно.
 */
function runnerOf(outcomes: AutomatedQaScenarioOutcome[], spend = 1): { runner: AutomatedQaScenarioRunner; budgets: number[]; clock: () => number } {
  const budgets: number[] = []
  let at = 0
  let clock = 0
  return {
    budgets,
    clock: () => clock,
    runner: { run: vi.fn(async (input) => {
      budgets.push(input.budgetMs ?? 0)
      clock += Math.floor((input.budgetMs ?? 0) * spend)
      return outcomes[Math.min(at++, outcomes.length - 1)]
    }) }
  }
}

describe('createAutomatedQaCheck', () => {
  it('делит общий бюджет между сценариями, а не даёт каждому по полному', async () => {
    const { runner, budgets, clock } = runnerOf([passed(), passed(), passed()])
    const check = createAutomatedQaCheck({
      scenariosOf: () => [scenario('Вход'), scenario('Доска'), scenario('Настройки')],
      runner, budgetMs: 90_000, now: clock
    })
    const results = await check('alice', 'p1')
    expect(results).toHaveLength(3)
    // Человек ждёт синхронный ответ: три сценария по 90 с держали бы его четыре
    // с половиной минуты.
    expect(budgets).toEqual([30_000, 30_000, 30_000])
    expect(budgets.reduce((sum, item) => sum + item, 0)).toBeLessThanOrEqual(90_000)
  })

  it('сценарий, уложившийся быстрее, отдаёт остаток следующему', async () => {
    const { runner, budgets, clock } = runnerOf([passed(), passed()], 0.5)
    const check = createAutomatedQaCheck({
      scenariosOf: () => [scenario('Вход'), scenario('Доска')], runner, budgetMs: 90_000, now: clock
    })
    await check('alice', 'p1')
    expect(budgets[0]).toBe(45_000)
    expect(budgets[1]).toBeGreaterThan(45_000)
  })

  it('прогон одного сценария не трогает остальные', async () => {
    const { runner } = runnerOf([passed()])
    const check = createAutomatedQaCheck({
      scenariosOf: () => [scenario('Вход'), scenario('Доска')], runner, budgetMs: 90_000, now: () => 0
    })
    expect((await check('alice', 'p1', 1)).map((item) => item.name)).toEqual(['Доска'])
    expect(runner.run).toHaveBeenCalledTimes(1)
    // Несуществующий номер — пустой список, а не падение.
    expect(await check('alice', 'p1', 9)).toEqual([])
  })

  it('первый провалившийся останавливает проверку — как в этапе', async () => {
    const { runner } = runnerOf([failed(), passed()])
    const check = createAutomatedQaCheck({
      scenariosOf: () => [scenario('Вход'), scenario('Доска')], runner, budgetMs: 90_000, now: () => 0
    })
    expect(await check('alice', 'p1')).toHaveLength(1)
    expect(runner.run).toHaveBeenCalledTimes(1)
  })

  it('второй прогон того же проекта отклоняется, а чужой проект идёт своим ходом', async () => {
    let release = (): void => {}
    const gate = new Promise<void>((done) => { release = done })
    const runner: AutomatedQaScenarioRunner = { run: vi.fn(async () => { await gate; return passed() }) }
    const check = createAutomatedQaCheck({ scenariosOf: () => [scenario('Вход')], runner, budgetMs: 90_000, now: () => 0 })
    const first = check('alice', 'p1')
    await expect(check('alice', 'p1')).rejects.toThrow('check_already_running')
    const other = check('alice', 'p2')
    release()
    await first
    await other
    // Замок снимается: после прогона проект снова доступен.
    await check('alice', 'p1')
    expect(runner.run).toHaveBeenCalledTimes(3)
  })
})

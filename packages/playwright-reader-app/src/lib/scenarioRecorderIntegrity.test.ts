import { describe, expect, it } from 'vitest'
import { expectOnLastStep, loadScenario, moveStep, recordClick, recordNavigate, recordScroll, removeStep, toggleStep, toScenario, type RecordedStep } from './scenarioRecorder'
const element = { selector: '#button', tag: 'button', text: 'Кнопка', stability: 'id' as const, rect: { x: 0, y: 0, width: 80, height: 30 } }

it('проверка первого перехода остаётся шагом без повторной навигации', () => {
  const steps = expectOnLastStep(recordNavigate([], 'https://project.test/'), 'Готово')
  const scenario = toScenario(steps, 'https://elsewhere.test')
  expect(scenario.startUrl).toBe('https://project.test/')
  expect(scenario.steps).toEqual([{ id: 'step-1', title: 'Открыть https://project.test/', action: { kind: 'wait', loadState: 'domcontentloaded' }, expectText: 'Готово' }])
})
it('проверка отсутствия на первом переходе также сохраняется', () => {
  expect(toScenario(expectOnLastStep(recordNavigate([], 'https://project.test/'), 'Ошибка', true), '').steps[0]).toMatchObject({ expectAbsentText: 'Ошибка' })
})
it('прокрутка обратно не стирает промежуточную проверку', () => {
  const steps = recordScroll(expectOnLastStep(recordScroll([], 500), 'Середина'), -500)
  expect(steps).toHaveLength(2)
  expect(steps[0]).toMatchObject({ action: { dy: 500 }, expectText: 'Середина' })
  expect(steps[1].action).toEqual({ kind: 'scroll', dy: -500 })
})
it('обычная прокрутка не сливается с загруженным шагом другого контейнера или iframe', () => {
  for (const scope of [{ selector: '#panel' }, { frame: '#preview' }]) {
    const first: RecordedStep = { id: 's', title: 'Панель', stability: 'id', action: { kind: 'scroll', dy: 200, ...scope } }
    const result = recordScroll([first], 200)
    expect(result).toHaveLength(2)
    expect(result[0]).toBe(first)
  }
})
it('продолжение импортированной записи получает свободный id', () => {
  const old = { ...recordClick([], element)[0], id: 'step-2' }
  const result = recordClick([old], element)
  expect(result.map(s => s.id)).toEqual(['step-2', 'step-3'])
})
it('удаление соседа не меняет id оставшихся результатов и ожиданий', () => {
  const steps = recordClick(recordClick(recordClick([], element), element), element)
  expect(removeStep(steps, 'step-2').map(s => s.id)).toEqual(['step-1', 'step-3'])
})
it('стартовый переход загруженного сценария не конфликтует с его первым шагом', () => {
  const scenario = { startUrl: 'https://project.test', steps: recordClick([], element) }
  const loaded = loadScenario(scenario)
  expect(new Set(loaded.map(s => s.id)).size).toBe(2)
  expect(loaded[1].id).toBe('step-1')
  expect(toScenario(loaded, '').steps[0].id).toBe('step-1')
})
it('повторяющиеся id старого импорта исправляются без потери шагов', () => {
  const original = recordClick([], element)[0]
  const result = loadScenario({ startUrl: 'https://project.test', steps: [original, original, original] })
  expect(result).toHaveLength(4)
  expect(new Set(result.map(s => s.id)).size).toBe(4)
})

// Круг 8: запись правится, а не переписывается заново — каждый повтор прохода
// это снова десять кликов по живому сайту.
describe('правка записанного сценария', () => {
  const step = (id: string, over: Partial<RecordedStep> = {}): RecordedStep => ({
    id, title: id, action: { kind: 'click', selector: `#${id}` }, stability: 'testid', ...over
  })

  it('шаг двигается вверх и вниз, а за края — нет', () => {
    const steps = [step('a'), step('b'), step('c')]
    expect(moveStep(steps, 'b', -1).map((item) => item.id)).toEqual(['b', 'a', 'c'])
    expect(moveStep(steps, 'b', 1).map((item) => item.id)).toEqual(['a', 'c', 'b'])
    expect(moveStep(steps, 'a', -1)).toBe(steps)
    expect(moveStep(steps, 'c', 1)).toBe(steps)
  })

  it('выключенный шаг остаётся в записи, но в сценарий не уезжает', () => {
    const steps = toggleStep([step('a'), step('b')], 'b')
    expect(steps[1].skipped).toBe(true)
    expect(toScenario(steps, 'https://a.b/').steps.map((item) => item.id)).toEqual(['a'])
  })

  it('выключенный первый переход не задаёт стартовый адрес', () => {
    const steps = toggleStep([
      { ...step('open'), action: { kind: 'open', url: 'https://old.example/' } },
      step('a')
    ], 'open')
    expect(toScenario(steps, 'https://new.example/').startUrl).toBe('https://new.example/')
  })

  it('повторное выключение возвращает шаг в сценарий', () => {
    const steps = toggleStep(toggleStep([step('a')], 'a'), 'a')
    expect(toScenario(steps, 'https://a.b/').steps).toHaveLength(1)
  })
})

import { describe, expect, it } from 'vitest'
import type { BrowserElementDescription } from '@shared/types'
import { ambiguousSteps, expectOnLastStep, fragileSteps, hasAssertions, needsWaitHint, recordClick, recordNavigate, recordScroll, recordType, removeStep, renameStep, toScenario } from './scenarioRecorder'

const element = (over: Partial<BrowserElementDescription> = {}): BrowserElementDescription => ({
  selector: '[data-testid="create"]', stability: 'testid', tag: 'button', text: 'Создать',
  rect: { x: 0, y: 0, width: 100, height: 40 }, ...over
})

describe('запись шагов', () => {
  it('клик становится селекторным шагом с человеческим названием', () => {
    expect(recordClick([], element())[0]).toMatchObject({
      id: 'step-1', title: 'Нажать «Создать»', action: { kind: 'click', selector: '[data-testid="create"]' }
    })
  })

  it('ввод сохраняет и селектор, и текст', () => {
    const steps = recordType([], element({ selector: '#title', text: '', tag: 'input' }), 'Проверка')
    expect(steps[0]).toMatchObject({ title: 'Ввести в #title', action: { kind: 'type', selector: '#title', text: 'Проверка' } })
  })

  it('без текста элемента в названии остаётся селектор — иначе шаг безымянный', () => {
    expect(recordClick([], element({ text: '' }))[0].title).toBe('Нажать [data-testid="create"]')
  })

  it('номера шагов идут подряд', () => {
    const steps = recordClick(recordClick([], element()), element({ selector: '#save', text: 'Сохранить' }))
    expect(steps.map((s) => s.id)).toEqual(['step-1', 'step-2'])
  })
})

describe('toScenario', () => {
  it('первый переход становится стартовым адресом и уходит из шагов', () => {
    // Иначе страница открывалась бы дважды: у сценария есть отдельное startUrl.
    const steps = recordClick(recordNavigate([], 'http://89.125.68.35:8787/'), element())
    const scenario = toScenario(steps, 'http://другой')
    expect(scenario.startUrl).toBe('http://89.125.68.35:8787/')
    expect(scenario.steps).toHaveLength(1)
    expect(scenario.steps[0]).toMatchObject({ id: 'step-1', action: { kind: 'click' } })
  })

  it('без шага-перехода стартовым берётся текущий адрес', () => {
    const scenario = toScenario(recordClick([], element()), 'http://89.125.68.35:8787/#/projects')
    expect(scenario.startUrl).toBe('http://89.125.68.35:8787/#/projects')
    expect(scenario.steps).toHaveLength(1)
  })

  it('признак надёжности в сценарий не уезжает: он нужен только при записи', () => {
    expect(Object.keys(toScenario(recordClick([], element()), 'http://x').steps[0])).toEqual(['id', 'title', 'action'])
  })
})

describe('fragileSteps', () => {
  it('шаги по пути в дереве помечаются как ненадёжные', () => {
    const steps = recordClick(recordClick([], element()), element({ selector: 'div > span:nth-of-type(2)', stability: 'path' }))
    expect(fragileSteps(steps).map((s) => s.action)).toEqual([{ kind: 'click', selector: 'div > span:nth-of-type(2)' }])
  })
})

describe('проверки в сценарии (круг 14)', () => {
  it('сценарий без ожиданий тестом не считается', () => {
    const steps = recordClick([], element())
    expect(hasAssertions(steps)).toBe(false)
    expect(hasAssertions(expectOnLastStep(steps, 'Задача создана'))).toBe(true)
  })

  it('ожидание вешается на последний шаг и доезжает до сценария', () => {
    const steps = expectOnLastStep(recordClick(recordClick([], element()), element({ selector: '#save' })), 'Сохранено')
    expect(steps[0].expectText).toBeUndefined()
    expect(toScenario(steps, 'http://x').steps[1]).toMatchObject({ expectText: 'Сохранено' })
  })

  it('недопустимый текст пишется отдельным полем', () => {
    const steps = expectOnLastStep(recordClick([], element()), 'Ошибка', true)
    expect(toScenario(steps, 'http://x').steps[0]).toMatchObject({ expectAbsentText: 'Ошибка' })
  })

  it('пустое ожидание и пустой список ничего не меняют', () => {
    const steps = recordClick([], element())
    expect(expectOnLastStep(steps, '   ')).toBe(steps)
    expect(expectOnLastStep([], 'что-то')).toEqual([])
  })

  it('удаление шага перенумеровывает остальные', () => {
    const steps = recordClick(recordClick(recordClick([], element()), element({ selector: '#b' })), element({ selector: '#c' }))
    const left = removeStep(steps, 'step-2')
    expect(left.map((s) => s.id)).toEqual(['step-1', 'step-2'])
    expect(left.map((s) => ('selector' in s.action ? s.action.selector : ''))).toEqual(['[data-testid="create"]', '#c'])
  })

  it('неоднозначный селектор выделяется отдельно от ненадёжного', () => {
    const steps = recordClick([], element({ selector: 'button[aria-label="Закрыть"]', stability: 'label', matches: 3 }))
    expect(ambiguousSteps(steps)).toHaveLength(1)
    expect(fragileSteps(steps)).toHaveLength(0)
  })
})

describe('виды кликов, прокрутка и паузы (круг 15)', () => {
  it('правый и двойной клик записываются по-разному', () => {
    expect(recordClick([], element(), 'right')[0]).toMatchObject({
      title: 'Нажать правой кнопкой «Создать»', action: { kind: 'click', button: 'right' }
    })
    expect(recordClick([], element(), 'double')[0]).toMatchObject({
      title: 'Двойной клик «Создать»', action: { kind: 'click', dblclick: true }
    })
    // Обычный клик остаётся без лишних полей — иначе сценарий читается хуже.
    expect(recordClick([], element())[0].action).toEqual({ kind: 'click', selector: '[data-testid="create"]' })
  })

  it('прокрутка сливается в один шаг, а не плодит их на каждый щелчок', () => {
    const steps = recordScroll(recordScroll(recordScroll([], 300), 300), 200)
    expect(steps).toHaveLength(1)
    expect(steps[0]).toMatchObject({ title: 'Прокрутить на 800 px', action: { kind: 'scroll', dy: 800 } })
  })

  it('прокрутка после клика — отдельный шаг', () => {
    const steps = recordScroll(recordClick([], element()), 300)
    expect(steps).toHaveLength(2)
    expect(steps[1].action).toEqual({ kind: 'scroll', dy: 300 })
  })

  it('переименование меняет только нужный шаг и не принимает пустое', () => {
    const steps = recordClick(recordClick([], element()), element({ selector: '#b' }))
    const renamed = renameStep(steps, 'step-2', 'Открыть карточку')
    expect(renamed.map((s) => s.title)).toEqual(['Нажать «Создать»', 'Открыть карточку'])
    expect(renameStep(steps, 'step-2', '   ')).toBe(steps)
  })

  it('долгая пауза без проверки — повод подсказать ожидание', () => {
    const slow = [{ ...recordClick([], element())[0], pauseMs: 4000 }]
    expect(needsWaitHint(slow)).toBe(true)
    // С проверкой подсказка не нужна: ожидание уже задано явно.
    expect(needsWaitHint(expectOnLastStep(slow, 'Готово'))).toBe(false)
    expect(needsWaitHint([{ ...slow[0], pauseMs: 300 }])).toBe(false)
  })

  it('служебные поля записи не уезжают в сценарий', () => {
    const steps = [{ ...recordClick([], element())[0], pauseMs: 4000, matches: 2 }]
    expect(Object.keys(toScenario(steps, 'http://x').steps[0])).toEqual(['id', 'title', 'action'])
  })
})

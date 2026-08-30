import { describe, expect, it } from 'vitest'
import type { BrowserElementDescription } from '@shared/types'
import { ambiguousSteps, brokenSteps, expectOnLastStep, placeScenario, fragileSteps, hasAssertions, needsWaitHint, recordClick, recordNavigate, recordScroll, recordType, removeStep, renameStep, toScenario } from './scenarioRecorder'

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
    // Идентификатор записанного шага сохраняется: по нему панель сопоставляет
    // результат прогона и целится «прогнать до этого шага».
    expect(scenario.steps[0]).toMatchObject({ id: 'step-2', action: { kind: 'click' } })
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

describe('сломанный селектор (круг 19)', () => {
  it('шаг, чей селектор не находит ничего, выделяется отдельно', () => {
    const steps = recordClick([], element({ selector: '#битый', matches: 0 }))
    expect(brokenSteps(steps)).toHaveLength(1)
    // Это не «неоднозначный»: там несколько совпадений, здесь ни одного.
    expect(ambiguousSteps(steps)).toHaveLength(0)
  })
  it('шаг без сведений о совпадениях сломанным не считается', () => {
    expect(brokenSteps(recordClick([], element({ matches: undefined })))).toHaveLength(0)
  })
})

describe('placeScenario (круг 21)', () => {
  const scenario = (name?: string) => ({ ...(name ? { name } : {}), startUrl: 'http://x/', steps: [] })

  it('одноимённый заменяется, а не дублируется', () => {
    const next = placeScenario([scenario('Вход'), scenario('Доска')], { ...scenario('Вход'), startUrl: 'http://new/' })
    expect(next).toHaveLength(2)
    expect(next[0].startUrl).toBe('http://new/')
  })

  it('новое имя добавляется в конец', () => {
    expect(placeScenario([scenario('Вход')], scenario('Настройки')).map((item) => item.name)).toEqual(['Вход', 'Настройки'])
  })

  it('безымянный не затирает безымянного, а получает имя по порядку', () => {
    // До круга 21 второй безымянный молча заменял первый: имена совпадали как ''.
    const first = placeScenario([], scenario())
    const second = placeScenario(first, scenario())
    expect(second).toHaveLength(2)
    expect(second.map((item) => item.name)).toEqual(['Сценарий 1', 'Сценарий 2'])
  })

  it('пробелы в имени не создают двойника', () => {
    const next = placeScenario([scenario('Вход')], { ...scenario('  Вход  '), startUrl: 'http://new/' })
    expect(next).toHaveLength(1)
    expect(next[0].name).toBe('Вход')
  })
})

describe('подбор имени не создаёт дубля (круг 23)', () => {
  const s = (name?: string) => ({ ...(name ? { name } : {}), startUrl: 'http://x/', steps: [] })

  it('занятое сгенерированное имя пропускается', () => {
    // Исправление круга 21 принесло свою версию той же беды: при наборе
    // ["Сценарий 2"] генератор выдавал ровно «Сценарий 2».
    expect(placeScenario([s('Сценарий 2')], s()).map((item) => item.name)).toEqual(['Сценарий 2', 'Сценарий 3'])
  })

  it('подряд идущие безымянные получают разные имена', () => {
    let set = placeScenario([], s())
    set = placeScenario(set, s())
    set = placeScenario(set, s())
    expect(set.map((item) => item.name)).toEqual(['Сценарий 1', 'Сценарий 2', 'Сценарий 3'])
    expect(new Set(set.map((item) => item.name)).size).toBe(3)
  })

  it('плотно занятый ряд даёт следующее свободное имя', () => {
    const dense = [s('Сценарий 1'), s('Сценарий 2'), s('Сценарий 3'), s('Сценарий 4')]
    expect(placeScenario(dense, s()).map((item) => item.name).at(-1)).toBe('Сценарий 5')
  })

  it('дыра в ряду не мешает: берём первое свободное после длины набора', () => {
    // Начинаем с длины набора, а не с единицы: иначе безымянный занял бы
    // «Сценарий 1» и встал в конец списка под именем первого.
    expect(placeScenario([s('Сценарий 3'), s('Сценарий 4')], s()).map((item) => item.name).at(-1)).toBe('Сценарий 5')
  })
})

// Круг 8: запись сценария со стороны модели. Человек в панели записывает проход
// и получает воспроизводимые шаги; у модели этого не было, хотя путь чаще всего
// проходит именно она — в задаче канбана, где потом нужен автотест.

import { beforeEach, describe, expect, it } from 'vitest'
import { describeAction, isRecording, recordAction, recordExpectation, scenarioOf, startRecording, stopRecording } from './turnRecorder'

const KEY = 'conversation-1'

beforeEach(() => stopRecording(KEY))

describe('запись сценария модели', () => {
  it('без включённой записи действия не запоминаются', () => {
    expect(recordAction(KEY, { kind: 'click', selector: '#save' })).toBe(false)
    expect(scenarioOf(KEY)).toBeNull()
  })

  it('записывает действия и берёт стартовый адрес из первого open', () => {
    startRecording(KEY, '')
    recordAction(KEY, { kind: 'open', url: 'https://a.b/login' })
    recordAction(KEY, { kind: 'type', selector: '#login', text: 'admin' })
    const scenario = scenarioOf(KEY)
    expect(scenario?.startUrl).toBe('https://a.b/login')
    expect(scenario?.steps).toHaveLength(2)
    expect(scenario?.steps[1].title).toContain('#login')
  })

  it('чтение страницы шагом не становится: прогонять его нечего', () => {
    startRecording(KEY, 'https://a.b/')
    for (const kind of ['read', 'find', 'screenshot', 'metrics', 'source', 'csv', 'note'] as const) {
      expect(recordAction(KEY, { kind, selector: '#x' } as never)).toBe(false)
    }
    expect(scenarioOf(KEY)?.steps).toHaveLength(0)
  })

  it('проверка прикрепляется к последнему шагу, а не становится своим', () => {
    startRecording(KEY, 'https://a.b/')
    recordAction(KEY, { kind: 'click', text: 'Войти' })
    expect(recordExpectation(KEY, 'Личный кабинет')).toBe(true)
    const scenario = scenarioOf(KEY)
    expect(scenario?.steps).toHaveLength(1)
    expect(scenario?.steps[0].expectText).toBe('Личный кабинет')
  })

  it('проверка отсутствия текста пишется отдельным полем', () => {
    startRecording(KEY, 'https://a.b/')
    recordAction(KEY, { kind: 'click', text: 'Сохранить' })
    recordExpectation(KEY, 'Ошибка', true)
    expect(scenarioOf(KEY)?.steps[0].expectAbsentText).toBe('Ошибка')
  })

  it('проверка без единого шага отказывает словами, а не молча теряется', () => {
    startRecording(KEY, 'https://a.b/')
    expect(recordExpectation(KEY, 'Готово')).toBe(false)
  })

  it('длинная запись обрезается и честно считает пропущенное', () => {
    startRecording(KEY, 'https://a.b/')
    for (let index = 0; index < 120; index++) recordAction(KEY, { kind: 'click', selector: `#b${index}` })
    const scenario = scenarioOf(KEY)
    expect(scenario?.steps).toHaveLength(100)
    expect(scenario?.dropped).toBe(20)
  })

  it('остановка отдаёт сценарий и выключает запись', () => {
    startRecording(KEY, 'https://a.b/', 'Вход')
    recordAction(KEY, { kind: 'click', text: 'Войти' })
    const scenario = scenarioOf(KEY)
    stopRecording(KEY)
    expect(scenario?.name).toBe('Вход')
    expect(isRecording(KEY)).toBe(false)
  })
})

describe('имя шага', () => {
  it('читается человеком в отчёте прогона', () => {
    expect(describeAction({ kind: 'open', url: 'https://a.b/' })).toBe('Открыть https://a.b/')
    expect(describeAction({ kind: 'click', text: 'Войти' })).toBe('Нажать «Войти»')
    expect(describeAction({ kind: 'hotkey', key: 'a', modifiers: ['primary'] })).toBe('Сочетание primary+a')
    expect(describeAction({ kind: 'fillForm', fields: [{ selector: '#a', value: 'x' }] })).toContain('1 пол.')
  })
})

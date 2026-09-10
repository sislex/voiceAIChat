import { describe, expect, it } from 'vitest'
import { placeScenario } from './scenarioPlacement'

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

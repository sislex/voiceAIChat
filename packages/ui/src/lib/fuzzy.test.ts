import { describe, it, expect } from 'vitest'
import { fuzzyMatch } from './fuzzy'

describe('fuzzyMatch', () => {
  it('находит подпоследовательность и возвращает индексы совпавших букв', () => {
    const hit = fuzzyMatch('Открыть настройки', 'онс')
    expect(hit).not.toBeNull()
    expect(hit!.indices.map((i) => 'Открыть настройки'[i]).join('')).toBe('Онс')
  })

  it('регистр не важен', () => {
    expect(fuzzyMatch('Новая беседа', 'НБ')).not.toBeNull()
    expect(fuzzyMatch('новая беседа', 'нб')).not.toBeNull()
  })

  it('несовпадение — null', () => {
    expect(fuzzyMatch('Новая беседа', 'xyz')).toBeNull()
    // Буквы есть, но не в этом порядке.
    expect(fuzzyMatch('абв', 'вба')).toBeNull()
    // Запрос длиннее текста.
    expect(fuzzyMatch('аб', 'абв')).toBeNull()
  })

  it('пустой запрос совпадает со всем без подсветки', () => {
    expect(fuzzyMatch('что угодно', '')).toEqual({ score: 0, indices: [] })
  })

  it('начало слова весит больше, чем середина', () => {
    const start = fuzzyMatch('Создать проект', 'сп')
    const middle = fuzzyMatch('расписание', 'сп')
    expect(start!.score).toBeGreaterThan(middle!.score)
  })

  it('подсветка выбирает начала слов, а не первое попавшееся вхождение', () => {
    const text = 'Командная палитра'
    const hit = fuzzyMatch(text, 'кп')
    // Жадный проход подсветил бы «Ко…мандная»; нам нужны первые буквы слов.
    expect(hit!.indices).toEqual([0, text.indexOf('п')])
  })

  it('совпадение подряд весит больше, чем с пропусками', () => {
    const solid = fuzzyMatch('беседа', 'бес')
    const spread = fuzzyMatch('булава если сон', 'бес')
    expect(solid!.score).toBeGreaterThan(spread!.score)
  })

  it('совпадение ближе к началу строки лучше при прочих равных', () => {
    const early = fuzzyMatch('ci ран задачи', 'ран')
    const late = fuzzyMatch('задачи проекта ран', 'ран')
    expect(early!.score).toBeGreaterThan(late!.score)
  })

  it('находит номер в ключе задачи', () => {
    const hit = fuzzyMatch('VC-42 · Починить логин', '42')
    expect(hit).not.toBeNull()
    expect(hit!.indices).toEqual([3, 4])
  })

  it('индексов ровно столько, сколько букв в запросе', () => {
    const hit = fuzzyMatch('Открыть консоль машины', 'окм')
    expect(hit!.indices).toHaveLength(3)
  })
})

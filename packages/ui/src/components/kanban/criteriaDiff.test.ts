import { describe, it, expect } from 'vitest'
import { diffCriteria, splitCriteria } from './criteriaDiff'

describe('diffCriteria', () => {
  it('снимает нумерацию и маркеры списка', () => {
    expect(splitCriteria('1. Первый\n2) Второй\n- Третий\n• Четвёртый')).toEqual(['Первый', 'Второй', 'Третий', 'Четвёртый'])
  })

  it('различает исходный, изменённый и добавленный пункт', () => {
    const source = '1. Запись запускается из композера.\n2. Текст сохраняется.'
    const current = '1. Запись запускается из композера.\n2. Текст сохраняется как редактируемый черновик.\n3. Состояние синхронизации доступно скринридеру.'
    expect(diffCriteria(source, current)).toEqual([
      { text: 'Запись запускается из композера.', state: 'original' },
      { text: 'Текст сохраняется как редактируемый черновик.', state: 'changed' },
      { text: 'Состояние синхронизации доступно скринридеру.', state: 'added' }
    ])
  })

  it('перенумерация списка не делает пункты новыми', () => {
    expect(diffCriteria('1. Альфа\n2. Бета', '2. Бета\n1. Альфа').map((item) => item.state)).toEqual(['original', 'original'])
  })

  it('одинаковый текст расходует исходные пункты по одному', () => {
    // Второй такой же пункт — уже добавленный: в исходной постановке он был один.
    const diff = diffCriteria('Повтор', 'Повтор\nПовтор')
    expect(diff.map((item) => item.state)).toEqual(['original', 'added'])
  })

  it('пустая исходная постановка делает все пункты добавленными', () => {
    expect(diffCriteria('', 'Первый\nВторой').map((item) => item.state)).toEqual(['added', 'added'])
  })

  it('полностью переписанный пункт считается новым, а не изменённым', () => {
    expect(diffCriteria('Запись запускается из композера', 'Кнопка экспорта в PDF на панели')[0]).toEqual({
      text: 'Кнопка экспорта в PDF на панели', state: 'added'
    })
  })
})

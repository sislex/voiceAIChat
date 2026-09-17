import { describe, expect, it } from 'vitest'
import { previewActionLabel, previewActionProgressLabel } from './actionLabel'

describe('подписи действий модели в ленте панели', () => {
  it('dismiss, peek и show читаются словами человека', () => {
    expect(previewActionLabel({ kind: 'dismiss', what: 'cookies' })).toBe('Убрал баннер cookie')
    expect(previewActionLabel({ kind: 'dismiss' })).toBe('Убрал баннер или окно')
    expect(previewActionLabel({ kind: 'click', text: 'Подробнее', peek: true })).toBe('Посмотрел, куда ведёт Подробнее')
    expect(previewActionLabel({ kind: 'click', text: 'Подробнее' })).toBe('Нажал Подробнее')
    expect(previewActionLabel({ kind: 'show', text: 'Оплатить' })).toBe('Показал Оплатить')
    expect(previewActionProgressLabel({ kind: 'dismiss', what: 'dialog' })).toBe('закрывает окно или баннер')
  })
})

describe('подписи круга 18', () => {
  it('закладки, чтение по частям и прокрутка до места читаются словами человека', () => {
    expect(previewActionLabel({ kind: 'bookmark', label: 'Сюда вернуться' })).toBe('Запомнил страницу как «Сюда вернуться»')
    expect(previewActionLabel({ kind: 'bookmark', remove: 'https://a.b/' })).toBe('Убрал закладку https://a.b/')
    expect(previewActionLabel({ kind: 'read', next: true })).toBe('Читал дальше')
    expect(previewActionLabel({ kind: 'read', toc: true })).toBe('Посмотрел оглавление')
    expect(previewActionLabel({ kind: 'read', table: 'Цены' })).toBe('Прочитал таблицу «Цены»')
    expect(previewActionLabel({ kind: 'scroll', until: 'Отзывы' })).toBe('Листал до «Отзывы»')
    expect(previewActionProgressLabel({ kind: 'bookmark' })).toBe('запоминает страницу')
  })
})

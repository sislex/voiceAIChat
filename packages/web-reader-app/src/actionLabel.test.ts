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

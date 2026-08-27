import { describe, expect, it } from 'vitest'
import { isBigMakeRequest } from './make'

describe('isBigMakeRequest', () => {
  it('переделка/редизайн/с нуля — большой запрос; точечная правка и подтверждение — нет', () => {
    expect(isBigMakeRequest('Переделай весь сайт в тёмном стиле')).toBe(true)
    expect(isBigMakeRequest('Сделай редизайн главной')).toBe(true)
    expect(isBigMakeRequest('Перепиши приложение на React с нуля')).toBe(true)
    expect(isBigMakeRequest('x'.repeat(601))).toBe(true)
    expect(isBigMakeRequest('Сделай заголовок синим')).toBe(false)
    expect(isBigMakeRequest('Да, делай')).toBe(false)
    expect(isBigMakeRequest('')).toBe(false)
  })
})

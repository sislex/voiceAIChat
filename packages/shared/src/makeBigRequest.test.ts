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

  it('служебный контекст редактора не считается словами пользователя', () => {
    expect(isBigMakeRequest('Сделай заголовок зелёным.\n\n[Контекст редактора Make] Открыт файл index.html, файл целиком. Правь именно здесь.')).toBe(false)
    expect(isBigMakeRequest('Перепиши всё с нуля.\n\n[Контекст редактора Make] Открыт файл index.html, без выделения.')).toBe(true)
  })
})

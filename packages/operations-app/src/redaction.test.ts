// Вычистка секретов из диагностики. Тест держит именно то, ради чего функция
// существует: наружу не должен уйти токен. Проверяется и по имени ключа, и по
// значению внутри строки — путей утечки два, и закрывать надо оба.

import { describe, expect, it } from 'vitest'
import { redactDiagnostics } from './redaction'

describe('redactDiagnostics', () => {
  it('выбрасывает ключи с секретными именами целиком, а не маскирует', () => {
    const input = { authorization: 'Bearer abc', token: 'xyz', password: 'p', cookie: 'c', secret: 's', credential: 'k', url: '/api/machines' }
    expect(redactDiagnostics(input)).toEqual({ url: '/api/machines' })
  })

  it('имена ключей сверяются без учёта регистра', () => {
    expect(redactDiagnostics({ Authorization: 'x', TOKEN: 'y', Ok: 1 })).toEqual({ Ok: 1 })
  })

  it('вырезаются и служебные ключи транспорта — они держат ссылки на сокеты', () => {
    expect(redactDiagnostics({ transport: {}, bridge: {}, socket: {}, machines: 2 })).toEqual({ machines: 2 })
  })

  it('секрет в значении строки заменяется на [REDACTED]', () => {
    expect(redactDiagnostics('Authorization: Bearer abc.def-ghi~jkl')).toBe('Authorization: [REDACTED]')
    expect(redactDiagnostics('?token=abc&x=1')).toBe('?[REDACTED]')
    expect(redactDiagnostics('secret=s3cr3t')).toBe('[REDACTED]')
    expect(redactDiagnostics('password=p@ss')).toBe('[REDACTED]')
  })

  it('несколько секретов в одной строке чистятся все', () => {
    expect(redactDiagnostics('token=a затем Bearer b')).toBe('[REDACTED] затем [REDACTED]')
  })

  it('строка без секретов не меняется', () => {
    expect(redactDiagnostics('машина online, 3 из 4')).toBe('машина online, 3 из 4')
  })

  it('чистка рекурсивна: вложенные объекты и массивы тоже', () => {
    const input = { machines: [{ name: 'a', token: 't' }, { name: 'b', log: 'Bearer zzz' }], nested: { deep: { password: 'p', keep: 1 } } }
    expect(redactDiagnostics(input)).toEqual({
      machines: [{ name: 'a' }, { name: 'b', log: '[REDACTED]' }],
      nested: { deep: { keep: 1 } }
    })
  })

  it('скаляры и null проходят как есть — чистить нечего', () => {
    expect(redactDiagnostics(42)).toBe(42)
    expect(redactDiagnostics(true)).toBe(true)
    expect(redactDiagnostics(null)).toBeNull()
    expect(redactDiagnostics(undefined)).toBeUndefined()
  })
})

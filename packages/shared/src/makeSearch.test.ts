import { describe, expect, it } from 'vitest'
import { buildMakeSearchRegex, previewMakeReplace } from './makeSearch'

describe('buildMakeSearchRegex', () => {
  it('без regex экранирует спецсимволы и игнорирует регистр', () => {
    const re = buildMakeSearchRegex('a.b(')
    expect(re.test('xA.B(y')).toBe(true)
    expect(re.test('axb(')).toBe(false)
  })
  it('regex + matchCase', () => {
    const re = buildMakeSearchRegex('col(or|our)', { regex: true, matchCase: true })
    expect(re.test('colour')).toBe(true)
    expect(re.test('Colour')).toBe(false)
  })
  it('невалидное и пустое выражение — ошибка', () => {
    expect(() => buildMakeSearchRegex('(', { regex: true })).toThrow(SyntaxError)
    expect(() => buildMakeSearchRegex('a*', { regex: true })).toThrow(/пустой/)
  })
})

describe('previewMakeReplace', () => {
  it('показывает до/после по строкам с подстановкой групп', () => {
    const re = buildMakeSearchRegex('--(\\w+): #fff', { regex: true })
    const rows = previewMakeReplace('styles.css', ':root { --bg: #fff; }\nbody {}\n.x { --card: #FFF }', re, '--$1: white')
    expect(rows).toEqual([
      { path: 'styles.css', line: 1, before: ':root { --bg: #fff; }', after: ':root { --bg: white; }' },
      { path: 'styles.css', line: 3, before: '.x { --card: #FFF }', after: '.x { --card: white }' }
    ])
  })
})

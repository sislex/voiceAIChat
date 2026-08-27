import { describe, expect, it } from 'vitest'
import { cssRule, shortSelector, toHex } from './MakeStylePanel'

describe('MakeStylePanel helpers', () => {
  it('shortSelector: id → класс → селектор инспектора', () => {
    expect(shortSelector('main > h1', 'title', 'a b')).toBe('#title')
    expect(shortSelector('main > h1', '', ' hero__title big ')).toBe('.hero__title')
    expect(shortSelector('main > h1')).toBe('main > h1')
    expect(shortSelector('div#root > main.app > section.card:nth-of-type(1) > h2')).toBe('section.card > h2')
  })
  it('toHex: rgb → hex, прозрачное → пусто', () => {
    expect(toHex('rgb(79, 124, 255)')).toBe('#4f7cff')
    expect(toHex('rgba(0, 0, 0, 0)')).toBe('')
    expect(toHex('#abc')).toBe('#abc')
  })
  it('cssRule собирает только непустые свойства', () => {
    expect(cssRule('.x', { color: '#fff', padding: '' , 'font-size': '18px' })).toBe('.x {\n  color: #fff;\n  font-size: 18px;\n}\n')
  })
})

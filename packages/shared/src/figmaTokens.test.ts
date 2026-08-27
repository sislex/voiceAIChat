import { describe, expect, it } from 'vitest'
import { parseFigmaTokens } from './figmaTokens'

describe('parseFigmaTokens', () => {
  it('Figma Variables API: цвета из r/g/b, числа как px, алиасы пропускаются, режим по имени', () => {
    const json = JSON.stringify({
      modes: { m1: 'Light', m2: 'Dark' },
      variables: {
        a: { name: 'color/bg', resolvedType: 'COLOR', valuesByMode: { m1: { r: 1, g: 1, b: 1, a: 1 }, m2: { r: 0.1, g: 0.1, b: 0.1, a: 1 } } },
        b: { name: 'space/md', resolvedType: 'FLOAT', valuesByMode: { m1: 16 } },
        c: { name: 'color/link', resolvedType: 'COLOR', valuesByMode: { m1: { type: 'VARIABLE_ALIAS', id: 'a' } } }
      }
    })
    expect(parseFigmaTokens(json)).toEqual([{ name: '--color-bg', value: '#ffffff' }, { name: '--space-md', value: '16px' }])
    expect(parseFigmaTokens(json, { mode: 'Dark' })[0]).toEqual({ name: '--color-bg', value: '#1a1a1a' })
  })
  it('Tokens Studio / W3C: вложенные группы с value/$value, ссылки {…} пропускаются', () => {
    const json = JSON.stringify({ global: { accent: { value: '#e5484d', type: 'color' }, radius: { $value: 8, $type: 'dimension' }, alias: { value: '{global.accent}', type: 'color' } } })
    expect(parseFigmaTokens(json)).toEqual([{ name: '--global-accent', value: '#e5484d' }, { name: '--global-radius', value: '8px' }])
  })
  it('плоская карта и невалидный JSON', () => {
    expect(parseFigmaTokens('{"--bg":"#fff","Gap Large":12}')).toEqual([{ name: '--bg', value: '#fff' }, { name: '--gap-large', value: '12' }])
    expect(() => parseFigmaTokens('{')).toThrow(SyntaxError)
  })
})

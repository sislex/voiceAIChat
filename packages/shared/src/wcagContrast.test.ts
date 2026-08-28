import { describe, expect, it } from 'vitest'
import { contrastPairs, contrastRatio, parseColor } from './wcagContrast'

describe('wcagContrast', () => {
  it('parseColor: hex короткий/длинный/с альфой и rgb()', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255])
    expect(parseColor('#1a1d23')).toEqual([26, 29, 35])
    expect(parseColor('#00000080')).toEqual([0, 0, 0])
    expect(parseColor('rgb(10, 20, 30)')).toEqual([10, 20, 30])
    expect(parseColor('var(--x)')).toBeNull()
  })
  it('contrastRatio: чёрный на белом = 21, одинаковые = 1', () => {
    expect(contrastRatio('#000', '#fff')).toBe(21)
    expect(contrastRatio('#fff', '#fff')).toBe(1)
    expect(contrastRatio('#e5484d', '#fff')).toBe(3.91)
  })
  it('contrastPairs: текст/акцент × фоны, отсортировано по возрастанию, с уровнями AA/AAA', () => {
    const pairs = contrastPairs([{ name: '--bg', value: '#fff' }, { name: '--fg', value: '#1a1d23' }, { name: '--accent', value: '#e5484d' }, { name: '--card', value: '#fff' }, { name: '--radius', value: '8px' }])
    expect(pairs.map((p) => `${p.fg}/${p.bg}`)).toEqual(['--accent/--bg', '--accent/--card', '--fg/--bg', '--fg/--card'])
    expect(pairs[0]).toMatchObject({ aa: false, aaLarge: true, aaa: false })
    expect(pairs[2]).toMatchObject({ aa: true, aaa: true })
  })
})

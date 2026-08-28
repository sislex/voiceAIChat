import { describe, expect, it } from 'vitest'
import { applyDarkThemeBlock, buildDarkThemeBlock, darkValueFor } from './darkTheme'
import { contrastRatio } from './wcagContrast'

describe('darkTheme', () => {
  it('фоны темнеют, текст светлеет, контраст пары остаётся читаемым', () => {
    const bg = darkValueFor('--bg', '#ffffff')!, fg = darkValueFor('--fg', '#1a1d23')!
    expect(bg < '#333333').toBe(true)
    expect(fg > '#cccccc').toBe(true)
    expect(contrastRatio(fg, bg)!).toBeGreaterThan(7)
    expect(darkValueFor('--radius', '8px')).toBeNull()
  })
  it('блок [data-theme=dark] добавляется и заменяется без дублей', () => {
    const block = buildDarkThemeBlock([{ name: '--bg', value: '#fff' }, { name: '--gap', value: '8px' }])
    expect(block).toMatch(/^\[data-theme=dark\] \{\n  --bg: #[0-9a-f]{6};\n\}$/)
    const once = applyDarkThemeBlock(':root { --bg: #fff; }', block)
    expect(once).toContain('/* Тёмная тема')
    const twice = applyDarkThemeBlock(once, buildDarkThemeBlock([{ name: '--bg', value: '#eee' }]))
    expect(twice.match(/\[data-theme=dark\]/g)).toHaveLength(1)
  })
})

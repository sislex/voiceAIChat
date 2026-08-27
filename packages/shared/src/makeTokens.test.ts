import { describe, expect, it } from 'vitest'
import { MAKE_TOKENS_STARTER, parseCssTokens, pickTokensFile, removeCssToken, setCssToken } from './makeTokens'

describe('дизайн-токены Make', () => {
  it('парсит переменные из :root с классификацией и игнорирует комментарии', () => {
    const css = `:root { --bg: #fff; /* --skip: 1px; */ --gap: 8px; --font: system-ui, sans-serif; --shadow: 0 1px 2px rgba(0,0,0,.2); }\n.a { --local: 1 }`
    const tokens = parseCssTokens(css)
    expect(tokens.map((t) => [t.name, t.kind])).toEqual([['--bg', 'color'], ['--gap', 'size'], ['--font', 'font'], ['--shadow', 'other']])
    expect(tokens.find((t) => t.name === '--skip')).toBeUndefined()
  })

  it('меняет значение на месте, сохраняя остальной текст; новое — добавляет в :root', () => {
    const css = `/* c */\n:root {\n  --bg: #fff;\n}\n.a { color: var(--bg) }\n`
    expect(setCssToken(css, '--bg', '#000')).toBe(`/* c */\n:root {\n  --bg: #000;\n}\n.a { color: var(--bg) }\n`)
    expect(setCssToken(css, '--gap', '4px')).toContain(':root {\n  --gap: 4px;\n  --bg: #fff;')
    expect(setCssToken('', '--x', '1')).toBe(':root {\n  --x: 1;\n}\n')
  })

  it('удаляет объявление', () => {
    expect(removeCssToken(`:root {\n  --a: 1;\n  --b: 2;\n}`, '--a')).toBe(`:root {\n  --b: 2;\n}`)
  })

  it('выбирает файл токенов и стартовый набор парсится', () => {
    expect(pickTokensFile(['index.html', 'styles.css', 'tokens.css'])).toBe('tokens.css')
    expect(pickTokensFile(['index.html', 'styles.css'])).toBe('styles.css')
    expect(pickTokensFile(['index.html'])).toBeNull()
    expect(parseCssTokens(MAKE_TOKENS_STARTER).length).toBeGreaterThan(10)
  })
})

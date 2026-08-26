import { describe, expect, it } from 'vitest'
import { HIGHLIGHT_MAX_CHARS, highlightCode, languageForPath } from './codeHighlight'

describe('codeHighlight', () => {
  it('язык по расширению', () => {
    expect(languageForPath('index.html')).toBe('xml')
    expect(languageForPath('css/app.css')).toBe('css')
    expect(languageForPath('app.js')).toBe('javascript')
    expect(languageForPath('logo.png')).toBeNull()
  })

  it('подсвечивает известный язык спанами hljs и экранирует остальное', () => {
    expect(highlightCode('<a href="x">t</a>', 'index.html')).toContain('hljs-tag')
    expect(highlightCode('<b>', 'notes.txt')).toBe('&lt;b&gt;')
    expect(highlightCode('x'.repeat(HIGHLIGHT_MAX_CHARS + 1), 'app.js')).not.toContain('hljs-')
  })

  it('хвостовой перенос строки сохраняет высоту последней строки', () => {
    expect(highlightCode('a\n', 'notes.txt')).toBe('a\n ')
  })
})

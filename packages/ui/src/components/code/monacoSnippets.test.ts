import { describe, expect, it } from 'vitest'
import { MAKE_SNIPPETS, snippetWordAt, snippetsFor } from './monacoSnippets'

describe('monacoSnippets', () => {
  it('rfc/story — для TS/JS, token — для CSS; префиксы уникальны', () => {
    expect(snippetsFor('typescript').map((s) => s.prefix)).toEqual(['rfc', 'story'])
    expect(snippetsFor('css').map((s) => s.prefix)).toEqual(['token'])
    expect(snippetsFor('html')).toEqual([])
    expect(new Set(MAKE_SNIPPETS.map((s) => s.prefix)).size).toBe(MAKE_SNIPPETS.length)
  })
  it('тела сниппетов используют табстопы и заканчиваются $0', () => {
    for (const s of MAKE_SNIPPETS) { expect(s.body).toMatch(/\$\{1:/); expect(s.body).toContain('$0') }
  })
  it('snippetWordAt берёт слово перед курсором и его начало', () => {
    expect(snippetWordAt('  rfc', 6)).toEqual({ word: 'rfc', startColumn: 3 })
    expect(snippetWordAt('const x = ', 11)).toEqual({ word: '', startColumn: 11 })
  })
})

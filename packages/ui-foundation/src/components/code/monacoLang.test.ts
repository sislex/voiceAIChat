import { describe, expect, it } from 'vitest'
import { jsxClosingTagFor, monacoLanguageFor } from './monacoLang'

describe('monacoLang', () => {
  it('язык по расширению: tsx/jsx → typescript/javascript', () => {
    expect(monacoLanguageFor('src/App.tsx')).toBe('typescript')
    expect(monacoLanguageFor('src/App.jsx')).toBe('javascript')
    expect(monacoLanguageFor('index.html')).toBe('html')
    expect(monacoLanguageFor('notes.txt')).toBe('plaintext')
  })

  it('jsxClosingTagFor: открывающий тег → закрывающий; самозакрывающийся, закрывающий и сравнения — нет', () => {
    expect(jsxClosingTagFor('return <div className="a">')).toBe('</div>')
    expect(jsxClosingTagFor('<Card.Header>')).toBe('</Card.Header>')
    expect(jsxClosingTagFor('<img src="x" />')).toBeNull()
    expect(jsxClosingTagFor('</div>')).toBeNull()
    expect(jsxClosingTagFor('const f = () => a > b ? 1 : 2; if (x >')).toBeNull()
    expect(jsxClosingTagFor('const g = (a) =>')).toBeNull()
  })
})

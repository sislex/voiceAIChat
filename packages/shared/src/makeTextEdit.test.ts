import { describe, expect, it } from 'vitest'
import { escapeMarkupText, replaceUniqueText } from './makeTextEdit'

describe('replaceUniqueText', () => {
  it('меняет единственное вхождение, терпит переносы внутри текста', () => {
    expect(replaceUniqueText('<h1>Привет</h1>\n<p>мир</p>', 'Привет', 'Здравствуй')).toBe('<h1>Здравствуй</h1>\n<p>мир</p>')
    expect(replaceUniqueText('<p>\n  Длинный\n  текст\n</p>', 'Длинный текст', 'Короткий')).toBe('<p>\n  Короткий\n</p>')
  })
  it('0 или несколько вхождений — null', () => {
    expect(replaceUniqueText('<p>a</p><p>a</p>', 'a', 'b')).toBeNull()
    expect(replaceUniqueText('<p>a</p>', 'zzz', 'b')).toBeNull()
    expect(replaceUniqueText('<p>a</p>', '  ', 'b')).toBeNull()
  })
  it('escapeMarkupText экранирует спецсимволы', () => {
    expect(escapeMarkupText('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d')
  })
})

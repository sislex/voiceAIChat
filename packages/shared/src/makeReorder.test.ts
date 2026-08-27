import { describe, expect, it } from 'vitest'
import { reorderMarkup } from './makeReorder'

const src = ['<main>', '  <section id="a">A</section>', '  <section id="b">B</section>', '  <section id="c">C</section>', '</main>'].join('\n')

describe('reorderMarkup', () => {
  it('переносит секцию после соседа с сохранением отступа', () => {
    expect(reorderMarkup(src, '<section id="a">A</section>', '<section id="c">C</section>', 'after')).toBe(
      ['<main>', '  <section id="b">B</section>', '  <section id="c">C</section>', '  <section id="a">A</section>', '</main>'].join('\n'))
  })
  it('переносит секцию перед соседом выше', () => {
    expect(reorderMarkup(src, '<section id="c">C</section>', '<section id="a">A</section>', 'before')).toBe(
      ['<main>', '  <section id="c">C</section>', '  <section id="a">A</section>', '  <section id="b">B</section>', '</main>'].join('\n'))
  })
  it('терпит разницу в пробелах и переносах внутри фрагмента', () => {
    const multi = '<ul>\n  <li class="x">\n    один\n  </li>\n  <li>два</li>\n</ul>'
    expect(reorderMarkup(multi, '<li class="x"> один </li>', '<li>два</li>', 'after')).toBe('<ul>\n  <li>два</li>\n  <li class="x">\n    один\n  </li>\n</ul>')
  })
  it('неуникальные или ненайденные фрагменты — null', () => {
    expect(reorderMarkup('<p>a</p><p>a</p><p>b</p>', '<p>a</p>', '<p>b</p>', 'after')).toBeNull()
    expect(reorderMarkup(src, '<div>nope</div>', '<section id="c">C</section>', 'after')).toBeNull()
  })
})

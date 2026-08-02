import { describe, it, expect } from 'vitest'
import { splitSnippet } from './snippet'

describe('splitSnippet', () => {
  it('делит текст на обычные куски и совпадения', () => {
    expect(splitSnippet('…обсудили <mark>миграцию</mark> канбана…')).toEqual([
      { text: '…обсудили ', hit: false },
      { text: 'миграцию', hit: true },
      { text: ' канбана…', hit: false }
    ])
  })

  it('несколько совпадений подряд', () => {
    expect(splitSnippet('<mark>a</mark><mark>b</mark>')).toEqual([
      { text: 'a', hit: true },
      { text: 'b', hit: true }
    ])
  })

  it('текст без разметки — один кусок', () => {
    expect(splitSnippet('просто текст')).toEqual([{ text: 'просто текст', hit: false }])
    expect(splitSnippet('')).toEqual([])
  })

  it('разметка из самого сообщения не ломает разбор', () => {
    // Незакрытая метка: остаток считаем совпадением, а не теряем текст.
    expect(splitSnippet('код <mark>обрезан')).toEqual([
      { text: 'код ', hit: false },
      { text: 'обрезан', hit: true }
    ])
    // Лишняя закрывающая — обычный текст.
    expect(splitSnippet('хвост </mark> дальше')).toEqual([{ text: 'хвост </mark> дальше', hit: false }])
    // HTML внутри сообщения остаётся текстом (в React он не станет разметкой).
    expect(splitSnippet('<script>alert(1)</script> <mark>тут</mark>')).toEqual([
      { text: '<script>alert(1)</script> ', hit: false },
      { text: 'тут', hit: true }
    ])
  })
})

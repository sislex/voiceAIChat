import { describe, expect, it } from 'vitest'
import { pageScrollState, toolbarHiddenAfterScroll } from './pageScroll'

describe('pageScrollState: прогресс чтения и кнопка «к началу»', () => {
  it('считает процент и показывает кнопку после полутора экранов', () => {
    expect(pageScrollState(0, 3000, 600)).toEqual({ progress: 0, showTop: false })
    expect(pageScrollState(1200, 3000, 600)).toEqual({ progress: 50, showTop: true })
    expect(pageScrollState(2400, 3000, 600)).toEqual({ progress: 100, showTop: true })
  })
  it('страница без прокрутки — прочитана целиком, кнопка не нужна', () => {
    expect(pageScrollState(0, 500, 600)).toEqual({ progress: 100, showTop: false })
  })
})

describe('toolbarHiddenAfterScroll: панель прячется только на телефоне и только при чтении вниз', () => {
  it('на широком экране панель никогда не прячется', () => {
    expect(toolbarHiddenAfterScroll(false, 0, 800, false)).toBe(false)
    expect(toolbarHiddenAfterScroll(true, 0, 800, false)).toBe(false)
  })
  it('на телефоне: вниз — спрятать, вверх — показать, у самого верха — всегда видна', () => {
    expect(toolbarHiddenAfterScroll(false, 100, 300, true)).toBe(true)
    expect(toolbarHiddenAfterScroll(true, 300, 305, true)).toBe(true)
    expect(toolbarHiddenAfterScroll(true, 300, 250, true)).toBe(false)
    expect(toolbarHiddenAfterScroll(true, 300, 40, true)).toBe(false)
  })
})

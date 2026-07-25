import { describe, it, expect } from 'vitest'
import { autoGrowHeight } from './autoGrow'

// Метрики композера: line-height 1.4 от 14px, паддинги 13px сверху/снизу, рамка 1px.
const base = { lineHeight: 19.6, paddingY: 26, borderY: 2, minRows: 2, maxRows: 4 }
const rows = (n: number): number => n * base.lineHeight + base.paddingY

describe('autoGrowHeight', () => {
  it('пустое поле — минимум в две строки', () => {
    expect(autoGrowHeight({ ...base, contentHeight: rows(1) })).toBeCloseTo(rows(2) + 2)
  })

  it('три строки текста — три строки высоты', () => {
    expect(autoGrowHeight({ ...base, contentHeight: rows(3) })).toBeCloseTo(rows(3) + 2)
  })

  it('четыре строки — всё ещё растём', () => {
    expect(autoGrowHeight({ ...base, contentHeight: rows(4) })).toBeCloseTo(rows(4) + 2)
  })

  it('пять и больше строк — упираемся в четыре, дальше скролл', () => {
    expect(autoGrowHeight({ ...base, contentHeight: rows(5) })).toBeCloseTo(rows(4) + 2)
    expect(autoGrowHeight({ ...base, contentHeight: rows(40) })).toBeCloseTo(rows(4) + 2)
  })
})

import { describe, expect, it } from 'vitest'
import { ACTIVE_WINDOW_MS, budgetShare, isActiveNow, monthStart, spendUsd } from './admin'

describe('spendUsd', () => {
  it('берёт большую из двух оценок: CLI часто молчит, а прайс покрывает не все модели', () => {
    expect(spendUsd({ costUsd: 1.5, costFromPrices: 0 })).toBe(1.5)
    expect(spendUsd({ costUsd: 0, costFromPrices: 2.25 })).toBe(2.25)
    expect(spendUsd({ costUsd: 3 })).toBe(3)
  })
})

describe('budgetShare', () => {
  it('без лимита процента нет — общего бюджета в системе не существует', () => {
    expect(budgetShare(10, null)).toBeNull()
    expect(budgetShare(10, undefined)).toBeNull()
    expect(budgetShare(10, 0)).toBeNull()
  })
  it('считает долю и не обрезает перерасход: превышение нужно видеть', () => {
    expect(budgetShare(50, 200)).toBe(0.25)
    expect(budgetShare(250, 200)).toBe(1.25)
  })
})

describe('isActiveNow', () => {
  const now = Date.UTC(2026, 7, 31, 12, 0, 0)
  it('активен, пока последняя активность внутри окна', () => {
    expect(isActiveNow(now - 60_000, now)).toBe(true)
    expect(isActiveNow(now - ACTIVE_WINDOW_MS, now)).toBe(true)
    expect(isActiveNow(now - ACTIVE_WINDOW_MS - 1, now)).toBe(false)
  })
  it('без живых сессий активности нет', () => {
    expect(isActiveNow(null, now)).toBe(false)
    expect(isActiveNow(undefined, now)).toBe(false)
  })
})

describe('monthStart', () => {
  it('первое число текущего месяца, полночь', () => {
    const start = new Date(monthStart(new Date(2026, 7, 31, 18, 42, 7).getTime()))
    expect(start.getDate()).toBe(1)
    expect(start.getMonth()).toBe(7)
    expect(start.getHours()).toBe(0)
    expect(start.getMinutes()).toBe(0)
  })
})

import { describe, it, expect } from 'vitest'
import { estimateKbTokens } from './kb'

describe('оценка токенов базы знаний', () => {
  it('ceil(chars/4) — одна формула для сервера и UI', () => {
    expect(estimateKbTokens(0)).toBe(0)
    expect(estimateKbTokens(1)).toBe(1)
    expect(estimateKbTokens(4)).toBe(1)
    expect(estimateKbTokens(5)).toBe(2)
    expect(estimateKbTokens(4000)).toBe(1000)
  })

  it('отрицательная длина не даёт отрицательных токенов', () => {
    expect(estimateKbTokens(-10)).toBe(0)
  })
})

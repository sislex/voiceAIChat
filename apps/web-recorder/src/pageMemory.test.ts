import { beforeEach, describe, expect, it } from 'vitest'
import { forgetScrollPositions, rememberScroll, rememberedScroll } from './pageMemory'

beforeEach(() => forgetScrollPositions())

describe('pageMemory: панель помнит, где человек остановился', () => {
  it('возвращает позицию той же страницы и ноль для незнакомой', () => {
    rememberScroll('https://docs.example/guide', 840)
    expect(rememberedScroll('https://docs.example/guide')).toBe(840)
    expect(rememberedScroll('https://docs.example/other')).toBe(0)
    expect(rememberedScroll(null)).toBe(0)
  })
  it('перезаписывает позицию и не хранит мусор', () => {
    rememberScroll('https://docs.example/guide', 100)
    rememberScroll('https://docs.example/guide', 300)
    expect(rememberedScroll('https://docs.example/guide')).toBe(300)
    rememberScroll('https://docs.example/guide', Number.NaN)
    rememberScroll('https://docs.example/guide', -5)
    expect(rememberedScroll('https://docs.example/guide')).toBe(300)
  })
  it('держит не больше тридцати страниц, вытесняя самые старые', () => {
    for (let index = 0; index < 32; index++) rememberScroll(`https://docs.example/p${index}`, index + 1)
    expect(rememberedScroll('https://docs.example/p0')).toBe(0)
    expect(rememberedScroll('https://docs.example/p31')).toBe(32)
  })
})

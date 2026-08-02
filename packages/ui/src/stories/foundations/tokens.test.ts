// Математика контраста живёт в сториз Foundations, но проверяется обычным
// тестом: цифры в витрине — единственный ответ на вопрос «проходит ли пара AA»,
// и ошибка в формуле означала бы зелёную отметку у нечитаемого текста.
import { describe, expect, it } from 'vitest'
import { contrastRatio, fmtRatio, parseCssColor, relativeLuminance, wcagLevel } from './tokens'

describe('parseCssColor', () => {
  it('разбирает rgb() и rgba() из getComputedStyle', () => {
    expect(parseCssColor('rgb(61, 100, 200)')).toEqual([61, 100, 200])
    expect(parseCssColor('rgba(0, 0, 0, 0.5)')).toEqual([0, 0, 0])
  })

  it('понимает color(srgb …) — так Хром печатает результат color-mix()', () => {
    expect(parseCssColor('color(srgb 0.5 0.25 1)')).toEqual([127.5, 63.75, 255])
  })

  it('на непонятном значении отдаёт null, а не нули', () => {
    expect(parseCssColor('')).toBeNull()
    expect(parseCssColor('12px')).toBeNull()
  })
})

describe('contrastRatio', () => {
  const white = [255, 255, 255] as const
  const black = [0, 0, 0] as const

  it('крайние случаи: чёрный на белом — 21, цвет сам на себе — 1', () => {
    expect(contrastRatio(white, black)).toBeCloseTo(21, 5)
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5)
  })

  it('не зависит от порядка аргументов', () => {
    expect(contrastRatio([61, 100, 200], white)).toBeCloseTo(contrastRatio(white, [61, 100, 200]), 10)
  })

  it('совпадает с эталоном WCAG: #767676 на белом — граница AA', () => {
    expect(contrastRatio([118, 118, 118], white)).toBeCloseTo(4.54, 2)
  })

  it('яркость белого — 1, чёрного — 0', () => {
    expect(relativeLuminance(white)).toBeCloseTo(1, 10)
    expect(relativeLuminance(black)).toBeCloseTo(0, 10)
  })
})

describe('wcagLevel', () => {
  it('порог AA — 4.5, крупного текста — 3, AAA — 7', () => {
    expect(wcagLevel(21)).toBe('AAA')
    expect(wcagLevel(7)).toBe('AAA')
    expect(wcagLevel(4.5)).toBe('AA')
    expect(wcagLevel(4.49)).toBe('AA Large')
    expect(wcagLevel(3)).toBe('AA Large')
    expect(wcagLevel(2.99)).toBe('fail')
  })
})

it('коэффициент печатается с двумя знаками', () => {
  expect(fmtRatio(4.5)).toBe('4.50 : 1')
})

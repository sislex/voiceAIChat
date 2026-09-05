import { describe, it, expect } from 'vitest'
import { dominantColors, toHex } from './imagePalette'

/** Пиксели одним массивом RGBA — как их отдаёт canvas. */
function pixels(...colors: Array<[number, number, number, number]>): number[] {
  return colors.flat()
}

describe('toHex', () => {
  it('склеивает каналы и прижимает выход за границы', () => {
    expect(toHex(26, 43, 60)).toBe('#1a2b3c')
    expect(toHex(-5, 300, 0)).toBe('#00ff00')
    expect(toHex(127.6, 0, 0)).toBe('#800000')
  })
})

describe('dominantColors', () => {
  it('самый частый цвет — первый', () => {
    const data = pixels([255, 0, 0, 255], [255, 0, 0, 255], [0, 0, 255, 255])
    expect(dominantColors(data, 2)).toEqual(['#ff0000', '#0000ff'])
  })

  it('прозрачные пиксели не участвуют: логотип на пустом фоне', () => {
    const data = pixels([0, 0, 0, 0], [0, 0, 0, 0], [18, 52, 86, 255])
    expect(dominantColors(data, 3)).toEqual(['#123456'])
  })

  it('близкие оттенки складываются в одно ведро со средним цветом', () => {
    // 0x10 и 0x1f попадают в одно ведро старших четырёх бит.
    const data = pixels([16, 16, 16, 255], [31, 31, 31, 255])
    expect(dominantColors(data, 5)).toEqual(['#181818'])
  })

  it('количество цветов ограничено запросом, но не меньше одного', () => {
    const data = pixels([255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255])
    expect(dominantColors(data, 2)).toHaveLength(2)
    expect(dominantColors(data, 0)).toHaveLength(1)
  })

  it('пустой массив не роняет расчёт', () => {
    expect(dominantColors([], 3)).toEqual([])
  })
})

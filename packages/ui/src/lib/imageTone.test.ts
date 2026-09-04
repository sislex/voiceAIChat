import { describe, it, expect } from 'vitest'
import { applyLut, computeChannelHistograms, computeHistogram, histogramBars, levelsLut, levelsRange, unsharpPixels } from './imageTone'

/** Пиксели RGBA одним массивом, как их отдаёт canvas. */
function pixels(...colors: Array<[number, number, number, number]>): number[] {
  return colors.flat()
}

describe('computeHistogram', () => {
  it('считает яркость по Rec. 601 и игнорирует прозрачное', () => {
    const hist = computeHistogram(pixels([0, 0, 0, 255], [255, 255, 255, 255], [10, 10, 10, 0]))
    expect(hist[0]).toBe(1)
    expect(hist[255]).toBe(1)
    expect(hist.reduce((sum, value) => sum + value, 0)).toBe(2)
  })

  it('зелёный весит больше синего — это и есть яркость, а не среднее', () => {
    const green = computeHistogram(pixels([0, 255, 0, 255]))
    const blue = computeHistogram(pixels([0, 0, 255, 255]))
    const greenBin = green.findIndex((value) => value > 0)
    const blueBin = blue.findIndex((value) => value > 0)
    expect(greenBin).toBeGreaterThan(blueBin)
  })
})

describe('levelsRange', () => {
  it('находит границы и отбрасывает хвосты', () => {
    const hist = new Array<number>(256).fill(0)
    hist[50] = 1000
    hist[200] = 1000
    hist[0] = 1 // случайный чёрный пиксель — в хвосте
    expect(levelsRange(hist)).toEqual({ min: 50, max: 200 })
  })

  it('пустая гистограмма и уже растянутая — тянуть нечего', () => {
    expect(levelsRange(new Array<number>(256).fill(0))).toBeNull()
    const full = new Array<number>(256).fill(0)
    full[0] = 1000
    full[255] = 1000
    expect(levelsRange(full)).toBeNull()
  })

  it('слишком узкий диапазон не растягиваем — это шум, а не картинка', () => {
    const hist = new Array<number>(256).fill(0)
    hist[100] = 500
    hist[103] = 500
    expect(levelsRange(hist)).toBeNull()
  })
})

describe('levelsLut и applyLut', () => {
  it('таблица растягивает диапазон на всю шкалу', () => {
    const lut = levelsLut({ min: 50, max: 200 })
    expect(lut[50]).toBe(0)
    expect(lut[200]).toBe(255)
    expect(lut[125]).toBeGreaterThan(120)
    expect(lut[125]).toBeLessThan(135)
  })

  it('применение не трогает альфу', () => {
    const data = pixels([50, 50, 50, 128], [200, 200, 200, 255])
    applyLut(data, levelsLut({ min: 50, max: 200 }))
    expect(data).toEqual([0, 0, 0, 128, 255, 255, 255, 255])
  })
})

describe('unsharpPixels', () => {
  it('поднимает разницу с размытием', () => {
    const base = pixels([100, 100, 100, 255])
    unsharpPixels(base, pixels([80, 80, 80, 255]), 1)
    expect(base.slice(0, 3)).toEqual([120, 120, 120])
  })

  it('нулевая сила ничего не меняет, значения не выходят за 0..255', () => {
    const same = pixels([100, 100, 100, 255])
    unsharpPixels(same, pixels([50, 50, 50, 255]), 0)
    expect(same.slice(0, 3)).toEqual([100, 100, 100])
    const bright = pixels([250, 5, 250, 255])
    unsharpPixels(bright, pixels([100, 200, 100, 255]), 5)
    expect(bright.slice(0, 3)).toEqual([255, 0, 255])
  })
})

describe('histogramBars', () => {
  it('сводит 256 значений к запрошенному числу столбиков в процентах', () => {
    const hist = new Array<number>(256).fill(0)
    hist[0] = 100
    hist[255] = 1
    const bars = histogramBars(hist, 8)
    expect(bars).toHaveLength(8)
    expect(bars[0]).toBe(100)
    expect(bars[7]).toBeGreaterThan(0)
    expect(bars[7]).toBeLessThan(100)
  })

  it('пустая гистограмма даёт нули, а не деление на ноль', () => {
    expect(histogramBars(new Array<number>(256).fill(0), 4)).toEqual([0, 0, 0, 0])
  })
})

describe('computeChannelHistograms', () => {
  it('считает каналы отдельно и пропускает прозрачные пиксели', () => {
    // Два пикселя: красный видимый и зелёный полностью прозрачный.
    const channels = computeChannelHistograms([255, 0, 0, 255, 0, 255, 0, 0])
    expect(channels.r[255]).toBe(1)
    expect(channels.g[0]).toBe(1)
    expect(channels.b[0]).toBe(1)
    // Прозрачный не попал ни в один канал.
    expect(channels.g[255]).toBe(0)
    expect(channels.r.reduce((sum, value) => sum + value, 0)).toBe(1)
  })
})

// Тональная обработка картинок студии: гистограмма яркости, автоуровни и
// резкость. Всё пиксельное ядро — чистые функции над массивом RGBA: они
// проверяются без canvas, а canvas остаётся только способом достать и вернуть
// пиксели.

/** Сколько столбиков в гистограмме: 256 — по значению канала. */
export const HISTOGRAM_BINS = 256

/**
 * Гистограмма яркости (Rec. 601): по ней видно, упирается ли картинка в
 * чёрное или белое — то есть стоит ли тянуть уровни.
 */
export function computeHistogram(pixels: Uint8ClampedArray | number[]): number[] {
  const bins = new Array<number>(HISTOGRAM_BINS).fill(0)
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if (pixels[index + 3]! < 8) continue
    const luma = 0.299 * pixels[index]! + 0.587 * pixels[index + 1]! + 0.114 * pixels[index + 2]!
    bins[Math.max(0, Math.min(HISTOGRAM_BINS - 1, Math.round(luma)))]! += 1
  }
  return bins
}

/**
 * Гистограммы по каналам: по яркости не видно, какой канал упёрся в предел —
 * а именно так выглядит перекос цвета («ушло в синеву»), который на глаз
 * объясняется как «странный оттенок».
 */
export function computeChannelHistograms(pixels: Uint8ClampedArray | number[]): { r: number[]; g: number[]; b: number[] } {
  const make = (): number[] => new Array<number>(HISTOGRAM_BINS).fill(0)
  const out = { r: make(), g: make(), b: make() }
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if (pixels[index + 3]! < 8) continue
    out.r[pixels[index]!]! += 1
    out.g[pixels[index + 1]!]! += 1
    out.b[pixels[index + 2]!]! += 1
  }
  return out
}

/**
 * Границы для автоуровней: отбрасываем `clip` долю самых тёмных и самых
 * светлых пикселей, иначе один случайный блик растягивает всю картинку зря.
 * Возвращает `null`, если тянуть нечего (пусто или уже во всю шкалу).
 */
export function levelsRange(histogram: number[], clip = 0.005): { min: number; max: number } | null {
  const total = histogram.reduce((sum, value) => sum + value, 0)
  if (!total) return null
  const cut = Math.floor(total * clip)
  let low = 0
  let acc = 0
  while (low < histogram.length - 1 && acc + histogram[low]! <= cut) { acc += histogram[low]!; low += 1 }
  let high = histogram.length - 1
  acc = 0
  while (high > 0 && acc + histogram[high]! <= cut) { acc += histogram[high]!; high -= 1 }
  if (high - low < 8) return null
  if (low === 0 && high === histogram.length - 1) return null
  return { min: low, max: high }
}

/** Таблица подстановки, растягивающая [min, max] на всю шкалу 0..255. */
export function levelsLut(range: { min: number; max: number }): number[] {
  const span = Math.max(1, range.max - range.min)
  return Array.from({ length: 256 }, (_, value) => Math.max(0, Math.min(255, Math.round((value - range.min) / span * 255))))
}

/** Применяет таблицу к каналам RGB, не трогая альфу. Массив меняется на месте. */
export function applyLut(pixels: Uint8ClampedArray | number[], lut: number[]): void {
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    pixels[index] = lut[pixels[index]!]!
    pixels[index + 1] = lut[pixels[index + 1]!]!
    pixels[index + 2] = lut[pixels[index + 2]!]!
  }
}

/**
 * Нерезкое маскирование: результат = исходник + amount × (исходник − размытие).
 * Классический способ поднять резкость; при amount = 0 картинка не меняется.
 */
export function unsharpPixels(base: Uint8ClampedArray | number[], blurred: Uint8ClampedArray | number[], amount = 0.8): void {
  for (let index = 0; index + 3 < base.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const original = base[index + channel]!
      const soft = blurred[index + channel] ?? original
      base[index + channel] = Math.max(0, Math.min(255, Math.round(original + amount * (original - soft))))
    }
  }
}

/**
 * Столбики гистограммы в проценты высоты. Логарифм — потому что один
 * доминирующий тон (белый фон) иначе прижимает всё остальное к нулю.
 */
export function histogramBars(histogram: number[], bars = 64): number[] {
  const step = Math.ceil(histogram.length / bars)
  const grouped: number[] = []
  for (let index = 0; index < histogram.length; index += step) {
    grouped.push(histogram.slice(index, index + step).reduce((sum, value) => sum + value, 0))
  }
  const peak = Math.max(...grouped.map((value) => Math.log1p(value)), 1)
  return grouped.map((value) => Math.round(Math.log1p(value) / peak * 100))
}

/**
 * Гистограмма по байтам картинки: считаем по уменьшенной копии (не больше
 * 256 px по длинной стороне) — форма от этого не меняется, а полный проход по
 * пикселям большой картинки заметно тормозит вкладку.
 */
export async function channelHistogramsOf(source: Blob, bars = 64): Promise<{ r: number[]; g: number[]; b: number[] }> {
  const bitmap = await createImageBitmap(source)
  try {
    const scale = Math.min(1, 256 / Math.max(1, bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas недоступен в этом браузере')
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const channels = computeChannelHistograms(ctx.getImageData(0, 0, canvas.width, canvas.height).data)
    return { r: histogramBars(channels.r, bars), g: histogramBars(channels.g, bars), b: histogramBars(channels.b, bars) }
  } finally {
    bitmap.close?.()
  }
}

export async function histogramOf(source: Blob, bars?: number): Promise<number[]> {
  const bitmap = await createImageBitmap(source)
  try {
    const scale = Math.min(1, 256 / Math.max(1, bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas недоступен в этом браузере')
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const histogram = computeHistogram(ctx.getImageData(0, 0, canvas.width, canvas.height).data)
    return bars === undefined ? histogramBars(histogram) : histogramBars(histogram, bars)
  } finally {
    bitmap.close?.()
  }
}

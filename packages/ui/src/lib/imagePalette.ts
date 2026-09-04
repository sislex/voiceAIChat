// Палитра картинки: несколько доминирующих цветов, чтобы взять из результата
// цвет для макета, кнопки или фона. Ядро — чистая функция над пикселями:
// canvas нужен только для того, чтобы эти пиксели добыть.

/** Сколько цветов показываем: больше пяти в глазах уже не держится. */
export const PALETTE_SIZE = 5

/** «#1a2b3c» из компонент; каналы приходят из canvas как 0..255. */
export function toHex(red: number, green: number, blue: number): string {
  const part = (value: number): string => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
  return `#${part(red)}${part(green)}${part(blue)}`
}

/**
 * Доминирующие цвета по сетке 16×16×16: точный подсчёт всех оттенков дал бы
 * сотни почти одинаковых цветов, а квантование по четырём старшим битам
 * канала группирует их в различимые глазом ведра.
 *
 * Полностью прозрачные пиксели игнорируются: у логотипа на прозрачном фоне
 * иначе «доминирует» пустота.
 */
export function dominantColors(pixels: Uint8ClampedArray | number[], count = PALETTE_SIZE): string[] {
  const buckets = new Map<number, { count: number; red: number; green: number; blue: number }>()
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const alpha = pixels[index + 3]!
    if (alpha < 8) continue
    const red = pixels[index]!
    const green = pixels[index + 1]!
    const blue = pixels[index + 2]!
    const key = ((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.count += 1
      bucket.red += red
      bucket.green += green
      bucket.blue += blue
    } else {
      buckets.set(key, { count: 1, red, green, blue })
    }
  }
  return [...buckets.values()]
    // Частота решает, а при равной частоте порядок задаёт цвет: иначе
    // палитра прыгала бы между запусками на однотонных картинках.
    .sort((left, right) => right.count - left.count || toHex(left.red / left.count, left.green / left.count, left.blue / left.count).localeCompare(toHex(right.red / right.count, right.green / right.count, right.blue / right.count)))
    .slice(0, Math.max(1, count))
    // Внутри ведра берём средний цвет — он ближе к тому, что видно.
    .map((bucket) => toHex(bucket.red / bucket.count, bucket.green / bucket.count, bucket.blue / bucket.count))
}

/**
 * Палитра по байтам картинки. Считаем по уменьшенной копии (не больше 64 px
 * по длинной стороне): цвета от этого не меняются, а работы становится в сотни раз
 * меньше.
 */
export async function extractPalette(source: Blob, count = PALETTE_SIZE): Promise<string[]> {
  const bitmap = await createImageBitmap(source)
  try {
    const scale = Math.min(1, 64 / Math.max(1, bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas недоступен в этом браузере')
    ctx.drawImage(bitmap, 0, 0, width, height)
    return dominantColors(ctx.getImageData(0, 0, width, height).data, count)
  } finally {
    bitmap.close?.()
  }
}

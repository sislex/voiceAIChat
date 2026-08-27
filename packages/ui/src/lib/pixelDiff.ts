// Визуальная регрессия стори (roadmap-4 п.24): попиксельное сравнение двух снимков в браузере без зависимостей.
// Чистая функция над RGBA-буферами — тестируется без canvas; загрузку картинок делает вызывающий.

export interface PixelDiffResult {
  /** Доля отличающихся пикселей, 0..1 (по большему из размеров). */
  mismatch: number
  /** Сколько пикселей отличается. */
  differing: number
  width: number
  height: number
  /** RGBA-буфер карты различий: серый полупрозрачный фон, красные отличающиеся пиксели. */
  diff: Uint8ClampedArray
}

/** Сравнение по каналам с порогом (0..255 на канал); размеры разные — недостающие пиксели считаются отличием. */
export function pixelDiff(a: { width: number; height: number; data: Uint8ClampedArray }, b: { width: number; height: number; data: Uint8ClampedArray }, threshold = 24): PixelDiffResult {
  const width = Math.max(a.width, b.width), height = Math.max(a.height, b.height)
  const diff = new Uint8ClampedArray(width * height * 4)
  let differing = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      const inA = x < a.width && y < a.height, inB = x < b.width && y < b.height
      let same = inA && inB
      if (same) {
        const ia = (y * a.width + x) * 4, ib = (y * b.width + x) * 4
        for (let c = 0; c < 4; c++) if (Math.abs(a.data[ia + c]! - b.data[ib + c]!) > threshold) { same = false; break }
      }
      if (same) {
        const ia = (y * a.width + x) * 4
        const lum = Math.round((a.data[ia]! + a.data[ia + 1]! + a.data[ia + 2]!) / 3)
        diff[o] = lum; diff[o + 1] = lum; diff[o + 2] = lum; diff[o + 3] = 64
      } else {
        differing += 1
        diff[o] = 255; diff[o + 1] = 40; diff[o + 2] = 40; diff[o + 3] = 255
      }
    }
  }
  return { mismatch: width * height ? differing / (width * height) : 0, differing, width, height, diff }
}

/** Загрузка картинки в RGBA (same-origin) — для карты различий в панели снимков. */
export async function loadImageData(src: string): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const img = new Image()
  img.decoding = 'async'
  await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error(`Не удалось загрузить ${src}`)); img.src = src })
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D недоступен')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { width: d.width, height: d.height, data: d.data }
}

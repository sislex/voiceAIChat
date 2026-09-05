// Клиентские трансформации картинок студии: поворот, отражение, уменьшение,
// дополнение до квадрата. Всё на canvas — без модели и без сервера; результат
// сохраняется новым файлом рядом с исходником.

import { applyLut, computeHistogram, levelsLut, levelsRange, unsharpPixels } from './imageTone'

export type ImageTransformKind = 'rotate90' | 'rotate180' | 'rotate270' | 'flipH' | 'downscale512' | 'upscale2x' | 'padSquare' | 'toJpeg' | 'toWebp' | 'brighten' | 'contrast' | 'grayscale' | 'trim' | 'fitSquare' | 'fitOg' | 'fitWide' | 'autoLevels' | 'sharpen' | 'blur' | 'invert' | 'toWeb200'

/** Целевые размеры подгонки: квадрат поста, OG-превью и обложка 16:9. */
export const FIT_PRESETS: Record<'fitSquare' | 'fitOg' | 'fitWide', { width: number; height: number }> = {
  fitSquare: { width: 1080, height: 1080 },
  fitOg: { width: 1200, height: 630 },
  fitWide: { width: 1280, height: 720 }
}

export const IMAGE_TRANSFORMS: Array<{ kind: ImageTransformKind; label: string; suffix: string; ext?: 'jpg' | 'webp' }> = [
  { kind: 'rotate90', label: 'Повернуть на 90°', suffix: 'повёрнуто' },
  { kind: 'rotate270', label: 'Повернуть на −90°', suffix: 'повёрнуто-влево' },
  { kind: 'rotate180', label: 'Повернуть на 180°', suffix: 'вверх-ногами' },
  { kind: 'flipH', label: 'Отразить по горизонтали', suffix: 'зеркало' },
  { kind: 'downscale512', label: 'Уменьшить до 512', suffix: '512' },
  { kind: 'upscale2x', label: 'Увеличить ×2', suffix: 'x2' },
  { kind: 'padSquare', label: 'Дополнить до квадрата', suffix: 'квадрат' },
  { kind: 'toJpeg', label: 'В JPEG (меньше вес)', suffix: 'jpeg', ext: 'jpg' },
  { kind: 'toWebp', label: 'В WebP (ещё меньше)', suffix: 'webp', ext: 'webp' },
  { kind: 'brighten', label: 'Ярче', suffix: 'ярче' },
  { kind: 'contrast', label: 'Контраст+', suffix: 'контраст' },
  { kind: 'grayscale', label: 'Чёрно-белое', suffix: 'чб' },
  { kind: 'trim', label: 'Обрезать поля', suffix: 'без-полей' },
  { kind: 'fitSquare', label: 'Подогнать 1080×1080', suffix: '1080' },
  { kind: 'fitOg', label: 'Подогнать 1200×630 (OG)', suffix: 'og' },
  { kind: 'fitWide', label: 'Подогнать 1280×720', suffix: '720p' },
  { kind: 'autoLevels', label: 'Автоуровни', suffix: 'уровни' },
  { kind: 'sharpen', label: 'Резче', suffix: 'резче' },
  { kind: 'blur', label: 'Размыть', suffix: 'размыто' },
  { kind: 'invert', label: 'Инвертировать', suffix: 'негатив' },
  { kind: 'toWeb200', label: 'Сжать до ~200 КБ (JPEG)', suffix: 'web', ext: 'jpg' }
]

/** Целевой вес «веб-версии»: 200 КБ — обычный бюджет картинки в статье. */
export const WEB_TARGET_BYTES = 200 * 1024

/**
 * Подбор качества JPEG под целевой вес: качество делим пополам по шагам,
 * пока не влезем. Один фиксированный уровень не годится — фотография и
 * плоская иллюстрация при одном качестве весят в разы по-разному.
 */
export function nextQuality(current: number, tooBig: boolean, step: number): number {
  const shift = tooBig ? -step : step
  return Math.min(0.95, Math.max(0.35, Math.round((current + shift) * 100) / 100))
}

/**
 * Прямоугольник непрозрачного содержимого: у логотипов и иконок вокруг
 * картинки остаются пустые поля, из-за которых она «висит» в макете мелкой.
 * `null` — картинка пуста целиком (обрезать нечего).
 */
export function trimBox(pixels: Uint8ClampedArray | number[], width: number, height: number, threshold = 8): CropRect | null {
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3]! < threshold) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  if (right < 0 || bottom < 0) return null
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 }
}

/**
 * Область исходника для подгонки под целевой размер «по обрезке» (cover):
 * картинка заполняет кадр целиком, лишнее срезается симметрично. Вписывание с
 * полями для OG-превью не годится — поля выглядят как ошибка вёрстки.
 */
export function coverRect(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number): CropRect {
  const scale = Math.max(targetWidth / Math.max(1, sourceWidth), targetHeight / Math.max(1, sourceHeight))
  const w = Math.min(sourceWidth, Math.round(targetWidth / scale))
  const h = Math.min(sourceHeight, Math.round(targetHeight / scale))
  return { x: Math.round((sourceWidth - w) / 2), y: Math.round((sourceHeight - h) / 2), w, h }
}

/** Имя результата: «кот.png» + «повёрнуто» → «кот-повёрнуто.png»; занято — с номером. */
export function transformName(path: string, suffix: string, taken: Set<string>, ext: 'png' | 'jpg' | 'webp' = 'png'): string {
  const dot = path.lastIndexOf('.')
  const stem = dot > 0 ? path.slice(0, dot) : path
  // По умолчанию PNG: canvas отдаёт PNG без потерь, а исходное расширение
  // (jpg/webp) стало бы враньём о содержимом. JPEG-конверсия задаёт ext явно.
  let candidate = `${stem}-${suffix}.${ext}`
  for (let index = 2; taken.has(candidate); index += 1) candidate = `${stem}-${suffix}-${index}.${ext}`
  return candidate
}

/** Применяет трансформацию к байтам картинки; отдаёт PNG-blob. */
export async function applyImageTransform(source: Blob, kind: ImageTransformKind): Promise<Blob> {
  // Обрезка полей и подгонка под размер — это вырезание области с масштабом,
  // а не рисование поверх кадра: у них своя ветка.
  if (kind === 'trim') return trimImage(source)
  if (kind === 'fitSquare' || kind === 'fitOg' || kind === 'fitWide') return fitImage(source, FIT_PRESETS[kind])
  if (kind === 'autoLevels') return autoLevelsImage(source)
  if (kind === 'toWeb200') return compressToBytes(source, WEB_TARGET_BYTES)
  if (kind === 'sharpen') return sharpenImage(source)
  const bitmap = await createImageBitmap(source)
  try {
    // Поворот на четверть меняет стороны местами; на пол-оборота — нет.
    const rotate = kind === 'rotate90' || kind === 'rotate270'
    const scale = kind === 'downscale512' ? Math.min(1, 512 / Math.max(bitmap.width, bitmap.height)) : kind === 'upscale2x' ? 2 : 1
    const side = Math.max(bitmap.width, bitmap.height)
    const width = kind === 'padSquare' ? side : Math.max(1, Math.round((rotate ? bitmap.height : bitmap.width) * scale))
    const height = kind === 'padSquare' ? side : Math.max(1, Math.round((rotate ? bitmap.width : bitmap.height) * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas недоступен в этом браузере')
    ctx.imageSmoothingQuality = 'high'
    // Коррекции — через ctx.filter (поддержан во всех целевых браузерах).
    if (kind === 'brighten') ctx.filter = 'brightness(1.15)'
    if (kind === 'contrast') ctx.filter = 'contrast(1.2)'
    if (kind === 'grayscale') ctx.filter = 'grayscale(1)'
    if (kind === 'blur') ctx.filter = 'blur(2px)'
    if (kind === 'invert') ctx.filter = 'invert(1)'
    switch (kind) {
      case 'rotate90':
        ctx.translate(width, 0)
        ctx.rotate(Math.PI / 2)
        ctx.drawImage(bitmap, 0, 0)
        break
      case 'rotate270':
        ctx.translate(0, height)
        ctx.rotate(-Math.PI / 2)
        ctx.drawImage(bitmap, 0, 0)
        break
      case 'rotate180':
        ctx.translate(width, height)
        ctx.rotate(Math.PI)
        ctx.drawImage(bitmap, 0, 0)
        break
      case 'flipH':
        ctx.translate(width, 0)
        ctx.scale(-1, 1)
        ctx.drawImage(bitmap, 0, 0)
        break
      case 'downscale512':
      case 'upscale2x':
      case 'brighten':
      case 'contrast':
      case 'grayscale':
      case 'blur':
      case 'invert':
        ctx.drawImage(bitmap, 0, 0, width, height)
        break
      case 'toJpeg':
        // У JPEG нет прозрачности — сначала белая подложка.
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, width, height)
        ctx.drawImage(bitmap, 0, 0)
        break
      case 'toWebp':
        // WebP прозрачность умеет — подложка не нужна.
        ctx.drawImage(bitmap, 0, 0)
        break
      case 'padSquare':
        // Прозрачные поля вокруг картинки, сама она — по центру.
        ctx.drawImage(bitmap, Math.round((side - bitmap.width) / 2), Math.round((side - bitmap.height) / 2))
        break
    }
    const blob = await new Promise<Blob | null>((resolve) =>
      kind === 'toJpeg' ? canvas.toBlob(resolve, 'image/jpeg', 0.85)
      : kind === 'toWebp' ? canvas.toBlob(resolve, 'image/webp', 0.9)
      : canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Не удалось сохранить результат обработки')
    // Safari до 16-й версии молча отдаёт PNG вместо WebP: расширение обещало
    // бы формат, которого в байтах нет.
    if (kind === 'toWebp' && blob.type !== 'image/webp') throw new Error('Браузер не умеет сохранять WebP')
    return blob
  } finally {
    bitmap.close?.()
  }
}

export interface CropRect { x: number; y: number; w: number; h: number }

/** Прижимает выделение к границам картинки; слишком мелкое (<8px) — null. */
export function clampCrop(rect: CropRect, width: number, height: number): CropRect | null {
  const x = Math.max(0, Math.min(Math.round(rect.x), width - 1))
  const y = Math.max(0, Math.min(Math.round(rect.y), height - 1))
  const w = Math.min(Math.round(rect.w), width - x)
  const h = Math.min(Math.round(rect.h), height - y)
  if (w < 8 || h < 8) return null
  return { x, y, w, h }
}

/**
 * Автоуровни: растягиваем тона по гистограмме. Если тянуть нечего (картинка
 * уже во всю шкалу или однотонная), честно отказываемся, а не отдаём копию —
 * иначе в галерее плодятся файлы без изменений.
 */
export async function autoLevelsImage(source: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(source)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas недоступен в этом браузере')
    ctx.drawImage(bitmap, 0, 0)
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const range = levelsRange(computeHistogram(image.data))
    if (!range) throw new Error('Тона уже растянуты — автоуровням нечего делать')
    applyLut(image.data, levelsLut(range))
    ctx.putImageData(image, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Не удалось сохранить результат автоуровней')
    return blob
  } finally {
    bitmap.close?.()
  }
}

/** Резкость нерезким маскированием: исходник плюс разница с размытием. */
export async function sharpenImage(source: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(source)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas недоступен в этом браузере')
    ctx.drawImage(bitmap, 0, 0)
    const base = ctx.getImageData(0, 0, canvas.width, canvas.height)
    // Размытую копию рисуем тем же канвасом: отдельный canvas ради одного
    // прохода — лишняя память на больших картинках.
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.filter = 'blur(1px)'
    ctx.drawImage(bitmap, 0, 0)
    ctx.filter = 'none'
    const blurred = ctx.getImageData(0, 0, canvas.width, canvas.height)
    unsharpPixels(base.data, blurred.data, 0.8)
    ctx.putImageData(base, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Не удалось сохранить результат резкости')
    return blob
  } finally {
    bitmap.close?.()
  }
}

/** Срезает прозрачные поля вокруг содержимого; отдаёт PNG-blob. */
export async function trimImage(source: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(source)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas недоступен в этом браузере')
    ctx.drawImage(bitmap, 0, 0)
    const box = trimBox(ctx.getImageData(0, 0, bitmap.width, bitmap.height).data, bitmap.width, bitmap.height)
    if (!box) throw new Error('Картинка полностью прозрачная — обрезать нечего')
    if (box.w === bitmap.width && box.h === bitmap.height) throw new Error('Прозрачных полей нет — обрезать нечего')
    const out = document.createElement('canvas')
    out.width = box.w
    out.height = box.h
    const outCtx = out.getContext('2d')
    if (!outCtx) throw new Error('Canvas недоступен в этом браузере')
    outCtx.drawImage(bitmap, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h)
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Не удалось сохранить обрезку')
    return blob
  } finally {
    bitmap.close?.()
  }
}

/** Подгоняет картинку под точный размер «по обрезке»; отдаёт PNG-blob. */
export async function fitImage(source: Blob, target: { width: number; height: number }): Promise<Blob> {
  const bitmap = await createImageBitmap(source)
  try {
    const area = coverRect(bitmap.width, bitmap.height, target.width, target.height)
    const canvas = document.createElement('canvas')
    canvas.width = target.width
    canvas.height = target.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas недоступен в этом браузере')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, area.x, area.y, area.w, area.h, 0, 0, target.width, target.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Не удалось сохранить результат подгонки')
    return blob
  } finally {
    bitmap.close?.()
  }
}

/**
 * Подпись в углу картинки: белый текст с тёмной обводкой читается и на светлом,
 * и на тёмном фоне, поэтому подложку не рисуем.
 */
export async function captionImage(source: Blob, text: string): Promise<Blob> {
  const caption = text.trim()
  if (!caption) throw new Error('Подпись пустая')
  const bitmap = await createImageBitmap(source)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas недоступен в этом браузере')
    ctx.drawImage(bitmap, 0, 0)
    // Размер кегля — от высоты кадра: на 1200 px подпись в 16 px не видно.
    const size = Math.max(14, Math.round(bitmap.height * 0.05))
    ctx.font = `bold ${size}px system-ui, sans-serif`
    ctx.textBaseline = 'bottom'
    ctx.lineJoin = 'round'
    ctx.lineWidth = Math.max(2, Math.round(size / 6))
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)'
    ctx.fillStyle = '#ffffff'
    const margin = Math.round(size * 0.6)
    ctx.strokeText(caption, margin, bitmap.height - margin)
    ctx.fillText(caption, margin, bitmap.height - margin)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Не удалось сохранить подпись')
    return blob
  } finally {
    bitmap.close?.()
  }
}

/** Вырезает прямоугольник (в натуральных пикселях картинки); отдаёт PNG-blob. */
export async function cropImage(source: Blob, rect: CropRect): Promise<Blob> {
  const bitmap = await createImageBitmap(source)
  try {
    const safe = clampCrop(rect, bitmap.width, bitmap.height)
    if (!safe) throw new Error('Выделение слишком маленькое')
    const canvas = document.createElement('canvas')
    canvas.width = safe.w
    canvas.height = safe.h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas недоступен в этом браузере')
    ctx.drawImage(bitmap, safe.x, safe.y, safe.w, safe.h, 0, 0, safe.w, safe.h)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Не удалось сохранить кроп')
    return blob
  } finally {
    bitmap.close?.()
  }
}

/**
 * Сжать в JPEG под целевой вес: подбираем качество, каждый раз уменьшая шаг
 * (двоичный поиск по качеству). Пять попыток — компромисс: каждая попытка это
 * полная перекодировка, а разница между 0.62 и 0.60 глазами не видна.
 */
export async function compressToBytes(source: Blob, target: number): Promise<Blob> {
  const bitmap = await createImageBitmap(source)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas недоступен в этом браузере')
    // JPEG не умеет прозрачность: без белой подложки прозрачные края чернеют.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0)
    let quality = 0.8
    let step = 0.2
    let best: Blob | null = null
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
      if (!blob) break
      // Держим лучший из влезающих; если не влез ни один — последний (самый мелкий).
      if (blob.size <= target && (!best || blob.size > best.size)) best = blob
      else if (!best) best = blob
      if (Math.abs(blob.size - target) < target * 0.05) break
      quality = nextQuality(quality, blob.size > target, step)
      step = Math.max(0.02, step / 2)
    }
    if (!best) throw new Error('Не удалось пересжать картинку')
    return best
  } finally {
    bitmap.close?.()
  }
}

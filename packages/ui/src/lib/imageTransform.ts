// Клиентские трансформации картинок студии: поворот, отражение, уменьшение,
// дополнение до квадрата. Всё на canvas — без модели и без сервера; результат
// сохраняется новым файлом рядом с исходником.

export type ImageTransformKind = 'rotate90' | 'flipH' | 'downscale512' | 'upscale2x' | 'padSquare' | 'toJpeg' | 'brighten' | 'contrast' | 'grayscale'

export const IMAGE_TRANSFORMS: Array<{ kind: ImageTransformKind; label: string; suffix: string; ext?: 'jpg' }> = [
  { kind: 'rotate90', label: 'Повернуть на 90°', suffix: 'повёрнуто' },
  { kind: 'flipH', label: 'Отразить по горизонтали', suffix: 'зеркало' },
  { kind: 'downscale512', label: 'Уменьшить до 512', suffix: '512' },
  { kind: 'upscale2x', label: 'Увеличить ×2', suffix: 'x2' },
  { kind: 'padSquare', label: 'Дополнить до квадрата', suffix: 'квадрат' },
  { kind: 'toJpeg', label: 'В JPEG (меньше вес)', suffix: 'jpeg', ext: 'jpg' },
  { kind: 'brighten', label: 'Ярче', suffix: 'ярче' },
  { kind: 'contrast', label: 'Контраст+', suffix: 'контраст' },
  { kind: 'grayscale', label: 'Чёрно-белое', suffix: 'чб' }
]

/** Имя результата: «кот.png» + «повёрнуто» → «кот-повёрнуто.png»; занято — с номером. */
export function transformName(path: string, suffix: string, taken: Set<string>, ext: 'png' | 'jpg' = 'png'): string {
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
  const bitmap = await createImageBitmap(source)
  try {
    const rotate = kind === 'rotate90'
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
    switch (kind) {
      case 'rotate90':
        ctx.translate(width, 0)
        ctx.rotate(Math.PI / 2)
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
        ctx.drawImage(bitmap, 0, 0, width, height)
        break
      case 'toJpeg':
        // У JPEG нет прозрачности — сначала белая подложка.
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, width, height)
        ctx.drawImage(bitmap, 0, 0)
        break
      case 'padSquare':
        // Прозрачные поля вокруг картинки, сама она — по центру.
        ctx.drawImage(bitmap, Math.round((side - bitmap.width) / 2), Math.round((side - bitmap.height) / 2))
        break
    }
    const blob = await new Promise<Blob | null>((resolve) => kind === 'toJpeg' ? canvas.toBlob(resolve, 'image/jpeg', 0.85) : canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Не удалось сохранить результат обработки')
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

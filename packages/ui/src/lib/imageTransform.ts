// Клиентские трансформации картинок студии: поворот, отражение, уменьшение,
// дополнение до квадрата. Всё на canvas — без модели и без сервера; результат
// сохраняется новым файлом рядом с исходником.

export type ImageTransformKind = 'rotate90' | 'flipH' | 'downscale512' | 'padSquare'

export const IMAGE_TRANSFORMS: Array<{ kind: ImageTransformKind; label: string; suffix: string }> = [
  { kind: 'rotate90', label: 'Повернуть на 90°', suffix: 'повёрнуто' },
  { kind: 'flipH', label: 'Отразить по горизонтали', suffix: 'зеркало' },
  { kind: 'downscale512', label: 'Уменьшить до 512', suffix: '512' },
  { kind: 'padSquare', label: 'Дополнить до квадрата', suffix: 'квадрат' }
]

/** Имя результата: «кот.png» + «повёрнуто» → «кот-повёрнуто.png»; занято — с номером. */
export function transformName(path: string, suffix: string, taken: Set<string>): string {
  const dot = path.lastIndexOf('.')
  const stem = dot > 0 ? path.slice(0, dot) : path
  // Результат трансформаций всегда PNG: canvas отдаёт PNG без потерь,
  // а исходное расширение (jpg/webp) стало бы враньём о содержимом.
  let candidate = `${stem}-${suffix}.png`
  for (let index = 2; taken.has(candidate); index += 1) candidate = `${stem}-${suffix}-${index}.png`
  return candidate
}

/** Применяет трансформацию к байтам картинки; отдаёт PNG-blob. */
export async function applyImageTransform(source: Blob, kind: ImageTransformKind): Promise<Blob> {
  const bitmap = await createImageBitmap(source)
  try {
    const rotate = kind === 'rotate90'
    const scale = kind === 'downscale512' ? Math.min(1, 512 / Math.max(bitmap.width, bitmap.height)) : 1
    const side = Math.max(bitmap.width, bitmap.height)
    const width = kind === 'padSquare' ? side : Math.max(1, Math.round((rotate ? bitmap.height : bitmap.width) * scale))
    const height = kind === 'padSquare' ? side : Math.max(1, Math.round((rotate ? bitmap.width : bitmap.height) * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas недоступен в этом браузере')
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
        ctx.drawImage(bitmap, 0, 0, width, height)
        break
      case 'padSquare':
        // Прозрачные поля вокруг картинки, сама она — по центру.
        ctx.drawImage(bitmap, Math.round((side - bitmap.width) / 2), Math.round((side - bitmap.height) / 2))
        break
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Не удалось сохранить результат обработки')
    return blob
  } finally {
    bitmap.close?.()
  }
}

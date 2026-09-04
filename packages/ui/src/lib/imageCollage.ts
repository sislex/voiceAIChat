// Коллаж («контактный лист») из нескольких картинок галереи: сетка квадратных
// ячеек в одном PNG. Нужен, чтобы показать серию одним файлом — в мессенджере,
// в задаче или в презентации, где восемнадцать вложений никто не откроет.
// Раскладка вынесена в чистую функцию: canvas в тестах не нужен.

export interface CollageOptions {
  /** Сторона ячейки в пикселях. */
  tile?: number
  /** Поле между ячейками и по краям листа. */
  gap?: number
  /** Число колонок; по умолчанию — квадратная сетка. */
  columns?: number
  /** Цвет листа; прозрачный фон в мессенджерах читается плохо. */
  background?: string
}

export interface CollageLayout {
  columns: number
  rows: number
  width: number
  height: number
  cells: Array<{ x: number; y: number }>
}

/**
 * Раскладка сетки: колонок — корень из количества (сетка стремится к квадрату,
 * иначе восемь картинок дают полосу 8×1 и лист шириной в километр).
 */
export function collageLayout(count: number, tile: number, gap: number, columns?: number): CollageLayout {
  const safeCount = Math.max(1, Math.floor(count))
  const cols = Math.max(1, Math.min(safeCount, Math.floor(columns ?? Math.ceil(Math.sqrt(safeCount)))))
  const rows = Math.ceil(safeCount / cols)
  const cells = Array.from({ length: safeCount }, (_, index) => ({
    x: gap + (index % cols) * (tile + gap),
    y: gap + Math.floor(index / cols) * (tile + gap)
  }))
  return { columns: cols, rows, width: gap + cols * (tile + gap), height: gap + rows * (tile + gap), cells }
}

/**
 * Вписывает картинку в квадрат ячейки без искажения пропорций (contain) —
 * `cover` обрезал бы как раз то, ради чего картинку и показывают.
 */
export function fitInside(width: number, height: number, tile: number): { width: number; height: number; dx: number; dy: number } {
  const scale = Math.min(tile / Math.max(1, width), tile / Math.max(1, height))
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  return { width: w, height: h, dx: Math.round((tile - w) / 2), dy: Math.round((tile - h) / 2) }
}

/** Собирает коллаж из байтов картинок; отдаёт PNG-blob. */
export async function buildCollage(sources: Blob[], options: CollageOptions = {}): Promise<Blob> {
  if (!sources.length) throw new Error('Нечего собирать: не выбрано ни одной картинки')
  const tile = options.tile ?? 256
  const gap = options.gap ?? 12
  const layout = collageLayout(sources.length, tile, gap, options.columns)
  const canvas = document.createElement('canvas')
  canvas.width = layout.width
  canvas.height = layout.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas недоступен в этом браузере')
  ctx.fillStyle = options.background ?? '#ffffff'
  ctx.fillRect(0, 0, layout.width, layout.height)
  ctx.imageSmoothingQuality = 'high'
  for (const [index, source] of sources.entries()) {
    const cell = layout.cells[index]
    if (!cell) continue
    const bitmap = await createImageBitmap(source)
    try {
      const fit = fitInside(bitmap.width, bitmap.height, tile)
      ctx.drawImage(bitmap, cell.x + fit.dx, cell.y + fit.dy, fit.width, fit.height)
    } finally {
      bitmap.close?.()
    }
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Не удалось собрать коллаж')
  return blob
}

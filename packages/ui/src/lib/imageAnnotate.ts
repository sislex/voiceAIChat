// Разметка поверх картинки: freehand-штрихи из лайтбокса студии вжигаются в
// копию файла. Координаты штрихов приходят в CSS-пикселях отображаемой
// картинки и масштабируются к натуральным при сохранении.

export interface AnnotateStroke {
  color: string
  /** Толщина в CSS-пикселях (масштабируется вместе с точками). */
  width: number
  points: Array<{ x: number; y: number }>
}

/** Вжигает штрихи в картинку; displaySize — размер, в котором их рисовали. */
export async function annotateImage(source: Blob, strokes: AnnotateStroke[], displaySize: { width: number; height: number }): Promise<Blob> {
  const bitmap = await createImageBitmap(source)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas недоступен в этом браузере')
    ctx.drawImage(bitmap, 0, 0)
    const scaleX = bitmap.width / displaySize.width
    const scaleY = bitmap.height / displaySize.height
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const stroke of strokes) {
      if (stroke.points.length < 2) continue
      ctx.strokeStyle = stroke.color
      ctx.lineWidth = stroke.width * (scaleX + scaleY) / 2
      ctx.beginPath()
      ctx.moveTo(stroke.points[0]!.x * scaleX, stroke.points[0]!.y * scaleY)
      for (const point of stroke.points.slice(1)) ctx.lineTo(point.x * scaleX, point.y * scaleY)
      ctx.stroke()
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Не удалось сохранить разметку')
    return blob
  } finally {
    bitmap.close?.()
  }
}

export const ANNOTATE_COLORS = ['#e53935', '#fdd835', '#43a047', '#1e88e5'] as const

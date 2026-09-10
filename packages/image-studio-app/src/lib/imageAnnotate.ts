// Разметка поверх картинки: фигуры из лайтбокса студии вжигаются в копию
// файла. Координаты приходят в CSS-пикселях отображаемой картинки и
// масштабируются к натуральным при сохранении.

export interface AnnotatePoint { x: number; y: number }

export type AnnotateShape =
  | { kind: 'pen'; color: string; width: number; points: AnnotatePoint[] }
  | { kind: 'arrow'; color: string; width: number; from: AnnotatePoint; to: AnnotatePoint }
  | { kind: 'rect'; color: string; width: number; from: AnnotatePoint; to: AnnotatePoint }
  | { kind: 'text'; color: string; x: number; y: number; text: string; size: number }

export const ANNOTATE_COLORS = ['#e53935', '#fdd835', '#43a047', '#1e88e5'] as const

export const ANNOTATE_TOOLS = [
  { tool: 'pen', label: 'Карандаш' },
  { tool: 'arrow', label: 'Стрелка' },
  { tool: 'rect', label: 'Рамка' },
  { tool: 'text', label: 'Текст' }
] as const

export type AnnotateTool = (typeof ANNOTATE_TOOLS)[number]['tool']

/** Точки наконечника стрелки: два «уса» от to назад под 30°. */
export function arrowHead(from: AnnotatePoint, to: AnnotatePoint, size: number): [AnnotatePoint, AnnotatePoint] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const spread = Math.PI / 6
  return [
    { x: to.x - size * Math.cos(angle - spread), y: to.y - size * Math.sin(angle - spread) },
    { x: to.x - size * Math.cos(angle + spread), y: to.y - size * Math.sin(angle + spread) }
  ]
}

/** Вжигает фигуры в картинку; displaySize — размер, в котором их рисовали. */
export async function annotateImage(source: Blob, shapes: AnnotateShape[], displaySize: { width: number; height: number }): Promise<Blob> {
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
    const lineScale = (scaleX + scaleY) / 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const sx = (p: AnnotatePoint): AnnotatePoint => ({ x: p.x * scaleX, y: p.y * scaleY })
    for (const shape of shapes) {
      ctx.strokeStyle = shape.color
      ctx.fillStyle = shape.color
      switch (shape.kind) {
        case 'pen': {
          if (shape.points.length < 2) break
          ctx.lineWidth = shape.width * lineScale
          ctx.beginPath()
          const [first, ...rest] = shape.points.map(sx)
          ctx.moveTo(first!.x, first!.y)
          for (const point of rest) ctx.lineTo(point.x, point.y)
          ctx.stroke()
          break
        }
        case 'arrow': {
          ctx.lineWidth = shape.width * lineScale
          const from = sx(shape.from)
          const to = sx(shape.to)
          const [left, right] = arrowHead(from, to, Math.max(10, shape.width * 4) * lineScale)
          ctx.beginPath()
          ctx.moveTo(from.x, from.y)
          ctx.lineTo(to.x, to.y)
          ctx.moveTo(left.x, left.y)
          ctx.lineTo(to.x, to.y)
          ctx.lineTo(right.x, right.y)
          ctx.stroke()
          break
        }
        case 'rect': {
          ctx.lineWidth = shape.width * lineScale
          const from = sx(shape.from)
          const to = sx(shape.to)
          ctx.strokeRect(Math.min(from.x, to.x), Math.min(from.y, to.y), Math.abs(to.x - from.x), Math.abs(to.y - from.y))
          break
        }
        case 'text': {
          const point = sx({ x: shape.x, y: shape.y })
          const size = shape.size * lineScale
          ctx.font = `bold ${size}px system-ui, sans-serif`
          // Белая обводка — текст читается на любом фоне.
          ctx.lineWidth = Math.max(2, size / 6)
          ctx.strokeStyle = '#fff'
          ctx.strokeText(shape.text, point.x, point.y)
          ctx.fillText(shape.text, point.x, point.y)
          break
        }
      }
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Не удалось сохранить разметку')
    return blob
  } finally {
    bitmap.close?.()
  }
}

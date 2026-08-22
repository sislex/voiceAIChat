// Контракт и чистая геометрия локальной AI-ретуши изображений.

import type { Message, MessageAttachment } from './types'

export interface ImagePoint { x: number; y: number }
export interface ImageSize { width: number; height: number }
export type ImageRetouchSelection =
  | { kind: 'rectangle'; x: number; y: number; width: number; height: number }
  | { kind: 'lasso'; points: ImagePoint[] }

export interface ImageRetouchRequest {
  conversationId: string
  source: MessageAttachment
  selection: ImageRetouchSelection
  prompt: string
  references?: MessageAttachment[]
}

export interface ImageRetouchRecord {
  source: MessageAttachment
  selection: ImageRetouchSelection
  prompt: string
  references?: MessageAttachment[]
}

export interface ImageRetouchResult {
  message: Message
  image: MessageAttachment
}

export interface ArtifactPublishRequest {
  conversationId: string
  source: MessageAttachment
  name?: string
  /** Явное разрешение заменить существующий artifact; по умолчанию имя уникализируется. */
  overwrite?: boolean
}

export interface ArtifactPublishResult {
  artifact: MessageAttachment
  message: Message
}

export interface ImageRect { x: number; y: number; width: number; height: number }

export function validateImageRetouchSelection(selection: ImageRetouchSelection, size: ImageSize): string | null {
  if (!Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width <= 0 || size.height <= 0) return 'Некорректный размер исходного изображения'
  if (selection.kind === 'rectangle') {
    const { x, y, width, height } = selection
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return 'Прямоугольное выделение пусто или некорректно'
    if (x < 0 || y < 0 || x + width > size.width || y + height > size.height) return 'Выделение выходит за границы изображения'
    return null
  }
  if (selection.points.length < 3) return 'Лассо должно содержать не менее трёх точек'
  if (selection.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0 || p.x > size.width || p.y > size.height)) return 'Контур лассо выходит за границы изображения'
  return null
}

export function imageRetouchBounds(selection: ImageRetouchSelection, size: ImageSize): ImageRect {
  const coords = selection.kind === 'rectangle'
    ? { minX: selection.x, minY: selection.y, maxX: selection.x + selection.width, maxY: selection.y + selection.height }
    : { minX: Math.min(...selection.points.map((p) => p.x)), minY: Math.min(...selection.points.map((p) => p.y)), maxX: Math.max(...selection.points.map((p) => p.x)), maxY: Math.max(...selection.points.map((p) => p.y)) }
  const x = Math.max(0, Math.floor(coords.minX))
  const y = Math.max(0, Math.floor(coords.minY))
  const right = Math.min(size.width, Math.ceil(coords.maxX))
  const bottom = Math.min(size.height, Math.ceil(coords.maxY))
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) }
}

export function scaleImagePoint(point: ImagePoint, rendered: ImageSize, original: ImageSize): ImagePoint {
  if (rendered.width <= 0 || rendered.height <= 0) return { x: 0, y: 0 }
  return { x: Math.max(0, Math.min(original.width, point.x * original.width / rendered.width)), y: Math.max(0, Math.min(original.height, point.y * original.height / rendered.height)) }
}

export function localizeImageRetouchSelection(selection: ImageRetouchSelection, bounds: ImageRect): ImageRetouchSelection {
  return selection.kind === 'rectangle'
    ? { kind: 'rectangle', x: selection.x - bounds.x, y: selection.y - bounds.y, width: selection.width, height: selection.height }
    : { kind: 'lasso', points: selection.points.map((p) => ({ x: p.x - bounds.x, y: p.y - bounds.y })) }
}

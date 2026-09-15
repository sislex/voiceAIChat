import type { BrowserSnapshotInfo } from '@voicechat/shared'

/**
 * Именованные снимки состояния и их сравнение.
 *
 * «Не сломалась ли вёрстка после правки» человек проверяет глазами: смотрит до,
 * смотрит после. У модели такого не было вовсе — она могла снять кадр, но
 * сравнить его было не с чем и нечем, а описать словами разницу в пять пикселей
 * невозможно. Отсюда и дефекты, которые находятся только через неделю.
 *
 * Снимки живут в памяти сессии: это рабочий материал одной проверки, а не
 * артефакт, который стоит хранить на диске рядом с чужими скриншотами.
 */

/** Сколько снимков держим: больше — это уже архив, а не проверка. */
const MAX_SNAPSHOTS = 10

interface StoredSnapshot {
  name: string
  at: number
  url: string
  title: string
  dataUrl: string
  text: string
  fullPage?: boolean
}

export class SessionSnapshots {
  private items = new Map<string, StoredSnapshot>()

  save(snapshot: StoredSnapshot): BrowserSnapshotInfo {
    if (!snapshot.name.trim()) throw new Error('Снимку нужно имя')
    if (this.items.size >= MAX_SNAPSHOTS && !this.items.has(snapshot.name)) {
      // Вытесняем самый старый: молча расти памяти сессии незачем, а человек
      // всё равно сравнивает с недавним состоянием.
      const oldest = [...this.items.values()].sort((a, b) => a.at - b.at)[0]
      if (oldest) this.items.delete(oldest.name)
    }
    this.items.set(snapshot.name, snapshot)
    return describe(snapshot)
  }

  get(name: string): StoredSnapshot | null {
    return this.items.get(name) ?? null
  }

  remove(name?: string): void {
    if (name) this.items.delete(name)
    else this.items.clear()
  }

  list(): BrowserSnapshotInfo[] {
    return [...this.items.values()].sort((a, b) => b.at - a.at).map(describe)
  }
}

function describe(snapshot: StoredSnapshot): BrowserSnapshotInfo {
  return {
    name: snapshot.name,
    at: snapshot.at,
    url: snapshot.url,
    title: snapshot.title,
    // Размер картинки в байтах: человеку он говорит, насколько снимок «тяжёлый»,
    // а модели — почему снимков держим десять, а не сто.
    bytes: Math.round((snapshot.dataUrl.length * 3) / 4),
    textLength: snapshot.text.length,
    ...(snapshot.fullPage ? { fullPage: true } : {})
  }
}

/**
 * Сравнение двух кадров прямо в странице: Chromium уже умеет рисовать картинку
 * и читать пиксели, и тащить ради этого разбор PNG в Node незачем.
 *
 * Возвращает долю различающихся пикселей и прямоугольник, в который они
 * уместились: «12% страницы и всё в шапке» — это диагноз, а «12%» — нет.
 */
export function compareImagesScript(before: string, after: string, threshold: number): string {
  return `(async () => {
    const load = src => new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('Снимок не читается'))
      image.src = src
    })
    const [first, second] = await Promise.all([load(${JSON.stringify(before)}), load(${JSON.stringify(after)})])
    const width = Math.min(first.naturalWidth, second.naturalWidth)
    const height = Math.min(first.naturalHeight, second.naturalHeight)
    if (!width || !height) return { error: 'Снимки пустые' }
    const draw = image => {
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(image, 0, 0)
      return context.getImageData(0, 0, width, height).data
    }
    const a = draw(first), b = draw(second)
    let changed = 0, minX = width, minY = height, maxX = 0, maxY = 0
    // Порог по каналу: сжатие JPEG шевелит соседние пиксели на пару единиц, и
    // без порога любые два кадра одной страницы «различаются».
    const limit = ${threshold}
    for (let index = 0; index < a.length; index += 4) {
      if (Math.abs(a[index] - b[index]) <= limit && Math.abs(a[index + 1] - b[index + 1]) <= limit && Math.abs(a[index + 2] - b[index + 2]) <= limit) continue
      changed++
      const pixel = index / 4, x = pixel % width, y = Math.floor(pixel / width)
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
    const total = width * height
    return {
      width, height, total, changed,
      ratio: Math.round((changed / total) * 10000) / 10000,
      ...(changed ? { area: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } } : {}),
      sizeChanged: first.naturalWidth !== second.naturalWidth || first.naturalHeight !== second.naturalHeight
    }
  })()`
}

/**
 * Вердикт словами. Доля пикселей не отвечает на вопрос человека: «различий нет»
 * при изменившемся тексте почти всегда значит, что изменение ниже сгиба, —
 * и именно это надо сказать, а не отдать ноль.
 */
export function snapshotVerdict(input: { ratio: number; sizeChanged: boolean; textChanged: boolean }): 'identical' | 'visual' | 'dom-only' | 'resized' {
  if (input.sizeChanged) return 'resized'
  if (input.ratio > 0) return 'visual'
  return input.textChanged ? 'dom-only' : 'identical'
}

/** Текстовая разница: что появилось и что исчезло, строками. */
export function diffText(before: string, after: string, limit = 20): { added: string[]; removed: string[]; addedTotal: number; removedTotal: number } {
  const lines = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean)
  const beforeLines = lines(before)
  const afterLines = lines(after)
  const beforeCount = new Map<string, number>()
  for (const line of beforeLines) beforeCount.set(line, (beforeCount.get(line) ?? 0) + 1)
  const afterCount = new Map<string, number>()
  for (const line of afterLines) afterCount.set(line, (afterCount.get(line) ?? 0) + 1)
  const added: string[] = []
  const removed: string[] = []
  // Считаем по числу вхождений, а не по множеству: строка «Итого: 0», ставшая
  // второй такой же, — это изменение, и терять его нельзя.
  for (const [line, count] of afterCount) {
    const missing = count - (beforeCount.get(line) ?? 0)
    for (let index = 0; index < missing; index++) added.push(line)
  }
  for (const [line, count] of beforeCount) {
    const missing = count - (afterCount.get(line) ?? 0)
    for (let index = 0; index < missing; index++) removed.push(line)
  }
  return {
    added: added.slice(0, limit).map((line) => line.slice(0, 200)),
    removed: removed.slice(0, limit).map((line) => line.slice(0, 200)),
    addedTotal: added.length,
    removedTotal: removed.length
  }
}

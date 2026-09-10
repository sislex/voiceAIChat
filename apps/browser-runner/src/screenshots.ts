import type { Page } from 'playwright'
import type { BrowserScreenshotMetadata, BrowserScreenshotOptions, BrowserScreenshotRect } from '@voicechat/shared'

export interface BrowserCapture {
  buffer: Buffer
  mimeType: string
  metadata: BrowserScreenshotMetadata
}

const metricsScript = `(() => {
  const body = document.body, root = document.documentElement;
  return {
    x: scrollX, y: scrollY, width: innerWidth, height: innerHeight,
    documentWidth: Math.max(body?.scrollWidth || 0, root.scrollWidth, body?.offsetWidth || 0, root.offsetWidth, body?.clientWidth || 0, root.clientWidth),
    documentHeight: Math.max(body?.scrollHeight || 0, root.scrollHeight, body?.offsetHeight || 0, root.offsetHeight, body?.clientHeight || 0, root.clientHeight)
  };
})()`

/** Не подменяем ошибочно заданный режим снимком другой части страницы. */
function validate(options: BrowserScreenshotOptions): void {
  if ([Boolean(options.selector), Boolean(options.rect), options.fullPage === true].filter(Boolean).length > 1) throw new Error('Выбери один режим снимка: selector, rect или fullPage')
  if (options.selector !== undefined && (typeof options.selector !== 'string' || !options.selector.trim())) throw new Error('Нужен непустой selector')
  if (options.rect !== undefined) {
    const r = options.rect
    if (!r || ![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0) throw new Error('rect: нужны неотрицательные x/y и положительные width/height')
  }
  if (options.fullPage !== undefined && typeof options.fullPage !== 'boolean') throw new Error('fullPage должен быть boolean')
  if (options.format !== undefined && !['png', 'jpeg', 'webp'].includes(options.format)) throw new Error('Неизвестный формат снимка')
  if (options.quality !== undefined && (!Number.isInteger(options.quality) || options.quality < 0 || options.quality > 100)) throw new Error('quality должен быть целым числом от 0 до 100')
  if (options.scale !== undefined && !['css', 'device'].includes(options.scale)) throw new Error('Неизвестный масштаб снимка')
  if (options.animations !== undefined && !['allow', 'disabled'].includes(options.animations)) throw new Error('Неизвестный режим анимации')
  if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 100 || options.timeoutMs > 30_000)) throw new Error('timeoutMs должен быть от 100 до 30000')
}

/** Бинарь и описание берём у страницы; размер старого start не описывает crop. */
export async function capturePage(page: Page, options: BrowserScreenshotOptions, publicUrl: (raw: string) => string): Promise<BrowserCapture> {
  validate(options)
  const format = options.format ?? 'png'
  const scale = options.scale ?? 'device'
  const settings = {
    type: format, scale, timeout: options.timeoutMs ?? 10_000,
    ...(format !== 'png' && options.quality !== undefined ? { quality: options.quality } : {}),
    ...(options.animations ? { animations: options.animations } : {})
  }
  const target = options.selector ? page.locator(options.selector).first() : null
  // У Playwright clip без fullPage ограничен viewport. Внешний rect выражен
  // координатами документа и должен доставать до области ниже окна.
  const buffer = target
    ? await target.screenshot(settings)
    : await page.screenshot({ ...settings, fullPage: options.fullPage || Boolean(options.rect), ...(options.rect ? { clip: options.rect } : {}) })
  const metrics = await page.evaluate(metricsScript) as BrowserScreenshotRect & { documentWidth: number; documentHeight: number }
  let rect: BrowserScreenshotRect
  if (target) {
    const box = await target.boundingBox()
    if (!box) throw new Error('Элемент исчез после снимка')
    const x = Math.floor(box.x + metrics.x), y = Math.floor(box.y + metrics.y)
    rect = { x, y, width: Math.ceil(box.x + metrics.x + box.width) - x, height: Math.ceil(box.y + metrics.y + box.height) - y }
  } else if (options.rect) {
    const r = options.rect
    rect = { x: r.x, y: r.y, width: Math.min(r.width, metrics.documentWidth - r.x), height: Math.min(r.height, metrics.documentHeight - r.y) }
  } else if (options.fullPage) {
    rect = { x: 0, y: 0, width: metrics.documentWidth, height: metrics.documentHeight }
  } else {
    rect = { x: metrics.x, y: metrics.y, width: metrics.width, height: metrics.height }
  }
  return { buffer, mimeType: `image/${format}`, metadata: { rect, scale, page: { url: publicUrl(page.url()), title: await page.title().catch(() => '') } } }
}

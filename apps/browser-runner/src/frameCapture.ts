import type { Page } from 'playwright'
import type { BrowserScreenshotOptions } from '@voicechat/shared'
import { capturePage, validateScreenshotOptions } from './screenshots.js'
import { framePath, resolveFrame, type FramePath } from './frames.js'

interface Rect { x: number; y: number; width: number; height: number }
const intersect = (left: Rect, right: Rect): Rect => {
  const x = Math.max(left.x, right.x), y = Math.max(left.y, right.y)
  return { x, y, width: Math.min(left.x + left.width, right.x + right.width) - x, height: Math.min(left.y + left.height, right.y + right.height) - y }
}
const metrics = new Function('node', 'return { width: node.offsetWidth, height: node.offsetHeight, left: node.clientLeft, top: node.clientTop, innerWidth: node.clientWidth, innerHeight: node.clientHeight };') as (node: unknown) => { width: number; height: number; left: number; top: number; innerWidth: number; innerHeight: number }

/** Большой body.screenshot внутри iframe рисует пустоту за пределами окна.
 * Снимаем фактически видимую область, явно сообщая об усечении элемента. */
export async function captureFrame(page: Page, options: BrowserScreenshotOptions & { frame: FramePath }, publicUrl: (raw: string) => string = raw => raw) {
  validateScreenshotOptions(options)
  const deadline = performance.now() + (options.timeoutMs ?? 10000)
  const remaining = () => { const value = Math.floor(deadline - performance.now()); if (value <= 0) throw new Error('Истёк таймаут снимка iframe'); return value }
  if (options.fullPage || options.rect) throw new Error('Снимок frame поддерживает его видимую область или selector; fullPage и rect относятся к верхней странице')
  const frame = await resolveFrame(page, options.frame, remaining())
  const frameElement = await frame.frameElement()
  try {
    const target = options.selector ? frame.locator(options.selector).first() : frameElement
    await target.scrollIntoViewIfNeeded({ timeout: remaining() })
    const original = await target.boundingBox()
    if (!original) throw new Error('Область iframe не видна')
    const viewport = page.viewportSize()
    let rect = viewport ? intersect(original, { x: 0, y: 0, ...viewport }) : original
    for (let scope = options.selector ? frame : frame.parentFrame(); scope && scope !== page.mainFrame(); scope = scope.parentFrame()) {
      const element = await scope.frameElement()
      try {
        const box = await element.boundingBox(), dimensions = await element.evaluate(metrics)
        if (!box || dimensions.width <= 0 || dimensions.height <= 0) throw new Error('Родительский iframe не виден')
        const sx = box.width / dimensions.width, sy = box.height / dimensions.height
        rect = intersect(rect, { x: box.x + dimensions.left * sx, y: box.y + dimensions.top * sy, width: dimensions.innerWidth * sx, height: dimensions.innerHeight * sy })
      } finally { await element.dispose() }
    }
    if (rect.width <= 0 || rect.height <= 0) throw new Error('Элемент перекрыт границей iframe')
    const scroll = await page.evaluate('({x:scrollX,y:scrollY})') as { x: number; y: number }
    const x = Math.ceil(rect.x + scroll.x), y = Math.ceil(rect.y + scroll.y)
    const clip = { x, y, width: Math.floor(rect.x + scroll.x + rect.width) - x, height: Math.floor(rect.y + scroll.y + rect.height) - y }
    if (clip.width <= 0 || clip.height <= 0) throw new Error('Область iframe меньше одного CSS пикселя')
    const { frame: _frame, selector: _selector, fullPage: _full, rect: _rect, ...settings } = options
    const result = await capturePage(page, { ...settings, rect: clip }, publicUrl, remaining())
    return { ...result, metadata: { ...result.metadata, frame: { path: framePath(options.frame), url: publicUrl(frame.url()), title: await frame.title().catch(() => '') }, ...(rect.width < original.width || rect.height < original.height ? { clipped: true } : {}) } }
  } finally { await frameElement.dispose() }
}

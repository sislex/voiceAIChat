import type { Page } from 'playwright'
import { runSelectorAction } from './selectorActions.js'
import { framePage } from './frames.js'

const geometry = new Function('node', `
  let rotated = false;
  for (let current = node; current; current = current.parentElement || current.getRootNode().host) {
    const raw = getComputedStyle(current).transform;
    if (raw !== 'none') { const matrix = new DOMMatrixReadOnly(raw); if (!matrix.is2D || matrix.b || matrix.c) rotated = true; }
  }
  return { width: node.offsetWidth, height: node.offsetHeight, left: node.clientLeft, top: node.clientTop, innerWidth: node.clientWidth, innerHeight: node.clientHeight, rotated };
`) as (node: unknown) => { width: number; height: number; left: number; top: number; innerWidth: number; innerHeight: number; rotated: boolean }

/** Cross-origin не читается через contentDocument. Playwright даёт отдельный
 * Frame; координаты переводятся с учётом рамки и масштаба каждого iframe. */
export async function describeFramePoint(page: Page, x: number, y: number) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: 'Нужны числовые координаты x/y' }
  let frame = page.mainFrame(), point = { x, y }
  const path: string[] = []
  for (let depth = 0; depth <= 8; depth++) {
    const result = await runSelectorAction(framePage(page, frame), { kind: 'describe', ...point })
    if (!result.element) return result
    if (depth === 8 && ['iframe', 'frame'].includes(result.element.tag)) return { ok: false, error: 'Глубина iframe превышает 8' }
    const target = frame.locator(result.element.selector)
    if (['iframe', 'frame'].includes(result.element.tag) && depth < 8) {
      const element = await target.elementHandle({ timeout: 1000 })
      if (!element) return { ok: false, error: 'iframe исчез во время записи' }
      try {
        const child = await element.contentFrame(), box = await element.boundingBox(), dimensions = await element.evaluate(geometry)
        if (child && box && dimensions.width > 0 && dimensions.height > 0) {
          if (dimensions.rotated) return { ok: false, error: 'Запись внутри повёрнутого iframe пока недоступна' }
          const local = { x: (x - box.x) * dimensions.width / box.width - dimensions.left, y: (y - box.y) * dimensions.height / box.height - dimensions.top }
          if (local.x >= 0 && local.y >= 0 && local.x < dimensions.innerWidth && local.y < dimensions.innerHeight) {
            path.push(result.element.selector); frame = child; point = local; continue
          }
        }
      } finally { await element.dispose() }
    }
    const box = await target.boundingBox()
    return { ...result, element: { ...result.element, ...(path.length ? { frame: path } : {}), ...(box ? { rect: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) } } : {}) } }
  }
  return { ok: false, error: 'Глубина iframe превышает 8' }
}

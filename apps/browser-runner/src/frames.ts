import type { Frame, Page } from 'playwright'
import type { SelectorPage } from './selectorActions.js'
import { DOM_HELPERS } from './domHelpers.js'
import { resolveElementTargets } from './elementTargets.js'

import { normalizeBrowserFramePath as framePath, type BrowserFramePath as FramePath, type BrowserDocumentFrame as FrameInfo } from '@voicechat/shared'
export { normalizeBrowserFramePath as framePath } from '@voicechat/shared'
export type { BrowserFramePath as FramePath } from '@voicechat/shared'

/** Селектор разрешается заново для каждого действия: замена iframe в SPA не
 * оставляет модель с handle прежнего документа. Не выбираем первое совпадение. */
export async function resolveFrame(page: Page, value?: FramePath, timeoutMs = 5000): Promise<Frame> {
  let frame = page.mainFrame()
  const deadline = performance.now() + timeoutMs
  for (const selector of framePath(value)) {
    const locator = frame.locator(selector)
    await locator.waitFor({ state: 'attached', timeout: Math.max(1, deadline - performance.now()) })
    const handle = await locator.elementHandle({ timeout: Math.max(1, deadline - performance.now()) })
    if (!handle) throw new Error(`iframe ${selector} исчез`)
    try {
      const child = await handle.contentFrame()
      if (!child) throw new Error(`Элемент ${selector} не является готовым iframe`)
      frame = child
    } finally { await handle.dispose() }
  }
  return frame
}

/** Keyboard принадлежит Page, DOM и ожидания — выбранному Frame. */
export function framePage(page: Page, frame: Frame): SelectorPage {
  return {
    locator: frame.locator.bind(frame), getByText: frame.getByText.bind(frame),
    evaluate: frame.evaluate.bind(frame), keyboard: page.keyboard,
    waitForURL: frame.waitForURL.bind(frame), waitForLoadState: frame.waitForLoadState.bind(frame),
    waitForFunction: frame.waitForFunction.bind(frame)
  }
}

const identifyFrame = new Function('node', `${DOM_HELPERS}; return { ...targetOf(node), visible: visible(node) };`) as (node: unknown) => { selector: string; visible: boolean }

export async function listFrames(page: Page, publicUrl: (raw: string) => string = raw => raw): Promise<{ ok: true; frames: FrameInfo[]; total: number; truncated?: boolean }> {
  const frames: FrameInfo[] = [], all = page.frames().filter(frame => frame !== page.mainFrame())
  const paths = new Map<Frame, string[]>([[page.mainFrame(), []]])
  const visibility = new Map<Frame, boolean>([[page.mainFrame(), true]])
  let budget = 24000
  for (const frame of all.slice(0, 100)) {
    const parent = frame.parentFrame(), prefix = parent && paths.get(parent)
    if (!parent || !prefix || prefix.length >= 8 || frame.isDetached()) continue
    const element = await frame.frameElement()
    try {
      const target = await resolveElementTargets(parent, await element.evaluate(identifyFrame))
      const path = [...prefix, target.selector]
      paths.set(frame, path)
      const visible = target.visible && visibility.get(parent) === true
      visibility.set(frame, visible)
      const item = { path, url: publicUrl(frame.url()), title: (await frame.title().catch(() => '')).slice(0, 200), name: frame.name().slice(0, 200), visible }
      const size = JSON.stringify(item).length
      if (size <= budget) { frames.push(item); budget -= size }
    } finally { await element.dispose() }
  }
  return { ok: true, frames, total: all.length, ...(frames.length < all.length ? { truncated: true } : {}) }
}

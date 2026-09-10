import { BROWSER_UPLOAD_LIMIT_BYTES, isBrowserWaitOptions, type BrowserElementDescription, type BrowserSelectorAction, type BrowserSelectorResult } from '@voicechat/shared'
import { describeElementScript } from './describeElement.js'
import { findElements, readPage, readBounds, type ReadContent } from './pageReading.js'
import { readElementTargets } from './elementTargets.js'
import { waitForConditions, type WaitLocator, type WaitPage } from './waiting.js'

/**
 * Минимум от Playwright, который нужен селекторным действиям. Узкий тип вместо
 * `Page` — чтобы логику можно было проверить без Chromium: тесты подставляют
 * фейковые локаторы.
 */
export interface SelectorLocator extends WaitLocator {
  first(): SelectorLocator
  all(): Promise<SelectorLocator[]>
  filter(options: { visible?: boolean; hasText?: string }): SelectorLocator
  evaluateAll(script: string | ((nodes: unknown[], arg: unknown) => unknown), arg?: unknown): Promise<unknown>
  click(options?: { timeout?: number; button?: 'left' | 'right'; clickCount?: number; modifiers?: Array<'Shift' | 'Control' | 'Alt' | 'Meta'> }): Promise<void>
  press(key: string, options?: { timeout?: number }): Promise<void>
  fill(value: string, options?: { timeout?: number }): Promise<void>
  innerText(options?: { timeout?: number }): Promise<string>
  isVisible(): Promise<boolean>
  waitFor(options?: { state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }): Promise<void>
  hover(options?: { timeout?: number }): Promise<void>
  selectOption(value: string, options?: { timeout?: number }): Promise<unknown>
  check(options?: { timeout?: number }): Promise<void>
  uncheck(options?: { timeout?: number }): Promise<void>
  dragTo(target: SelectorLocator, options?: { timeout?: number }): Promise<void>
  scrollIntoViewIfNeeded(options?: { timeout?: number }): Promise<void>
  ariaSnapshot(options?: { timeout?: number }): Promise<string>
  evaluate(fn: string | ((node: unknown, arg: unknown) => unknown), arg?: unknown, options?: { timeout?: number }): Promise<unknown>
  setInputFiles(files: { name: string; mimeType: string; buffer: Buffer }, options?: { timeout?: number }): Promise<void>
}
export interface SelectorPage extends WaitPage {
  locator(selector: string): SelectorLocator
  getByText(text: string, options?: { exact?: boolean }): SelectorLocator
  keyboard: { press(key: string): Promise<void> }
  /** Код строкой: описание элемента и прокрутка исполняются в самой странице. */
  evaluate(script: string): Promise<unknown>
}

/**
 * Селекторные действия модели. Раньше раннер понимал только координаты, и
 * MCP-инструменты (они селекторные) до изолированного Chromium не доставали.
 * Каждое действие — один локатор Playwright; ошибка возвращается значением, а
 * не исключением: модель должна увидеть причину, а не «команда не выполнена».
 */
/** Потолок загрузки: содержимое едет в JSON, base64 раздувает его на треть. */
const UPLOAD_LIMIT_BYTES = BROWSER_UPLOAD_LIMIT_BYTES

/** Отказываем при неоднозначности: порядок DOM не выражает намерение модели. */
export async function uniqueTarget(target: SelectorLocator, timeout: number, hiddenAllowed = false): Promise<SelectorLocator> {
  const deadline = Date.now() + timeout
  const strict = hiddenAllowed ? target : target.filter({ visible: true })
  do {
    const count = await strict.count()
    if (count > 1) throw new Error(`Найдено несколько доступных элементов (${count}). Уточните селектор через find.`)
    if (count === 1) {
      // Копия DOM с тем же атрибутом не является исходным найденным узлом.
      const valid = await strict.evaluate(node => {
        const element = node as { getAttribute(name: string): string | null }
        const ref = element.getAttribute('data-voicechat-reader-ref')
        const state = (globalThis as unknown as { __voicechatReaderReferences?: { nodes: WeakMap<object, string> } }).__voicechatReaderReferences
        return !ref || state?.nodes.get(element) === ref
      })
      if (valid === false) throw new Error('stale_element_ref: Найдите элемент заново через find')
      return strict
    }
    if (Date.now() >= deadline) break
    await new Promise(resolve => setTimeout(resolve, Math.min(40, Math.max(0, deadline - Date.now()))))
  } while (Date.now() <= deadline)
  throw new Error(hiddenAllowed ? 'Элемент не найден' : 'Доступный элемент не найден')
}

export async function runSelectorAction(page: SelectorPage, action: BrowserSelectorAction, publicUrl: (raw: string) => string = raw => raw): Promise<BrowserSelectorResult> {
  const timeout = 'timeoutMs' in action && typeof action.timeoutMs === 'number' ? Math.min(Math.max(action.timeoutMs, 100), 30_000) : 5_000
  const locate = (selector?: string, text?: string): SelectorLocator | null =>
    selector ? (text ? page.locator(selector).filter({ hasText: text }) : page.locator(selector)) : text ? page.getByText(text, { exact: false }) : null
  try {
    if (action.kind === 'wait') {
      if (!isBrowserWaitOptions(action)) return { ok: false, error: 'Некорректные или несовместимые условия ожидания' }
      const started = performance.now()
      if ((action.selector || action.text) && action.count === undefined && (action.state === undefined || action.state === 'visible')) {
        await uniqueTarget(locate(action.selector, action.text)!, timeout)
      }
      const result = await waitForConditions(page, { ...action, timeoutMs: Math.max(1, Math.ceil(timeout - (performance.now() - started))) }, publicUrl)
      return { ...result, waitedMs: Math.round(performance.now() - started) }
    }
    if (action.kind === 'click') {
      const target = locate(action.selector, action.text)
      if (!target) return { ok: false, error: 'Нужен selector или text' }
      await (await uniqueTarget(target, timeout)).click({ timeout, button: action.button ?? 'left', clickCount: action.clickCount ?? 1, ...(action.modifiers ? { modifiers: action.modifiers } : {}) })
      return { ok: true }
    }
    if (action.kind === 'press') {
      await (await uniqueTarget(page.locator(action.selector), timeout)).press(action.key, { timeout })
      return { ok: true }
    }
    if (action.kind === 'scroll') {
      // document.scrollingElement и вложенный контейнер имеют разные позиции.
      // Ждём два кадра, чтобы scroll-событие уже увидели обработчики страницы.
      const target = await uniqueTarget(page.locator(action.selector || 'body'), timeout)
      const scrolled = await target.evaluate((element, value) => {
        const scope = globalThis as unknown as {
          document: { body: unknown; documentElement: unknown; scrollingElement: unknown }
          requestAnimationFrame(callback: () => void): void
        }
        const node = (element === scope.document.body || element === scope.document.documentElement ? scope.document.scrollingElement : element) as {
          scrollTop: number; scrollLeft: number; scrollHeight: number; scrollWidth: number; clientWidth: number; clientHeight: number; scrollTo(options: { top: number; left: number; behavior: string }): void
        }
        const options = value as { to?: 'top' | 'bottom'; dy: number; dx: number }
        const top = options.to === 'top' ? 0 : options.to === 'bottom' ? node.scrollHeight : node.scrollTop + options.dy
        node.scrollTo({ top, left: node.scrollLeft + options.dx, behavior: 'instant' })
        return new Promise(resolve => scope.requestAnimationFrame(() => scope.requestAnimationFrame(() => resolve({ top: node.scrollTop, left: node.scrollLeft, maxTop: Math.max(0, node.scrollHeight - node.clientHeight), maxLeft: Math.max(0, node.scrollWidth - node.clientWidth) }))))
      }, { to: action.to, dy: action.dy ?? (action.dx === undefined ? 400 : 0), dx: action.dx ?? 0 }, { timeout })
      return { ok: true, scrolled: scrolled as BrowserSelectorResult['scrolled'] }
    }
    if (action.kind === 'type') {
      await (await uniqueTarget(page.locator(action.selector), timeout)).fill(action.text, { timeout })
      if (action.submit) await page.keyboard.press('Enter')
      return { ok: true }
    }
    if (action.kind === 'read') {
      const options = readBounds(action.limit, action.offset)
      const target = await uniqueTarget(page.locator(action.selector || 'body'), timeout)
      return await readElementTargets(page, async () => ({ ok: true, ...await target.evaluate(readPage, options, { timeout }) as ReadContent }))
    }
    if (action.kind === 'hover') {
      const target = locate(action.selector, action.text)
      if (!target) return { ok: false, error: 'Нужен selector или text' }
      await (await uniqueTarget(target, timeout)).hover({ timeout })
      return { ok: true }
    }
    if (action.kind === 'set') {
      // Три разных контрола под одним действием: `type` не берёт ни один из них.
      const target = await uniqueTarget(page.locator(action.selector), timeout)
      if (typeof action.checked === 'boolean') {
        await (action.checked ? target.check({ timeout }) : target.uncheck({ timeout }))
        return { ok: true }
      }
      if (typeof action.value !== 'string') return { ok: false, error: 'Нужен value или checked' }
      // select отличаем от текстового поля по факту: сначала пробуем как select,
      // и только на отказе — как поле ввода.
      try { await target.selectOption(action.value, { timeout }); return { ok: true } }
      catch { await target.fill(action.value, { timeout }); return { ok: true } }
    }
    if (action.kind === 'drag') {
      await (await uniqueTarget(page.locator(action.from), timeout)).dragTo(await uniqueTarget(page.locator(action.to), timeout), { timeout })
      return { ok: true }
    }
    if (action.kind === 'upload') {
      // Файл приходит base64 и уходит в память Playwright: писать его на диск
      // раннера незачем, а вот ограничить размер — обязательно.
      const encoded = action.base64.replace(/\s/g, '')
      // Buffer.from пропускает мусор; без проверки модель загружала другой файл
      // и получала ok. Проверяем до выделения памяти, пустой файл допустим.
      if (encoded.length > Math.ceil(UPLOAD_LIMIT_BYTES / 3) * 4) return { ok: false, error: 'Файл больше 8 МБ' }
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1 || (encoded.includes('=') && encoded.length % 4 !== 0)) return { ok: false, error: 'Некорректное содержимое base64' }
      const buffer = Buffer.from(encoded, 'base64')
      if (buffer.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) return { ok: false, error: 'Некорректное содержимое base64' }
      if (buffer.length > UPLOAD_LIMIT_BYTES) return { ok: false, error: `Файл больше ${Math.round(UPLOAD_LIMIT_BYTES / 1024 / 1024)} МБ` }
      await (await uniqueTarget(page.locator(action.selector), timeout, true)).setInputFiles({ name: action.name, mimeType: action.mimeType || 'application/octet-stream', buffer }, { timeout })
      return { ok: true }
    }
    if (action.kind === 'describe') {
      return await readElementTargets(page, async () => {
        const found = await page.evaluate(describeElementScript(action.x, action.y)) as BrowserElementDescription | null
        return found ? { ok: true, element: found } : { ok: false, error: 'В этой точке нет элемента' }
      })
    }
    if (action.kind === 'scrollTo') {
      const target = await uniqueTarget(page.locator(action.selector), timeout)
      await target.evaluate(node => (node as { scrollIntoView(options: { block: string; inline: string; behavior: string }): void }).scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }))
      return { ok: true }
    }
    if (action.kind === 'a11y') {
      const target = await uniqueTarget(page.locator(action.selector || 'body'), timeout)
      const snapshot = await target.ariaSnapshot({ timeout })
      const limit = Math.min(Math.max(action.limit ?? 4000, 100), 20_000)
      return snapshot.length > limit ? { ok: true, text: `${snapshot.slice(0, limit)}…`, truncated: true } : { ok: true, text: snapshot }
    }
    if (action.kind === 'find') {
      const target = locate(action.selector, action.text)
      if (!target) return { ok: false, error: 'Нужен selector или text' }
      const limit = Math.min(Math.max(action.limit ?? 10, 1), 50)
      const filtered = action.visibleOnly !== false ? target.filter({ visible: true }) : target
      return await readElementTargets(page, async () => ({ ok: true, ...await filtered.evaluateAll(findElements, limit) as ReadContent }))
    }
    return { ok: false, error: 'Неизвестное селекторное действие' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.split('\n')[0] : 'Действие не выполнено' }
  }
}

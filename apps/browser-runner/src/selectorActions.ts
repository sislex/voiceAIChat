import type { BrowserElementDescription, BrowserSelectorAction, BrowserSelectorResult } from '@voicechat/shared'
import { describeElementScript } from './describeElement.js'

/**
 * Минимум от Playwright, который нужен селекторным действиям. Узкий тип вместо
 * `Page` — чтобы логику можно было проверить без Chromium: тесты подставляют
 * фейковые локаторы.
 */
export interface SelectorLocator {
  first(): SelectorLocator
  filter(options: { visible: boolean }): SelectorLocator
  all(): Promise<SelectorLocator[]>
  count(): Promise<number>
  click(options?: { timeout?: number; button?: 'left' | 'right'; clickCount?: number }): Promise<void>
  fill(value: string, options?: { timeout?: number }): Promise<void>
  innerText(options?: { timeout?: number }): Promise<string>
  isVisible(): Promise<boolean>
  waitFor(options?: { state?: 'visible'; timeout?: number }): Promise<void>
  hover(options?: { timeout?: number }): Promise<void>
  selectOption(value: string, options?: { timeout?: number }): Promise<unknown>
  check(options?: { timeout?: number }): Promise<void>
  uncheck(options?: { timeout?: number }): Promise<void>
  dragTo(target: SelectorLocator, options?: { timeout?: number }): Promise<void>
  ariaSnapshot(options?: { timeout?: number }): Promise<string>
  evaluate(fn: (element: unknown) => unknown): Promise<unknown>
  setInputFiles(files: { name: string; mimeType: string; buffer: Buffer }, options?: { timeout?: number }): Promise<void>
}
export interface SelectorPage {
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
const UPLOAD_LIMIT_BYTES = 8 * 1024 * 1024

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

/** Ссылка принадлежит узлу документа и переживает перестановку соседей. */
const referenceForElement = (node: unknown): string => {
  const element = node as { setAttribute(name: string, value: string): void }
  const globals = globalThis as unknown as { __voicechatReaderReferences?: { nodes: WeakMap<object, string>; prefix: string; next: number } }
  const state = globals.__voicechatReaderReferences ??= { nodes: new WeakMap(), prefix: Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-'), next: 0 }
  let ref = state.nodes.get(element)
  if (!ref) { ref = state.prefix + '-' + (++state.next); state.nodes.set(element, ref) }
  element.setAttribute('data-voicechat-reader-ref', ref)
  return '[data-voicechat-reader-ref="' + ref + '"]'
}

export async function runSelectorAction(page: SelectorPage, action: BrowserSelectorAction): Promise<BrowserSelectorResult> {
  const timeout = 'timeoutMs' in action && typeof action.timeoutMs === 'number' ? Math.min(Math.max(action.timeoutMs, 100), 30_000) : 5_000
  const locate = (selector?: string, text?: string): SelectorLocator | null =>
    selector ? page.locator(selector) : text ? page.getByText(text, { exact: false }) : null
  try {
    if (action.kind === 'click') {
      const target = locate(action.selector, action.text)
      if (!target) return { ok: false, error: 'Нужен selector или text' }
      await (await uniqueTarget(target, timeout)).click({ timeout, button: action.button ?? 'left', clickCount: action.clickCount ?? 1 })
      return { ok: true }
    }
    if (action.kind === 'type') {
      await (await uniqueTarget(page.locator(action.selector), timeout)).fill(action.text, { timeout })
      if (action.submit) await page.keyboard.press('Enter')
      return { ok: true }
    }
    if (action.kind === 'read') {
      const target = await uniqueTarget(page.locator(action.selector || 'body'), timeout)
      const text = (await target.innerText({ timeout })).trim()
      const limit = Math.min(Math.max(action.limit ?? 4000, 100), 20_000)
      // Обрезка сообщается признаком, а не только многоточием в конце: по
      // многоточию не отличить усечение от текста, который сам им кончается.
      return text.length > limit ? { ok: true, text: `${text.slice(0, limit)}…`, truncated: true } : { ok: true, text }
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
      const buffer = Buffer.from(action.base64, 'base64')
      if (!buffer.length) return { ok: false, error: 'Пустое содержимое файла' }
      if (buffer.length > UPLOAD_LIMIT_BYTES) return { ok: false, error: `Файл больше ${Math.round(UPLOAD_LIMIT_BYTES / 1024 / 1024)} МБ` }
      await (await uniqueTarget(page.locator(action.selector), timeout, true)).setInputFiles({ name: action.name, mimeType: action.mimeType || 'application/octet-stream', buffer }, { timeout })
      return { ok: true }
    }
    if (action.kind === 'describe') {
      const found = await page.evaluate(describeElementScript(action.x, action.y)) as BrowserElementDescription | null
      return found ? { ok: true, element: found } : { ok: false, error: 'В этой точке нет элемента' }
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
      const found = await target.all()
      const matches: NonNullable<BrowserSelectorResult['matches']> = []
      for (const item of found) {
        if (!await item.isVisible().catch(() => false)) continue
        const selector = await item.evaluate(referenceForElement)
        if (typeof selector !== 'string') throw new Error('Не удалось создать ссылку на элемент')
        matches.push({ selector, text: (await item.innerText().catch(() => '')).trim().slice(0, 200), visible: true })
        if (matches.length >= limit) break
      }
      return { ok: true, matches }
    }
    const target = locate(action.selector, action.text)
    if (!target) return { ok: false, error: 'Нужен selector или text' }
    await (await uniqueTarget(target, timeout)).waitFor({ state: 'visible', timeout })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.split('\n')[0] : 'Действие не выполнено' }
  }
}

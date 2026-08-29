import type { BrowserSelectorAction, BrowserSelectorResult } from '@voicechat/shared'

/**
 * Минимум от Playwright, который нужен селекторным действиям. Узкий тип вместо
 * `Page` — чтобы логику можно было проверить без Chromium: тесты подставляют
 * фейковые локаторы.
 */
export interface SelectorLocator {
  first(): SelectorLocator
  all(): Promise<SelectorLocator[]>
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
  evaluate(fn: string): Promise<unknown>
}
export interface SelectorPage {
  locator(selector: string): SelectorLocator
  getByText(text: string, options?: { exact?: boolean }): SelectorLocator
  keyboard: { press(key: string): Promise<void> }
}

/**
 * Селекторные действия модели. Раньше раннер понимал только координаты, и
 * MCP-инструменты (они селекторные) до изолированного Chromium не доставали.
 * Каждое действие — один локатор Playwright; ошибка возвращается значением, а
 * не исключением: модель должна увидеть причину, а не «команда не выполнена».
 */
export async function runSelectorAction(page: SelectorPage, action: BrowserSelectorAction): Promise<BrowserSelectorResult> {
  const timeout = 'timeoutMs' in action && typeof action.timeoutMs === 'number' ? Math.min(Math.max(action.timeoutMs, 100), 30_000) : 5_000
  const locate = (selector?: string, text?: string): SelectorLocator | null =>
    selector ? page.locator(selector) : text ? page.getByText(text, { exact: false }) : null
  try {
    if (action.kind === 'click') {
      const target = locate(action.selector, action.text)
      if (!target) return { ok: false, error: 'Нужен selector или text' }
      await target.first().click({ timeout, button: action.button ?? 'left', clickCount: action.clickCount ?? 1 })
      return { ok: true }
    }
    if (action.kind === 'type') {
      await page.locator(action.selector).first().fill(action.text, { timeout })
      if (action.submit) await page.keyboard.press('Enter')
      return { ok: true }
    }
    if (action.kind === 'read') {
      const target = action.selector ? page.locator(action.selector).first() : page.locator('body')
      const text = (await target.innerText({ timeout })).trim()
      const limit = Math.min(Math.max(action.limit ?? 4000, 100), 20_000)
      return { ok: true, text: text.length > limit ? `${text.slice(0, limit)}…` : text }
    }
    if (action.kind === 'hover') {
      const target = locate(action.selector, action.text)
      if (!target) return { ok: false, error: 'Нужен selector или text' }
      await target.first().hover({ timeout })
      return { ok: true }
    }
    if (action.kind === 'set') {
      // Три разных контрола под одним действием: `type` не берёт ни один из них.
      const target = page.locator(action.selector).first()
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
      await page.locator(action.from).first().dragTo(page.locator(action.to).first(), { timeout })
      return { ok: true }
    }
    if (action.kind === 'a11y') {
      const target = action.selector ? page.locator(action.selector).first() : page.locator('body')
      const snapshot = await target.ariaSnapshot({ timeout })
      const limit = Math.min(Math.max(action.limit ?? 4000, 100), 20_000)
      return { ok: true, text: snapshot.length > limit ? `${snapshot.slice(0, limit)}…` : snapshot }
    }
    if (action.kind === 'find') {
      const target = locate(action.selector, action.text)
      if (!target) return { ok: false, error: 'Нужен selector или text' }
      const limit = Math.min(Math.max(action.limit ?? 10, 1), 50)
      const found = await target.all()
      const matches = await Promise.all(found.slice(0, limit).map(async (item: SelectorLocator, index: number) => ({
        selector: action.selector ? `${action.selector} >> nth=${index}` : `text=${action.text ?? ''} >> nth=${index}`,
        text: (await item.innerText().catch(() => '')).trim().slice(0, 200),
        visible: await item.isVisible().catch(() => false)
      })))
      return { ok: true, matches }
    }
    const target = locate(action.selector, action.text)
    if (!target) return { ok: false, error: 'Нужен selector или text' }
    await target.first().waitFor({ state: 'visible', timeout })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.split('\n')[0] : 'Действие не выполнено' }
  }
}

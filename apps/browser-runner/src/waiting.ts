import { browserUrlMatches, type BrowserWaitOptions } from '@voicechat/shared'

export interface WaitLocator {
  first(): WaitLocator
  filter(options: { visible?: boolean; hasText?: string }): WaitLocator
  count(): Promise<number>
  waitFor(options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout: number }): Promise<void>
  isVisible(): Promise<boolean>
  isEnabled(options: { timeout: number }): Promise<boolean>
  isEditable(options: { timeout: number }): Promise<boolean>
  isChecked(options: { timeout: number }): Promise<boolean>
  inputValue(options: { timeout: number }): Promise<string>
}

export interface WaitPage {
  locator(selector: string): WaitLocator
  getByText(text: string, options: { exact: boolean }): WaitLocator
  waitForURL(predicate: (url: URL) => boolean, options: { timeout: number; waitUntil: 'commit' }): Promise<void>
  waitForLoadState(state: 'domcontentloaded' | 'load', options: { timeout: number }): Promise<void>
  waitForFunction(expression: string, arg: undefined, options: { timeout: number; polling: number }): Promise<{ dispose(): Promise<void> }>
}

/** Все условия получают один срок: сочетание трёх ожиданий не длится 3×timeout. */
export async function waitForConditions(page: WaitPage, options: BrowserWaitOptions, publicUrl: (raw: string) => string = raw => raw): Promise<{ ok: true; waitedMs: number }> {
  const timeout = options.timeoutMs ?? 5000
  const started = performance.now(), deadline = started + timeout
  const remaining = () => Math.max(1, Math.ceil(deadline - performance.now()))
  const timedOut = () => new Error(`Условия ожидания не выполнены за ${timeout} мс`)
  const jobs: Array<Promise<unknown>> = []
  if (options.selector || options.text) {
    const base = options.selector ? page.locator(options.selector) : page.getByText(options.text!, { exact: false })
    const target = options.selector && options.text ? base.filter({ hasText: options.text }) : base
    const state = options.state ?? (options.count !== undefined ? options.count === 0 ? 'detached' : 'attached' : 'visible')
    const hasFields = options.enabled !== undefined || options.editable !== undefined || options.checked !== undefined || options.value !== undefined
    if (!hasFields && options.count === undefined) jobs.push(target.first().waitFor({ state, timeout: remaining() }))
    else jobs.push((async () => {
      while (true) {
        const count = await target.count(), first = target.first()
        let ready = (options.count === undefined || options.count === count) && (
          state === 'attached' ? count > 0 : state === 'detached' ? count === 0 : state === 'hidden' ? count === 0 || !(await first.isVisible()) : count > 0 && await first.isVisible()
        )
        if (hasFields && count === 0) ready = false
        if (ready && options.enabled !== undefined) ready = await first.isEnabled({ timeout: remaining() }) === options.enabled
        if (ready && options.editable !== undefined) ready = await first.isEditable({ timeout: remaining() }) === options.editable
        if (ready && options.checked !== undefined) ready = await first.isChecked({ timeout: remaining() }) === options.checked
        if (ready && options.value !== undefined) ready = await first.inputValue({ timeout: remaining() }) === options.value
        if (ready) return
        if (performance.now() >= deadline) throw timedOut()
        await new Promise(resolve => setTimeout(resolve, Math.min(50, remaining())))
      }
    })())
  }
  if (options.url) jobs.push(page.waitForURL(url => browserUrlMatches(publicUrl(url.toString()), options.url!), { timeout: remaining(), waitUntil: 'commit' }))
  if (options.loadState) jobs.push(page.waitForLoadState(options.loadState, { timeout: remaining() }))
  if (options.predicate) jobs.push((async () => {
    const expression = `(() => { const value = (${options.predicate}); const result = typeof value === 'function' ? value() : value; if (result && typeof result.then === 'function') { Promise.resolve(result).catch(() => {}); throw new Error('predicate должен возвращать синхронное значение'); } return result; })()`
    const handle = await page.waitForFunction(expression, undefined, { timeout: remaining(), polling: 50 })
    await handle.dispose()
  })())
  // Дожидаемся завершения каждого запроса, чтобы после ошибки не оставались
  // фоновые ожидания прежней команды. Их общий срок всё равно ограничен.
  const outcomes = await Promise.allSettled(jobs)
  const failed = outcomes.find(result => result.status === 'rejected')
  if (failed?.status === 'rejected') {
    if (failed.reason instanceof Error && failed.reason.name === 'TimeoutError' && performance.now() >= deadline) throw timedOut()
    throw failed.reason
  }
  return { ok: true, waitedMs: Math.round(performance.now() - started) }
}

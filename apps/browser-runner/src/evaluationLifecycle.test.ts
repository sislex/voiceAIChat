import { afterEach, expect, it, vi } from 'vitest'
import { chromium, type Browser, type Page, type JSHandle } from 'playwright'
import { runEvaluation } from './evaluation.js'
import { BrowserDialogs } from './dialogs.js'
let browser: Browser | undefined
afterEach(async () => {
  vi.useRealTimers()
  await browser?.close()
  browser = undefined
})
it('timeout завершает ожидающий RPC и освобождает holder, сохраняя страницу', async () => {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage(),
    frame = page.mainFrame()
  const original = frame.evaluateHandle.bind(frame),
    captured: JSHandle[] = []
  let pending = 0
  vi.spyOn(frame, 'evaluateHandle').mockImplementation((async (fn: any, arg: any) => {
    const handle = await original(fn, arg),
      evaluate = handle.evaluate.bind(handle) as (...args: any[]) => Promise<any>
    captured.push(handle)
    vi.spyOn(handle, 'evaluate').mockImplementation(((...args: any[]) => {
      pending++
      return evaluate(...args).finally(() => pending--)
    }) as typeof handle.evaluate)
    return handle
  }) as typeof frame.evaluateHandle)
  expect((await runEvaluation(page, frame, { code: 'while(true){}', timeoutMs: 100 })).timedOut).toBe(true)
  expect(pending).toBe(0)
  await expect(captured[0].evaluate(() => 1)).rejects.toThrow()
  expect(page.isClosed()).toBe(false)
  expect(await page.evaluate('1+2')).toBe(3)
})
it('поздно пришедший holder освобождается без выполнения кода после timeout', async () => {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage(),
    frame = page.mainFrame()
  const original = frame.evaluateHandle.bind(frame),
    captured: JSHandle[] = []
  let release!: () => void
  const delayed = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.spyOn(frame, 'evaluateHandle').mockImplementation((async (fn: any, arg: any) => {
    const handle = await original(fn, arg)
    captured.push(handle)
    await delayed
    return handle
  }) as typeof frame.evaluateHandle)
  expect((await runEvaluation(page, frame, { code: 'window.unexpected=true', timeoutMs: 100 })).timedOut).toBe(true)
  release()
  expect(captured).toHaveLength(1)
  await expect
    .poll(async () => {
      try {
        await captured[0].evaluate(() => 1)
        return false
      } catch {
        return true
      }
    })
    .toBe(true)
  expect(await page.evaluate('window.unexpected')).toBeUndefined()
  expect(await page.evaluate('1+2')).toBe(3)
})
it('десять status разделяют один зависший title и возвращаются по deadline', async () => {
  vi.useFakeTimers()
  let resolve!: (title: string) => void
  const waiting = new Promise<string>((done) => {
      resolve = done
    }),
    title = vi.fn(() => waiting)
  const page = { title } as unknown as Page,
    dialogs = new BrowserDialogs()
  const calls = Array.from({ length: 10 }, () => dialogs.title(page))
  await vi.advanceTimersByTimeAsync(210)
  expect(await Promise.all(calls)).toEqual(Array(10).fill(''))
  expect(title).toHaveBeenCalledTimes(1)
  resolve('Готовая страница')
  await Promise.resolve()
  await Promise.resolve()
  expect(await dialogs.title(page)).toBe('Готовая страница')
})

it('evaluate работает при строгих CSP и Trusted Types страницы', async () => {
  browser = await chromium.launch({ headless: true }); const page = await browser.newPage()
  await page.setContent(`<meta http-equiv="Content-Security-Policy" content="script-src 'none'; require-trusted-types-for 'script'; trusted-types 'none'"><h1>Строгая политика</h1>`)
  expect((await runEvaluation(page, page.mainFrame(), { code: 'document.querySelector("h1").textContent' })).value).toBe('Строгая политика')
})

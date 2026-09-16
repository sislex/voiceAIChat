import { beforeAll, afterAll, expect, it } from 'vitest'
import { createServer, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium, type Browser } from 'playwright'
import { resolve } from 'node:path'
import { mkdirSync } from 'node:fs'

let server: ViteDevServer, browser: Browser, base: string
beforeAll(async () => {
  const root = resolve(__dirname, '..')
  mkdirSync(resolve(root, 'artifacts/lazy-boundary'), { recursive: true })
  server = await createServer({ configFile: false, root, plugins: [react(), {
    name: 'boundary-fixture',
    configureServer(server) { server.middlewares.use(async (req, res, next) => {
      if (req.url?.split('?')[0] !== '/') return next()
      res.setHeader('content-type', 'text/html')
      res.end(await server.transformIndexHtml('/', '<html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div><script type="module" src="/e2e/fixtures/lazy-boundary.tsx"></script></body></html>'))
    }) }
  }], resolve: { alias: { '@shared': resolve(root, 'packages/shared/src') } }, server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  base = server.resolvedUrls!.local[0]!
  browser = await chromium.launch()
}, 60000)
afterAll(async () => { await browser?.close(); await server?.close() })

// @testCase TC-UI
// @testCase TC-INTENT
// @testCase TC-RECOVERY
it.each([[1440, 900], [1280, 720], [768, 1024], [390, 844], [320, 700]])('keeps loading and recovery usable at %dx%d in both themes', async (width, height) => {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width <= 768 })
    const page = await context.newPage()
    try {
      await page.goto(base)
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      await page.getByRole('textbox', { name: 'Draft' }).fill('Unsaved long text '.repeat(40))
      const before = await page.getByRole('heading', { name: 'Shell' }).boundingBox()
      // Dispatch activation without intent to exercise the initial failure.
      await page.getByRole('button', { name: 'Open optional' }).dispatchEvent('click')
      await page.getByRole('status', { name: 'Загрузка экрана' }).waitFor()
      await page.getByRole('alert').waitFor()
      await page.screenshot({ path: 'artifacts/lazy-boundary/' + width + '-' + height + '-' + theme + '-error.png' })
      const retry = page.getByRole('button', { name: 'Повторить' })
      await retry.focus(); await page.keyboard.press('Enter')
      await page.getByRole('region', { name: 'Optional ready' }).waitFor()
      expect(await page.getByRole('textbox', { name: 'Draft' }).inputValue()).toBe('Unsaved long text '.repeat(40))
      expect(await page.getByRole('heading', { name: 'Shell' }).boundingBox()).toEqual(before)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.getByRole('button', { name: 'Close optional' }).click()
      const open = page.getByRole('button', { name: 'Open optional' })
      await open.focus()
      await open.dispatchEvent('touchstart')
      await open.hover()
      await open.click()
      await page.getByRole('region', { name: 'Optional ready' }).waitFor()
      expect(await page.locator('body').getAttribute('data-load-attempts')).toBe('2')
      await page.screenshot({ path: 'artifacts/lazy-boundary/' + width + '-' + height + '-' + theme + '-ready.png' })
      // CSS zoom and a reduced visual area are emulations, not real keyboard evidence.
      await page.evaluate(() => { document.documentElement.style.setProperty('--qa-safe-area', '32px'); document.body.style.zoom = '2' })
      await page.setViewportSize({ width, height: Math.floor(height * 0.6) })
      await page.getByRole('textbox', { name: 'Draft' }).scrollIntoViewIfNeeded()
      expect(await page.getByRole('textbox', { name: 'Draft' }).isVisible()).toBe(true)
    } finally { await context.close() }
  }
}, 60000)

// @testCase TC-RECOVERY
it.each(['404', 'offline'])('preserves the shell and draft during a real %s module request failure', async failure => {
  const context = await browser.newContext({ viewport: { width: 320, height: 700 }, hasTouch: true })
  const page = await context.newPage()
  try {
    await page.route('**/e2e/fixtures/optional-ready.tsx', route => failure === '404' ? route.fulfill({ status: 404, body: 'Missing chunk' }) : route.abort('internetdisconnected'))
    await page.goto(base + '?network')
    await page.getByRole('textbox', { name: 'Draft' }).fill('Keep this draft through a real request failure')
    await page.getByRole('button', { name: 'Open optional' }).dispatchEvent('click')
    await page.getByRole('alert').waitFor()
    expect(await page.getByRole('heading', { name: 'Shell' }).isVisible()).toBe(true)
    expect(await page.getByRole('textbox', { name: 'Draft' }).inputValue()).toBe('Keep this draft through a real request failure')
    await page.unroute('**/e2e/fixtures/optional-ready.tsx')
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.getByRole('button', { name: 'Повторить' }).click()
      await page.waitForFunction(count => document.body.dataset.loadAttempts === String(count), attempt + 2)
    }
    await page.getByRole('button', { name: 'Обновить приложение' }).focus()
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.body.dataset.loadAttempts === undefined)
    await page.getByRole('button', { name: 'Open optional' }).dispatchEvent('click')
    await page.getByRole('region', { name: 'Optional ready' }).waitFor({ timeout: 5000 })
    expect(await page.getByRole('textbox', { name: 'Draft' }).inputValue()).toBe('Keep this draft through a real request failure')
  } finally { await context.close() }
}, 20000)

// @testCase TC-RECOVERY
it.each(['unavailable HTML', 'already refreshed'])('keeps the live document when refresh is unsafe: %s', async reason => {
  const context = await browser.newContext({ viewport: { width: 320, height: 700 } })
  const page = await context.newPage()
  try {
    await page.route('**/e2e/fixtures/optional-ready.tsx', route => route.abort())
    await page.goto(base + '?network')
    await page.getByRole('textbox', { name: 'Draft' }).fill('Keep without navigating')
    await page.getByRole('button', { name: 'Open optional' }).dispatchEvent('click')
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.getByRole('button', { name: 'Повторить' }).click()
      await page.waitForFunction(count => document.body.dataset.loadAttempts === String(count), attempt + 2)
    }
    const origin = await page.evaluate(() => performance.timeOrigin)
    if (reason === 'already refreshed') await page.evaluate(() => sessionStorage.setItem('vc.chunk-recovery.v1', '1'))
    else await page.route(base + '?network', route => route.fulfill({ status: 503, body: 'Unavailable' }))
    await page.getByRole('button', { name: 'Обновить приложение' }).click()
    await page.getByRole('alert').filter({ hasText: reason === 'already refreshed' ? 'Повторное обновление заблокировано' : 'Приложение пока недоступно' }).waitFor()
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin)
    expect(await page.getByRole('textbox', { name: 'Draft' }).inputValue()).toBe('Keep without navigating')
    expect(await page.getByRole('heading', { name: 'Shell' }).isVisible()).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  } finally { await context.close() }
}, 20000)

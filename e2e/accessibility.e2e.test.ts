import { afterAll, beforeAll, expect, it } from 'vitest'
import { createServer, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium, type Browser } from 'playwright'
import { resolve } from 'node:path'
import { readdirSync, readFileSync, statSync } from 'node:fs'

// Run after the production build (the web gate does this). Missing chunks fail:
// an eager import must not make an apparently cheap lazy screen disappear.
it.each([
  ['ReleaseCenter-', 60_000],
  ['SettingsModal-', 40_000],
  ['ProjectSettings-', 90_000]
] as const)('%s production chunk stays within %i bytes', (prefix, maxBytes) => {
  const assets = resolve(__dirname, '../apps/web/dist/assets')
  const names = readdirSync(assets).filter(name => name.startsWith(prefix) && name.endsWith('.js'))
  expect(names).toHaveLength(1)
  expect(statSync(resolve(assets, names[0]!)).size).toBeLessThanOrEqual(maxBytes)
  const html = readFileSync(resolve(__dirname, '../apps/web/dist/index.html'), 'utf8')
  expect(html).not.toContain(names[0])
})

let server: ViteDevServer, browser: Browser, base: string
beforeAll(async () => {
  const root = resolve(__dirname, '..')
  server = await createServer({
    configFile: false, root, plugins: [react(), {
      name: 'accessibility-fixture',
      configureServer(server) {
        server.middlewares.use('/', async (req, res, next) => {
          if (!req.url?.startsWith('/?screen=')) return next()
          res.setHeader('content-type', 'text/html')
          res.end(await server.transformIndexHtml('/', '<html lang="ru"><head><title>Accessibility audit</title><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/packages/ui/src/test/accessibilityBrowser.tsx"></script></body></html>'))
        })
      }
    }], resolve: { alias: [{ find: /^@shared\//, replacement: root + '/packages/shared/src/' }] },
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'error'
  })
  await server.listen()
  base = server.resolvedUrls!.local[0]
  browser = await chromium.launch()
})
afterAll(async () => { await browser?.close(); await server?.close() })

// @testCase TC-UI-02
// @testCase TC-UI-01
it.each(['queuedMerge', 'queuedMergeCard'])('%s supports the complete theme/viewport matrix and keyboard reassignment', async screen => {
  for (const theme of ['light', 'dark']) for (const [width, height] of [[320,700],[390,844],[768,1024],[1280,720],[1440,900]]) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: true, reducedMotion: 'reduce' })
    try {
      await page.goto(base + '?screen=' + screen)
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      const select = page.getByRole('combobox', { name: 'Новая машина merge-рана' })
      await select.waitFor()
      await expect.poll(() => select.isEnabled()).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const section = page.getByRole('region', { name: 'Смена машины merge-рана' })
      const targets = await section.locator('select, button').evaluateAll(nodes => nodes.map(node => {
        const rect = node.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      }))
      expect(targets.every(rect => rect.width >= 44 && rect.height >= 44), JSON.stringify(targets)).toBe(true)
      await select.focus()
      // Native popup keyboard selection is platform-owned in headless macOS;
      // selectOption drives its change event, then Tab/Enter verify submission.
      await select.selectOption('machine-b')
      const button = page.getByRole('button', { name: 'Сменить машину', exact: true })
      await expect.poll(() => button.isEnabled()).toBe(true)
      await page.keyboard.press('Tab')
      expect(await button.evaluate(node => document.activeElement === node)).toBe(true)
      expect(await button.evaluate(node => getComputedStyle(node).outlineStyle)).toBe('solid')
      await page.keyboard.press('Enter')
      await expect.poll(() => select.inputValue()).toBe('machine-b')
      await expect.poll(() => select.evaluate(node => document.activeElement === node)).toBe(true)
      expect(await section.getByRole('status').textContent()).toContain('Машина изменена')
      // Chromium cannot open an OS keyboard in headless mode; constrain the
      // viewport to verify the same reduced-height scrolling and focus path.
      await page.setViewportSize({ width, height: Math.max(320, height - 300) })
      await select.tap()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.keyboard.press('Escape')
      await page.screenshot({ path: resolve(__dirname, `../.generated_images/CHAT-475-${screen}-${theme}-${width}.png`), fullPage: true })
    } finally { await page.close() }
  }
})


it.each(['shell', 'chat', 'board', 'task', 'releases', 'settings', 'projectSettings', 'admin'])('%s fits 390px and exposes visible keyboard focus', async screen => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.goto(base + '?screen=' + screen)
    await page.waitForSelector('body[data-ready=true]')
    await expect.poll(() => page.locator('button:visible').count()).toBeGreaterThan(0)
    if (screen === 'shell') {
      await page.getByRole('link', { name: 'К содержимому' }).focus()
      await page.keyboard.press('Enter')
      expect(await page.getByRole('main').evaluate(node => document.activeElement === node)).toBe(true)
      expect(await page.title()).toContain('Чат')
      expect(await page.getByRole('main').count()).toBe(1)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const targets = await page.locator('button:visible').evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect()
      return { text: node.textContent?.trim(), width: rect.width, height: rect.height }
    }).filter(rect => rect.width < 39.5 || rect.height < 39.5))
    expect(targets).toEqual([])
    // Walk every reachable control, including the dialog's wrap boundary.
    const count = await page.locator('button:visible, input:visible, select:visible, a:visible, summary:visible').count()
    for (let i = 0; i < Math.min(count + 2, 160); i++) {
      await page.keyboard.press('Tab')
      const focus = await page.evaluate(() => {
        const node = document.activeElement as HTMLElement
        if (node === document.body) return null
        const style = getComputedStyle(node)
        const rect = node.getBoundingClientRect()
        return { outline: style.outlineStyle, width: parseFloat(style.outlineWidth), visible: rect.width > 0 && rect.height > 0 }
      })
      if (focus) expect(focus, await page.evaluate(() => document.activeElement?.outerHTML)).toMatchObject({ outline: 'solid', width: 2, visible: true })
    }
    expect(await page.evaluate(() => [...document.querySelectorAll('*')].some(node => {
      const style = getComputedStyle(node)
      return style.animationName !== 'none' || parseFloat(style.transitionDuration) > 0
    }))).toBe(false)
    expect(errors).toEqual([])
  } finally { await page.close() }
})

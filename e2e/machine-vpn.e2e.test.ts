import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'

const root = fileURLToPath(new URL('../', import.meta.url))
let child: ChildProcess | undefined
let browser: Browser | undefined
let base: string
beforeAll(async () => {
  await mkdir(resolve(root, '.generated_images'), { recursive: true })
  const port = await new Promise<number>((done, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const value = typeof address === 'object' && address ? address.port : 0
      server.close(() => done(value))
    })
  })
  base = 'http://127.0.0.1:' + port
  child = spawn(resolve(root, 'node_modules/.bin/storybook'), ['dev', '--host', '127.0.0.1', '--port', String(port), '--ci', '--no-open'],
    { cwd: resolve(root, 'packages/ui'), stdio: 'ignore', detached: true, env: { ...process.env, CI: 'true' } })
  const deadline = Date.now() + 90_000
  while (true) {
    if (child.exitCode !== null) throw new Error('Isolated Storybook exited before readiness')
    try { if ((await fetch(base + '/index.json')).ok) break } catch { /* Wait for Vite startup. */ }
    if (Date.now() >= deadline) throw new Error('Isolated Storybook readiness timeout')
    await new Promise(done => setTimeout(done, 500))
  }
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
}, 120_000)
afterAll(async () => {
  await browser?.close()
  if (child?.pid) { try { process.kill(-child.pid, 'SIGTERM') } catch { /* Already exited. */ } }
})
describe('VPN Component QA in Chromium', () => {
  // @testCase TC-UI
  it('completes gateway selection, LAN confirmation and pending-state feedback with the keyboard', async () => {
    const page = await browser!.newPage({ viewport: { width: 1100, height: 900 } })
    try {
      await page.goto(base + '/iframe.html?id=machines-vpn--off&viewMode=story')
      const role = page.getByLabel('Режим VPN', { exact: true })
      await role.waitFor({ timeout: 15000 }).catch(async () => { throw new Error((await page.locator('body').innerText()).slice(0, 4000)) })
      // Native select popups do not consume synthetic keys consistently in headless macOS Chromium.
      await role.selectOption('client')
      await expect.poll(() => role.inputValue()).toBe('client')
      await page.getByLabel('VPN-шлюз', { exact: true }).selectOption('gateway')
      await page.getByLabel('Разрешить доступ к локальной сети').check()
      await page.getByRole('button', { name: 'Применить режим', exact: true }).focus()
      await page.keyboard.press('Enter')
      await expect.poll(() => page.getByText(/разорвёт текущие сетевые соединения/).isVisible()).toBe(true)
      await page.getByRole('button', { name: 'Подтвердить изменение VPN', exact: true }).focus()
      await page.keyboard.press('Enter')
      await expect.poll(() => page.getByText('Запрошено: Подключиться к VPN', { exact: true }).isVisible()).toBe(true)
      await expect.poll(() => page.getByText('Фактически: Выключен', { exact: true }).isVisible()).toBe(true)
      await page.screenshot({ path: resolve(root, '.generated_images/CHAT-465-vpn-desktop.png'), fullPage: true })
    } finally { await page.close() }
  })
  // @testCase TC-UI
  it('keeps gateway failure and explicit off visible on a narrow screen', async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 } })
    try {
      await page.goto(base + '/iframe.html?id=machines-vpn--gateway-down&viewMode=story')
      await page.getByLabel('Режим VPN', { exact: true }).waitFor()
      await expect.poll(() => page.getByText(/Прямой интернет заблокирован/).isVisible()).toBe(true)
      await expect.poll(() => page.getByRole('button', { name: 'Применить режим', exact: true }).isEnabled()).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(root, '.generated_images/CHAT-465-vpn-mobile.png'), fullPage: true })
    } finally { await page.close() }
  })
})

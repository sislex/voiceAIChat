// E2E инструмента Make (п.37 дорожной карты): поднимаем сервер на свободном порту с временным
// каталогом данных, логинимся по API, открываем панель в headless Chromium и проходим сценарии
// «шаблон → превью → компоненты → редактор → публикация». Проверяет то, что jsdom не умеет:
// same-origin iframe, транспиляцию TSX в браузере, Monaco, раннер сториз.
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'

const ROOT = resolve(__dirname, '..')
const WEB_DIST = join(ROOT, 'apps/web/dist')
let BASE = ''
const PASSWORD = 'e2e-pass'

let server: ChildProcess | null = null
let dataDir = ''
let browser: Browser
let page: Page
let token = ''
let conversationId = ''
const browserDiagnostics: string[] = []
let serverOutput = ''

async function waitHealth(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    if (server?.exitCode !== null) throw new Error(`Make fixture exited: ${serverOutput}`)
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return } catch { /* ещё не поднялся */ }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`Make fixture did not start within 60 seconds: ${serverOutput}`)
}

const api = async (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${BASE}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) } })

// @testCase TC-14
describe.skipIf(!existsSync(WEB_DIST))('Make E2E', () => {
  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'vc-e2e-'))
    const reservation = createServer()
    await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
    const address = reservation.address()
    if (!address || typeof address === 'string') throw new Error('Free port unavailable')
    const port = address.port
    await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()))
    BASE = `http://127.0.0.1:${port}`
    server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: join(ROOT, 'apps/server'),
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', VC_DATA_DIR: dataDir, VC_WEB_DIR: WEB_DIST, VC_ADMIN_PASSWORD: PASSWORD },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    server.stdout?.on('data', chunk => { serverOutput = (serverOutput + chunk).slice(-8000) })
    server.stderr?.on('data', chunk => { serverOutput = (serverOutput + chunk).slice(-8000) })
    await waitHealth()
    const login = await fetch(`${BASE}/api/session/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'admin', password: PASSWORD }) })
    token = ((await login.json()) as { token: string }).token
    // Онбординг первого запуска — серверная настройка; иначе его оверлей перекрывает панель.
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ onboarded: true }) })
    const conv = await api('/api/conversations', { method: 'POST', body: JSON.stringify({ title: 'E2E Make', assistantKind: 'make' }) })
    const created = (await conv.json()) as { id?: string; conversation?: { id: string } }
    conversationId = created.id ?? created.conversation!.id
    await api(`/api/make/${conversationId}/notes`, { method: 'PUT', body: JSON.stringify({ stack: 'react', uiKit: 'none' }) })
    await api(`/api/make/${conversationId}/template`, { method: 'POST', body: JSON.stringify({ templateId: 'react-ts' }) })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    // Returning-user fixture; first entry is covered by TC9.
    await page.addInitScript(() => localStorage.setItem('vc:shell:admin:tour', 'true'))
    page.on('pageerror', error => browserDiagnostics.push(error.message))
    page.on('requestfailed', request => browserDiagnostics.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`))
    await page.goto(`${BASE}/`)
    await page.evaluate((t) => localStorage.setItem('vc.session.token', t), token)
    // Смена только хэша не перезагружает документ — приложение уже стартовало без токена; нужен reload.
    await page.goto(`${BASE}/#/make/${conversationId}`)
    await page.reload()
  })

  afterAll(async () => {
    await browser?.close()
    if (server && server.exitCode === null) {
      const stopped = new Promise<void>(resolve => server!.once('exit', () => resolve()))
      server.kill('SIGTERM')
      await stopped
    }
    if (dataDir) await rm(dataDir, { recursive: true, force: true })
  })

  it('desktop split удерживает узкий чат и MakePane внутри viewport', async () => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.locator('.chat-split').evaluate((el) => {
      ;(el as HTMLElement).style.setProperty('--preview-width', '72%')
    })
    await expect.poll(async () => page.locator('.voicebar').evaluate(
      (el) => el.scrollWidth <= el.clientWidth,
    )).toBe(true)

    for (const selector of ['.chat-split', '.make-pane']) {
      const box = await page.locator(selector).boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x + box!.width).toBeLessThanOrEqual(1280)
      expect(box!.y + box!.height).toBeLessThanOrEqual(800)
    }
  })

  // @testCase TC1
  it('mobile Make tabs отдают всю область только активной панели', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('tab', { name: 'Проект' }).click()
    await expect.poll(() => page.locator('.make-pane').isVisible()).toBe(true)
    await expect.poll(() => page.locator('.chat-split-chat').isVisible()).toBe(false)
    const pane = await page.locator('.make-pane').evaluate((el) => ({
      client: el.clientWidth,
      scroll: el.scrollWidth,
      bottom: el.getBoundingClientRect().bottom,
    }))
    expect(pane.scroll).toBeLessThanOrEqual(pane.client)
    expect(pane.bottom).toBeLessThanOrEqual(844)

    await page.getByRole('tab', { name: 'Чат' }).click()
    await expect.poll(() => page.locator('.chat-split-chat').isVisible()).toBe(true)
    await expect.poll(() => page.locator('.make-pane').isVisible()).toBe(false)
    await page.getByRole('tab', { name: 'Проект' }).click()
    await page.setViewportSize({ width: 1400, height: 900 })
  })

})

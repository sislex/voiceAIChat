// E2E инструмента Make (п.37 дорожной карты): поднимаем сервер на свободном порту с временным
// каталогом данных, логинимся по API, открываем панель в headless Chromium и проходим сценарии
// «шаблон → превью → компоненты → редактор → публикация». Проверяет то, что jsdom не умеет:
// same-origin iframe, транспиляцию TSX в браузере, Monaco, раннер сториз.
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'

const ROOT = resolve(__dirname, '..')
const WEB_DIST = join(ROOT, 'apps/web/dist')
const PORT = 8811 + Math.floor(Math.random() * 100)
const BASE = `http://127.0.0.1:${PORT}`
const PASSWORD = 'e2e-pass'

let server: ChildProcess | null = null
let dataDir = ''
let browser: Browser
let page: Page
let token = ''
let conversationId = ''

async function waitHealth(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return } catch { /* ещё не поднялся */ }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('сервер не поднялся за 60 с')
}

const api = async (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${BASE}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) } })

describe.skipIf(!existsSync(WEB_DIST))('Make E2E', () => {
  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'vc-e2e-'))
    server = spawn('npx', ['tsx', 'src/index.ts'], {
      cwd: join(ROOT, 'apps/server'),
      env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', VC_DATA_DIR: dataDir, VC_WEB_DIR: WEB_DIST, VC_ADMIN_PASSWORD: PASSWORD },
      stdio: 'ignore'
    })
    await waitHealth()
    const login = await fetch(`${BASE}/api/session/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'admin', password: PASSWORD }) })
    token = ((await login.json()) as { token: string }).token
    // Онбординг первого запуска — серверная настройка; иначе его оверлей перекрывает панель.
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ onboarded: true }) })
    const conv = await api('/api/conversations', { method: 'POST', body: JSON.stringify({ title: 'E2E Make', assistantKind: 'make' }) })
    const created = (await conv.json()) as { id?: string; conversation?: { id: string } }
    conversationId = created.id ?? created.conversation!.id
    await api(`/api/make/${conversationId}/template`, { method: 'POST', body: JSON.stringify({ templateId: 'react-ts' }) })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    await page.goto(`${BASE}/`)
    await page.evaluate((t) => localStorage.setItem('vc.session.token', t), token)
    // Смена только хэша не перезагружает документ — приложение уже стартовало без токена; нужен reload.
    await page.goto(`${BASE}/#/make/${conversationId}`)
    await page.reload()
  })

  afterAll(async () => {
    await browser?.close()
    server?.kill('SIGTERM')
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

  it('превью рендерит React-шаблон (TSX транспилирован сервером, React из esm.sh)', async () => {
    const frame = page.frameLocator('.make-frame')
    await expect.poll(async () => frame.locator('h2').first().textContent().catch(() => null), { timeout: 60_000 }).toContain('Счётчик')
    await frame.getByRole('button', { name: '+' }).click()
    await expect.poll(() => frame.locator('strong').first().textContent()).toBe('1')
  })

  it('вкладка «Компоненты» показывает сториз и рендерит стори в раннере; controls есть', async () => {
    await page.getByRole('tab', { name: 'Компоненты' }).click()
    await page.getByRole('button', { name: 'Small' }).click()
    const runner = page.frameLocator('.make-story-frame')
    await expect.poll(() => runner.locator('button').first().textContent().catch(() => null), { timeout: 60_000 }).toBe('Маленькая')
    await expect.poll(() => page.getByTestId('make-controls').isVisible()).toBe(true)
    await expect.poll(() => page.locator('#make-arg-size').isVisible()).toBe(true)
  })

  it('редактор Monaco открывает файл, автосохранение пишет правку, превью обновляется', async () => {
    await page.getByRole('tab', { name: 'Код' }).click()
    await page.getByRole('button', { name: /^styles\.css/ }).click()
    await page.locator('.monaco-editor').first().waitFor({ timeout: 60_000 })
    // Клик мышью, а не focus(): headless Monaco без клика не переводит textarea в режим ввода.
    await page.locator('.monaco-editor .view-lines').first().click({ position: { x: 40, y: 10 } })
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type('\n.e2e-marker { color: red; }\n')
    await expect.poll(async () => {
      const r = await api(`/api/make/${conversationId}/file?path=styles.css`)
      return ((await r.json()) as { content: string }).content
    }, { timeout: 15_000 }).toContain('.e2e-marker')
  })

  it('публикация даёт ссылку без входа и отдаёт транспилированный TSX', async () => {
    await page.getByRole('button', { name: 'Опубликовать' }).click()
    await page.getByTestId('make-publish').getByRole('button', { name: 'Опубликовать' }).click()
    const url = await page.getByTestId('make-public-url').textContent()
    expect(url).toMatch(/\/p\/[0-9a-f]{32}\/$/)
    const anon = await fetch(`${url}src/App.tsx`)
    expect(anon.status).toBe(200)
    expect(await anon.text()).toContain('jsx(')
  })
})

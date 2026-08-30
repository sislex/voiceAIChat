// E2E сохранности настроек в реальном Chromium: то, ради чего всё затевалось —
// пересборка релиза не должна сбрасывать выбор человека.
//
// jsdom-тесты проверяют стор и адаптеры по отдельности; здесь проверяется
// связка целиком на живом сервере: настройка сохраняется, падение сервера не
// превращает её в дефолт, а вернувшийся сервер подхватывается сам, без
// перезагрузки страницы.
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'

const ROOT = resolve(__dirname, '..')
const WEB_DIST = join(ROOT, 'apps/web/dist')
const PORT = 8991 + Math.floor(Math.random() * 60)
const BASE = `http://127.0.0.1:${PORT}`
const PASSWORD = 'e2e-settings-pass'

let server: ChildProcess | null = null
let dataDir = ''
let browser: Browser
let page: Page
let token = ''

function startServer(): ChildProcess {
  return spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: join(ROOT, 'apps/server'),
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', VC_DATA_DIR: dataDir, VC_WEB_DIR: WEB_DIST, VC_ADMIN_PASSWORD: PASSWORD },
    stdio: 'ignore'
  })
}

async function waitHealth(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return } catch { /* ещё не поднялся */ }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('сервер не поднялся за 60 с')
}

/** Сервер ушёл в перезапуск: ждём, пока порт действительно замолчит. */
async function waitDown(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try { await fetch(`${BASE}/api/health`) } catch { return }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('сервер не остановился')
}

const api = async (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${BASE}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) } })

const savedTheme = async (): Promise<string> => ((await (await api('/api/settings')).json()) as { theme: string }).theme

/** Меню аккаунта → «Настройки» → раздел «Интерфейс». */
async function openInterfaceSettings(): Promise<void> {
  if (!(await page.getByTestId('overlay').isVisible().catch(() => false))) {
    // Кнопка меню подписана ролью пользователя; ждём её появления — сразу
    // после загрузки страница ещё проверяет сессию.
    const account = page.getByRole('button', { name: new RegExp('admin') })
    await account.waitFor({ state: 'visible', timeout: 30_000 })
    await account.click()
    await page.getByRole('menuitem', { name: 'Настройки' }).click()
  }
  await page.getByRole('button', { name: 'Интерфейс' }).click()
}

describe.skipIf(!existsSync(WEB_DIST))('Настройки E2E: релиз не сбрасывает выбор', () => {
  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'vc-e2e-settings-'))
    server = startServer()
    await waitHealth()
    const login = await fetch(`${BASE}/api/session/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'admin', password: PASSWORD }) })
    token = ((await login.json()) as { token: string }).token
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ onboarded: true }) })

    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    await page.goto(`${BASE}/`)
    await page.evaluate((t) => localStorage.setItem('vc.session.token', t), token)
    await page.reload()
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    server?.kill('SIGTERM')
    if (dataDir) await rm(dataDir, { recursive: true, force: true })
  })

  it('выбор темы доезжает до сервера и переживает перезагрузку', async () => {
    await openInterfaceSettings()
    await page.getByLabel('Тема интерфейса').selectOption('dark')

    await expect.poll(savedTheme, { timeout: 10_000 }).toBe('dark')
    await page.reload()
    await expect.poll(() => page.locator('html').getAttribute('data-theme'), { timeout: 10_000 }).toBe('dark')
  }, 60_000)

  it('падение сервера не превращает настройки в дефолты, а возвращение подхватывается само', async () => {
    // Окно настроек открыто ДО деплоя — это и есть проверяемый сценарий:
    // человек работает, а сервер под ним уходит в перезапуск.
    await openInterfaceSettings()
    server?.kill('SIGTERM')
    await waitDown()

    // Изменение не сохранится, но и не сотрёт запись — экран откатывает выбор.
    await page.getByLabel('Тема интерфейса').selectOption('green').catch(() => {})
    await expect.poll(() => page.locator('html').getAttribute('data-theme'), { timeout: 10_000 }).toBe('dark')

    server = startServer()
    await waitHealth()
    expect(await savedTheme()).toBe('dark') // запись на сервере цела

    // Пока вкладка была открыта, тему сменили «с другого устройства».
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ theme: 'green' }) })
    // Вкладку не трогаем и не перезагружаем: её должен догнать реконнект WS.
    await expect.poll(() => page.locator('html').getAttribute('data-theme'), { timeout: 60_000 }).toBe('green')
  }, 180_000)
})

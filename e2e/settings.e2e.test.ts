// E2E сохранности настроек в реальном Chromium: то, ради чего всё затевалось —
// пересборка релиза не должна сбрасывать выбор человека.
//
// jsdom-тесты проверяют стор и адаптеры по отдельности; здесь проверяется
// связка целиком на живом сервере: настройка сохраняется, падение сервера не
// превращает её в дефолт, а вернувшийся сервер подхватывается сам, без
// перезагрузки страницы.
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, _electron, type Browser, type Page } from 'playwright'

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
  return spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
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

describe('Настройки E2E: релиз не сбрасывает выбор', () => {
  beforeAll(async () => {
    if (!existsSync(WEB_DIST)) throw new Error('Build apps/web before running required settings/onboarding E2E')
    dataDir = await mkdtemp(join(tmpdir(), 'vc-e2e-settings-'))
    server = startServer()
    await waitHealth()
    const login = await fetch(`${BASE}/api/session/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'admin', password: PASSWORD }) })
    token = ((await login.json()) as { token: string }).token
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ onboarded: true }) })

    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    // Returning-user fixture; first entry is covered by TC9.
    await page.addInitScript(() => localStorage.setItem('vc:shell:admin:tour', 'true'))
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
    await page.context().setOffline(true)
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
    await page.context().setOffline(false)
    // Вкладку не трогаем и не перезагружаем: её должен догнать реконнект WS.
    await expect.poll(() => page.locator('html').getAttribute('data-theme'), { timeout: 60_000 }).toBe('green')
  }, 180_000)

  // @testCase TC-UI-1
  it('keeps onboarding navigation and actions reachable across themes, touch and keyboard', async () => {
    const artifacts = join(ROOT, 'artifacts/onboarding')
    await mkdir(artifacts, { recursive: true })
    const sizes = [[1440, 900], [1280, 720], [768, 1024], [390, 844], [320, 700]]
    for (const theme of ['light', 'dark']) for (const [width, height] of sizes) {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify({ theme, onboarded: true }) })
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: true })
      const screen = await context.newPage()
      try {
        await screen.addInitScript((sessionToken) => {
          localStorage.setItem('vc.session.token', sessionToken)
          localStorage.setItem('vc:shell:admin:tour', 'true')
          navigator.mediaDevices.getUserMedia = async () => { throw new Error('Unexpected permission request') }
        }, token)
        const cdp = await context.newCDPSession(screen)
        await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 24, bottom: 34, left: 0, right: 0 } })
        await screen.goto(BASE + '/#/settings/ui')
        await screen.getByRole('button', { name: 'Мастер первого запуска' }).click()
        const dialog = screen.getByRole('dialog', { name: 'Добро пожаловать', exact: true })
        await dialog.waitFor()
        if (width <= 720) expect((await dialog.getByRole('button', { name: 'Закрыть', exact: true }).boundingBox())!.y).toBeGreaterThanOrEqual(24)
        await screen.getByRole('button', { name: /2\. Озвучка TTS/ }).tap()
        await screen.getByRole('button', { name: 'Пропустить шаг' }).click()
        await screen.keyboard.press('Tab')
        expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
        expect(await screen.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        const exit = screen.getByRole('button', { name: 'Продолжить в чате' })
        await exit.scrollIntoViewIfNeeded()
        expect(await exit.evaluate(el => Number.parseFloat(getComputedStyle(el.parentElement!).paddingBottom))).toBe(34)
        const box = await exit.boundingBox()
        expect(box).not.toBeNull()
        expect(box!.y + box!.height).toBeLessThanOrEqual(height)
        await screen.screenshot({ path: join(artifacts, theme + '-' + width + 'x' + height + '.png') })
        // Reduced visual viewport models keyboard occlusion; this is not a physical OS keyboard test.
        if (width <= 390) {
          await screen.setViewportSize({ width, height: Math.floor(height * 0.6) })
          await exit.scrollIntoViewIfNeeded()
          const reduced = await exit.boundingBox()
          expect(reduced!.y + reduced!.height).toBeLessThanOrEqual(Math.floor(height * 0.6))
          await screen.screenshot({ path: join(artifacts, theme + '-' + width + '-reduced-viewport.png') })
        }
        await exit.focus()
        await screen.keyboard.press('Escape')
        await dialog.waitFor({ state: 'hidden' })
      } catch (error) {
        await screen.screenshot({ path: join(artifacts, theme + '-' + width + '-failure.png') })
        throw error
      } finally { await context.close() }
    }
  }, 180_000)

  // @testCase TC-HOST-1
  it('runs the shared renderer in Electron with persisted progress and an explicit voice check', async () => {
    const executablePath = createRequire(join(ROOT, 'package.json'))('electron') as string
    if (!existsSync(executablePath)) throw new Error('Install Core integration dependencies before required Electron QA')
    await mkdir(join(ROOT, 'artifacts/onboarding'), { recursive: true })
    const entry = join(dataDir, 'onboarding-electron.cjs')
    await writeFile(entry, [
      "const { app, BrowserWindow, session } = require('electron')",
      "app.setPath('userData', " + JSON.stringify(join(dataDir, 'electron-state')) + ")",
      "app.whenReady().then(() => {",
      "session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))",
      "new BrowserWindow({ width: 390, height: 844, webPreferences: { sandbox: true, contextIsolation: true } }).loadURL(" + JSON.stringify(BASE + '/#/settings/ui') + ")",
      "})"
    ].join('\n'))
    const display = ':' + (190 + Math.floor(Math.random() * 1000))
    const xvfb = process.platform === 'linux' && !process.env.DISPLAY
      ? spawn('Xvfb', [display, '-screen', '0', '1440x900x24', '-nolisten', 'tcp'], { stdio: 'ignore' })
      : null
    let desktop: Awaited<ReturnType<typeof _electron.launch>> | null = null
    try {
      if (xvfb) await expect.poll(() => existsSync('/tmp/.X11-unix/X' + display.slice(1)), { timeout: 10_000 }).toBe(true)
      desktop = await _electron.launch({ executablePath, args: ['--no-sandbox', entry], env: { ...process.env, ...(xvfb ? { DISPLAY: display } : {}) } })
      const renderer = await desktop.firstWindow()
      await renderer.waitForLoadState('domcontentloaded')
      await renderer.evaluate(t => {
        localStorage.setItem('vc.session.token', t)
        localStorage.setItem('vc:shell:admin:tour', 'true')
      }, token)
      await renderer.reload()
      await renderer.getByRole('button', { name: 'Мастер первого запуска' }).click()
      await renderer.getByRole('button', { name: /1\. Микрофон/ }).click()
      await renderer.getByRole('button', { name: 'Проверить / повторить' }).click()
      await renderer.getByText(/Ошибка: Проверка не завершилась/).waitFor()
      await renderer.getByRole('button', { name: 'Пропустить шаг' }).click()
      await renderer.getByRole('button', { name: 'Продолжить в чате' }).click()
      await renderer.goto(BASE + '/#/settings/ui')
      await renderer.getByRole('button', { name: 'Мастер первого запуска' }).click()
      await renderer.getByText(/Пропущено: Пропущено пользователем/).waitFor()
      await renderer.screenshot({ path: join(ROOT, 'artifacts/onboarding/electron-resumed.png') })
      await renderer.reload()
      await renderer.goto(BASE + '/#/settings/ui')
      await renderer.getByRole('button', { name: 'Мастер первого запуска' }).click()
      await renderer.getByText(/Пропущено: Пропущено пользователем/).waitFor()
    } finally {
      await desktop?.close()
      xvfb?.kill('SIGTERM')
    }
  }, 120_000)

  // @testCase TC-STATE-1
  // @testCase TC-REG-1
  it('persists onboarding across server restart and resets only its state', async () => {
    const progress = {
      version: 1, current: 'machine',
      results: Object.fromEntries(['microphone', 'tts', 'llm', 'machine', 'voice'].map(step =>
        [step, { status: step === 'tts' ? 'success' : step === 'machine' ? 'checking' : 'skipped', diagnostic: '' }]))
    }
    const before = await (await api('/api/settings')).json()
    expect((await api('/api/settings', { method: 'PUT', body: JSON.stringify({ onboarding: progress }) })).ok).toBe(true)
    server?.kill('SIGTERM')
    await waitDown()
    server = startServer()
    await waitHealth()
    expect((await (await api('/api/settings')).json()).onboarding).toEqual(progress)
    await page.reload()
    await page.goto(BASE + '/#/settings/ui')
    await page.getByRole('button', { name: 'Мастер первого запуска' }).click()
    await page.getByText(/Проверка прервана/).waitFor()
    await page.getByRole('button', { name: 'Сбросить только прогресс' }).click()
    await expect.poll(async () => (await (await api('/api/settings')).json()).onboarding.results.tts.status).toBe('idle')
    const after = await (await api('/api/settings')).json()
    expect(after.theme).toBe(before.theme)
    expect(after.voice).toBe(before.voice)
    expect(after.llmProvider).toBe(before.llmProvider)
    await page.getByRole('button', { name: 'Продолжить в чате' }).click()
  }, 120_000)

})

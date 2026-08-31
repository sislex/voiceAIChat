// E2E панели кода в реальном Chromium: вкладка «Код» страницы проекта, её маршрут и
// список рабочих копий.
//
// Чего этот тест не делает и почему: полный цикл «правка → коммит → push» требует живой
// машины-агента с git на ней, а поднять её в прогоне нельзя. Поэтому здесь проверяется
// то, чего не видят jsdom-тесты: сборка страницы целиком, маршрут с id рабочей копии в
// адресе, гейт возможностей типа проекта и мобильная раскладка. Сама работа с git
// покрыта тестами сервиса (`apps/server/src/git`) и панели (`packages/ui/src/components/git`).
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'

const ROOT = resolve(__dirname, '..')
const WEB_DIST = join(ROOT, 'apps/web/dist')
const PORT = 9011 + Math.floor(Math.random() * 80)
const BASE = `http://127.0.0.1:${PORT}`
const PASSWORD = 'e2e-pass'

let server: ChildProcess | null = null
let dataDir = ''
let browser: Browser
let page: Page
let token = ''
let projectId = ''

async function waitHealth(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return } catch { /* ещё не поднялся */ }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('сервер не поднялся за 60 с')
}

const api = async (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${BASE}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) } })

describe.skipIf(!existsSync(WEB_DIST))('Панель кода E2E', () => {
  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'vc-e2e-git-'))
    server = spawn('npx', ['tsx', 'src/index.ts'], {
      cwd: join(ROOT, 'apps/server'),
      env: {
        ...process.env,
        PORT: String(PORT), HOST: '127.0.0.1', VC_DATA_DIR: dataDir, VC_WEB_DIR: WEB_DIST,
        VC_ADMIN_PASSWORD: PASSWORD, VC_PUBLIC_URL: BASE
      },
      stdio: 'ignore'
    })
    await waitHealth()
    const login = await fetch(`${BASE}/api/session/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'admin', password: PASSWORD })
    })
    token = ((await login.json()) as { token: string }).token
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ onboarded: true }) })
    const project = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Панель кода' }) })
    projectId = ((await project.json()) as { id: string }).id

    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    await page.goto(`${BASE}/`)
    await page.evaluate((t) => localStorage.setItem('vc.session.token', t), token)
    // Токен читается при загрузке приложения: без перезагрузки страница осталась бы
    // на экране входа, и любой переход по хешу ничего бы не показал.
    await page.goto(`${BASE}/#/projects`)
    await page.reload()
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    server?.kill('SIGTERM')
    if (dataDir) await rm(dataDir, { recursive: true, force: true })
  })

  it('вкладка «Код» есть у проекта с git и ведёт на свой маршрут', async () => {
    await page.goto(`${BASE}/#/projects/${projectId}`)
    const tab = page.getByRole('tab', { name: 'Код' })
    await tab.waitFor({ state: 'visible', timeout: 30_000 })
    await tab.click()
    await page.waitForFunction(() => window.location.hash.endsWith('/code'), null, { timeout: 15_000 })
    expect(page.url()).toContain(`#/projects/${projectId}/code`)
  })

  it('без ранов список рабочих копий объясняет, откуда они появятся', async () => {
    await page.goto(`${BASE}/#/projects/${projectId}/code`)
    const list = page.getByTestId('git-workspace-list')
    await list.waitFor({ state: 'visible', timeout: 30_000 })
    // Матчеров playwright/test здесь нет (прогон на vitest) — сравниваем текст.
    const text = (await list.textContent()) ?? ''
    expect(text).toContain('Рабочих копий пока нет')
    expect(text).toContain('ран задачи клонирует репозиторий')
  })

  it('прямая ссылка на рабочую копию открывает панель и честно сообщает, что копии нет', async () => {
    // Адрес с id копии — часть контракта маршрута: по нему дают ссылку из ленты рана.
    await page.goto(`${BASE}/#/projects/${projectId}/code/ws%3Aмиссинг`)
    const pane = page.getByTestId('git-pane')
    await pane.waitFor({ state: 'visible', timeout: 30_000 })
    // Сначала виден скелетон: ответ сервера приходит позже, поэтому ждём текст.
    // Сначала виден скелетон: ответ сервера приходит позже, поэтому ждём текст.
    // Проверяем именно человеческую формулировку — техническому коду
    // (`workspace_not_found`) в интерфейсе места нет.
    await expect.poll(async () => (await pane.textContent()) ?? '', { timeout: 30_000 })
      .toContain('Рабочая копия не найдена')
  })

  it('на телефоне страница остаётся одной колонкой без горизонтальной прокрутки', async () => {
    const phone = await browser.newPage({ viewport: { width: 390, height: 780 } })
    try {
      await phone.goto(`${BASE}/`)
      await phone.evaluate((t) => localStorage.setItem('vc.session.token', t), token)
      await phone.goto(`${BASE}/#/projects/${projectId}/code`)
      await phone.reload()
      await phone.getByTestId('git-workspace-list').waitFor({ state: 'visible', timeout: 30_000 })
      const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(1)
    } finally {
      await phone.close()
    }
  })
})

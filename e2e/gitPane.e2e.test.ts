// E2E панели кода в реальном Chromium: вкладка «Код» страницы проекта, её маршрут и
// список рабочих копий.
//
// Чего этот тест не делает и почему: полный цикл «правка → коммит → push» требует живой
// машины-агента с git на ней, а поднять её в прогоне нельзя. Поэтому здесь проверяется
// то, чего не видят jsdom-тесты: сборка страницы целиком, маршрут с id рабочей копии в
// адресе, гейт возможностей типа проекта и мобильная раскладка. Сама работа с git
// покрыта тестами сервиса (`apps/server/src/git`) и панели (`packages/ui/src/components/git`).
//
// Страница проекта рисуется данными канбана, поэтому сьют идёт на стенде «ядро + канбан»
// (`kanbanStand.ts`) и пропускается, если стенд поднять нельзя.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { kanbanStandUnavailable, startKanbanStand, type KanbanStand } from './kanbanStand'

const PASSWORD = 'e2e-pass'
const unavailable = kanbanStandUnavailable()
if (unavailable) console.warn(`[gitPane e2e] пропущен: ${unavailable}`)
let BASE = ''
let stand: KanbanStand | null = null
let browser: Browser
let page: Page
let token = ''
let projectId = ''

const api = async (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${BASE}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) } })

describe.skipIf(unavailable !== null)('Панель кода E2E', () => {
  beforeAll(async () => {
    stand = await startKanbanStand({ adminPassword: PASSWORD })
    BASE = stand.base
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
    // Returning-user fixture; first entry is covered by TC9.
    await page.addInitScript(() => localStorage.setItem('vc:shell:admin:tour', 'true'))
    await page.goto(`${BASE}/`)
    await page.evaluate((t) => localStorage.setItem('vc.session.token', t), token)
    // Токен читается при загрузке приложения: без перезагрузки страница осталась бы
    // на экране входа, и любой переход по хешу ничего бы не показал.
    await page.goto(`${BASE}/#/projects`)
    await page.reload()
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await stand?.stop()
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
    // Матчеров playwright/test здесь нет (прогон на vitest) — ждём текст: сначала виден скелетон,
    // а список рабочих копий ядро отдаёт после ответа канбана о проекте.
    await expect.poll(async () => (await list.textContent()) ?? '', { timeout: 30_000 }).toContain('Рабочих копий пока нет')
    expect((await list.textContent()) ?? '').toContain('ран задачи клонирует репозиторий')
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
      await phone.evaluate((t) => { localStorage.setItem('vc.session.token', t); localStorage.setItem('vc:shell:admin:tour', 'true') }, token)
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

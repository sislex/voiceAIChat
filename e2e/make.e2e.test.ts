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
const browserDiagnostics: string[] = []

async function waitHealth(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return } catch { /* ещё не поднялся */ }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('сервер не поднялся за 60 с')
}

const api = async (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${BASE}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) } })

// @testCase TC-14
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
    await api(`/api/make/${conversationId}/notes`, { method: 'PUT', body: JSON.stringify({ stack: 'react', uiKit: 'none' }) })
    await api(`/api/make/${conversationId}/template`, { method: 'POST', body: JSON.stringify({ templateId: 'react-ts' }) })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
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

  // @testCase TC-07
  it('Angular standalone JIT загружается в same-origin iframe', async () => {
    expect((await api(`/api/make/${conversationId}/notes`, { method: 'PUT', body: JSON.stringify({ stack: 'angular', uiKit: 'none' }) })).ok).toBe(true)
    expect((await api(`/api/make/${conversationId}/template`, { method: 'POST', body: JSON.stringify({ templateId: 'angular' }) })).ok).toBe(true)
    await page.goto(`${BASE}/#/make/${conversationId}`)
    await page.reload()
    await page.getByRole('tab', { name: 'Превью', exact: true }).click()
    const frame = page.frameLocator('.make-frame')
    try { await expect.poll(() => frame.locator('h1').textContent().catch(() => null), { timeout: 60_000 }).toBe('Angular работает') } catch (error) { console.error('Angular browser diagnostics', browserDiagnostics); throw error }
  })

  it('switches Make and Monaco controls between English and Russian while preserving an editor draft', async () => {
    await page.getByRole('combobox', { name: 'Язык интерфейса Make' }).selectOption('en')
    await page.getByRole('tab', { name: 'Code', exact: true }).click()
    await page.getByRole('button', { name: /^styles\.css/ }).click()
    const editor = page.locator('.make-pane .monaco-editor').first()
    await editor.waitFor({ timeout: 60_000 })
    await page.getByRole('checkbox', { name: 'autosave', exact: true }).uncheck()
    const before = await editor.elementHandle()
    await editor.locator('.view-lines').click({ position: { x: 40, y: 10 } })
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type('\n.locale-draft { color: blue; }\n')
    await page.keyboard.press('ControlOrMeta+f')
    await expect.poll(() => editor.getByPlaceholder('Find', { exact: true }).isVisible()).toBe(true)
    await expect.poll(async () => {
      const input = await editor.getByPlaceholder('Find', { exact: true }).boundingBox()
      const bounds = await editor.boundingBox()
      return Boolean(input && bounds && input.y >= bounds.y && input.x + input.width <= bounds.x + bounds.width)
    }).toBe(true)
    expect(await page.locator('.make-editor-head').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
    await page.screenshot({ animations: 'disabled', path: join(tmpdir(), 'make-localization-en.png') })
    await page.getByRole('combobox', { name: 'Make interface language' }).selectOption('ru')
    await expect.poll(() => editor.getByPlaceholder('Найти', { exact: true }).isVisible()).toBe(true)
    expect(await editor.evaluate((node, original) => node === original, before)).toBe(true)
    expect(await editor.locator('.view-lines').textContent()).toContain('.locale-draft')
    expect(await page.locator('.make-editor-head').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
    await page.screenshot({ animations: 'disabled', path: join(tmpdir(), 'make-localization-ru.png') })
    await editor.getByPlaceholder('Найти', { exact: true }).press('Escape')
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect.poll(async () => ((await (await api(`/api/make/${conversationId}/file?path=styles.css`)).json()) as { content: string }).content).toContain('.locale-draft')
    await page.getByRole('combobox', { name: 'Язык интерфейса Make' }).selectOption('en')
    await page.reload()
    await expect.poll(() => page.getByRole('tab', { name: 'History', exact: true }).isVisible()).toBe(true)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('tab', { name: 'Проект', exact: true }).click()
    expect(await page.getByRole('combobox', { name: 'Make interface language' }).isVisible()).toBe(true)
    const dimensions = await page.getByTestId('make-pane').evaluate((node) => ({ client: node.clientWidth, scroll: node.scrollWidth }))
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client)
    await page.screenshot({ animations: 'disabled', path: join(tmpdir(), 'make-localization-mobile-en.png') })
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.getByRole('combobox', { name: 'Make interface language' }).selectOption('ru')
  })

  it('localizes the public password page and invalid-password feedback', async () => {
    const result = await api(`/api/make/${conversationId}/publish`, { method: 'POST', body: JSON.stringify({ password: 'locale-test-password', allowComments: true }) })
    expect(result.ok).toBe(true)
    const state = await result.json() as { published: { url: string } }
    const anonymous = await browser.newContext({ locale: 'en-US' })
    const visitor = await anonymous.newPage()
    const publicErrors: string[] = []
    visitor.on('pageerror', (error) => publicErrors.push(error.message))
    try {
      await visitor.goto(new URL(state.published.url, BASE).href + '?makeLocale=en')
      expect(await visitor.getByRole('heading', { name: 'This project is password-protected' }).isVisible()).toBe(true)
      await visitor.getByLabel('Project password', { exact: true }).fill('wrong-password')
      await visitor.getByRole('button', { name: 'Open', exact: true }).click()
      await expect.poll(() => visitor.getByText('Incorrect password. Try again.').isVisible()).toBe(true)
      await visitor.getByRole('combobox', { name: 'Interface language' }).selectOption('ru')
      try { await expect.poll(() => visitor.getByRole('heading', { name: 'Проект защищён паролем' }).isVisible()).toBe(true) } catch (error) { console.error({ url: visitor.url(), body: await visitor.locator('body').innerText(), publicErrors }); throw error }
      await visitor.getByLabel('Пароль проекта', { exact: true }).fill('locale-test-password')
      await visitor.getByRole('button', { name: 'Открыть', exact: true }).click()
      await visitor.locator('[data-vc-gc-open]').click()
      expect(await visitor.getByRole('button', { name: 'Отмена', exact: true }).isVisible()).toBe(true)
      await visitor.getByRole('combobox', { name: 'Язык интерфейса', exact: true }).selectOption('en')
      await expect.poll(() => visitor.locator('[data-vc-gc-form]').isVisible()).toBe(false)
      await visitor.locator('[data-vc-gc-open]').click()
      await visitor.getByPlaceholder('What should change, or what did you like?').fill('Localization browser check')
      await visitor.route('**/__comments__', (route) => route.abort())
      await visitor.getByRole('button', { name: 'Send', exact: true }).click()
      await expect.poll(() => visitor.locator('[data-vc-gc-status]').textContent()).toBe('Could not send the comment')
      await visitor.unroute('**/__comments__')
      await visitor.getByRole('button', { name: 'Send', exact: true }).click()
      await expect.poll(() => visitor.locator('[data-vc-gc-status]').textContent()).toContain('Thank you!')
      expect(publicErrors).toEqual([])
    } finally { await anonymous.close() }
  })
})

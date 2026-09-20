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
import jsQR from 'jsqr'

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

  // @testCase T1
  // @testCase T2
  // @testCase T3
  // @testCase T4
  // @testCase T6
  // @testCase T7
  it('completes the Make workspace flow at 390 px and verifies responsive boundaries', async () => {
    const created = await (await api('/api/conversations', { method: 'POST', body: JSON.stringify({ title: 'CHAT-454 mobile', assistantKind: 'make' }) })).json() as { id?: string; conversation?: { id: string } }
    const id = created.id ?? created.conversation!.id
    const source = '<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>body{background:rgb(255,255,255);color:black} @media (prefers-color-scheme: dark){body{background:rgb(0,0,0);color:white}} @supports(display:grid){@media (min-width:1000px) and (prefers-color-scheme:dark){body{color:rgb(255,0,0)}}}</style></head><body><h1>needle</h1></body></html>'
    expect((await api('/api/make/' + id + '/file', { method: 'PUT', body: JSON.stringify({ path: 'index.html', content: source }) })).ok).toBe(true)
    const mobileContext = await browser.newContext({ storageState: await page.context().storageState() })
    await mobileContext.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })
    const mobile = await mobileContext.newPage()
    await mobile.setViewportSize({ width: 390, height: 844 })
    const more = async (label: string): Promise<void> => {
      await mobile.locator('.make-pane').getByRole('button', { name: 'Ещё', exact: true }).click()
      await mobile.getByRole('button', { name: label, exact: true }).click()
    }
    const panels = () => mobile.getByRole('group', { name: 'Панели проекта' })
    const file = async (path: string): Promise<string> => ((await (await api('/api/make/' + id + '/file?path=' + encodeURIComponent(path))).json()) as { content: string }).content
    try {
      await mobile.goto(BASE + '/#/make/' + id)
      await mobile.getByRole('tab', { name: 'Проект', exact: true }).click()
      await panels().getByRole('button', { name: 'Файлы', exact: true }).click()
      const tree = mobile.getByRole('navigation', { name: 'Файлы проекта' })
      await tree.getByRole('button', { name: 'Создать папку', exact: true }).click()
      await mobile.getByRole('dialog').getByRole('textbox').fill('notes')
      await mobile.getByRole('dialog').getByRole('button', { name: 'Создать', exact: true }).click()
      await tree.getByRole('button', { name: 'Операции с файлами notes', exact: true }).click()
      await mobile.getByRole('menuitem', { name: 'Новый файл', exact: true }).click()
      await mobile.getByRole('dialog').getByRole('textbox').fill('notes/a.txt')
      await mobile.getByRole('dialog').getByRole('button', { name: 'Создать', exact: true }).click()
      const input = mobile.getByLabel('Содержимое notes/a.txt', { exact: true })
      await input.fill('needle needle')
      expect(await mobile.locator('.make-editor .monaco-editor').count()).toBe(0)
      expect(await mobile.locator('.make-highlight').isVisible()).toBe(true)
      await mobile.getByLabel('автосохранение', { exact: true }).uncheck()
      await panels().getByRole('button', { name: 'Файлы', exact: true }).click()
      await tree.getByRole('button', { name: 'Операции с файлами notes', exact: true }).click()
      await mobile.getByRole('menuitem', { name: 'Переименовать', exact: true }).click()
      await mobile.getByRole('dialog').getByRole('textbox').fill('moved')
      await mobile.getByRole('dialog').getByRole('button', { name: 'Переименовать', exact: true }).click()
      await panels().getByRole('button', { name: 'Код', exact: true }).click()
      await expect.poll(() => mobile.getByLabel('Содержимое moved/a.txt').inputValue()).toBe('needle needle')
      await mobile.getByRole('combobox', { name: 'Язык интерфейса Make' }).selectOption('en')
      expect(await mobile.getByLabel('Contents of moved/a.txt').inputValue()).toBe('needle needle')
      await mobile.getByRole('combobox', { name: 'Make interface language' }).selectOption('ru')
      await mobile.getByRole('button', { name: 'Сохранить', exact: true }).click()
      await expect.poll(() => file('moved/a.txt')).toBe('needle needle')
      await expect.poll(() => mobile.locator('.make-editor time').count()).toBe(1)

      await panels().getByRole('button', { name: 'Файлы', exact: true }).click()
      await mobile.getByRole('searchbox', { name: 'Поиск по файлам проекта' }).fill('needle')
      await mobile.getByRole('searchbox', { name: 'Поиск по файлам проекта' }).press('Enter')
      await mobile.getByRole('button', { name: 'Заменить по проекту' }).click()
      await mobile.getByLabel('Заменить на', { exact: true }).fill('replacement')
      expect(await mobile.getByRole('button', { name: 'Заменить все', exact: true }).isDisabled()).toBe(true)
      await mobile.getByRole('region', { name: 'moved/a.txt', exact: true }).getByRole('button', { name: 'Заменить это совпадение', exact: true }).nth(1).click()
      await mobile.getByTestId('make-replace-preview').waitFor()
      expect(await file('moved/a.txt')).toBe('needle needle')
      await mobile.getByTestId('make-replace').getByRole('button', { name: 'Заменить это совпадение', exact: true }).click()
      await mobile.getByRole('button', { name: 'Заменить', exact: true }).click()
      await expect.poll(() => file('moved/a.txt')).toBe('needle replacement')
      await panels().getByRole('button', { name: 'Файлы', exact: true }).click()
      await mobile.getByRole('button', { name: 'Предпросмотр', exact: true }).click()
      await mobile.getByTestId('make-replace-preview').waitFor()
      expect(await file('moved/a.txt')).toBe('needle replacement')
      await mobile.getByRole('button', { name: 'Заменить все', exact: true }).click()
      await mobile.getByRole('button', { name: 'Заменить', exact: true }).click()
      await expect.poll(() => file('moved/a.txt')).toBe('replacement replacement')

      const first = await (await api('/api/make/' + id + '/snapshots', { method: 'POST', body: JSON.stringify({ label: 'first mobile' }) })).json() as { snapshots: Array<{ id: string }> }
      await api('/api/make/' + id + '/file', { method: 'PUT', body: JSON.stringify({ path: 'moved/a.txt', content: 'second revision' }) })
      const second = await (await api('/api/make/' + id + '/snapshots', { method: 'POST', body: JSON.stringify({ label: 'second mobile' }) })).json() as { snapshots: Array<{ id: string }> }
      await mobile.reload()
      await mobile.getByRole('tab', { name: 'Проект', exact: true }).click()
      await mobile.getByRole('tab', { name: 'История', exact: true }).click()
      await mobile.getByLabel('Первый снимок', { exact: true }).selectOption(first.snapshots[0]!.id)
      await mobile.getByLabel('Второй снимок', { exact: true }).selectOption(second.snapshots[0]!.id)
      await mobile.getByRole('button', { name: 'Сравнить снимки', exact: true }).click()
      const row = mobile.getByTestId('make-pair-diff').locator('li').filter({ has: mobile.locator('code', { hasText: 'moved/a.txt' }) })
      await row.getByRole('button', { name: 'Первый снимок', exact: true }).click()
      const history = mobile.locator('.make-editor textarea')
      expect(await history.inputValue()).toBe('replacement replacement')
      expect(await history.getAttribute('readonly')).not.toBeNull()
      expect(await mobile.getByRole('button', { name: 'Сохранить', exact: true }).isDisabled()).toBe(true)
      expect(await mobile.locator('.make-highlight').isVisible()).toBe(true)
      await mobile.screenshot({ path: join(tmpdir(), 'chat454-history-390.png'), animations: 'disabled' })

      await panels().getByRole('button', { name: 'Превью', exact: true }).click()
      await mobile.getByRole('button', { name: 'Телефон', exact: true }).click()
      const frame = mobile.frameLocator('iframe[title="Превью проекта"]')
      await more('Тема превью')
      await expect.poll(() => frame.locator('body').evaluate((body) => getComputedStyle(body).backgroundColor)).toBe('rgb(0, 0, 0)')
      expect(await frame.locator('body').evaluate((body) => getComputedStyle(body).color)).toBe('rgb(255, 255, 255)')
      expect(await frame.locator('body').evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true)
      await more('Повернуть превью')
      expect(await mobile.locator('iframe[title="Превью проекта"]').evaluate((el) => (el as HTMLIFrameElement).contentWindow!.innerWidth)).toBe(844)
      await mobile.getByRole('button', { name: 'Планшет', exact: true }).click()
      expect(await mobile.locator('iframe[title="Превью проекта"]').evaluate((el) => (el as HTMLIFrameElement).contentWindow!.innerWidth)).toBe(768)
      await more('Свой размер')
      await mobile.getByRole('dialog').getByRole('textbox').fill('500 x 600')
      await mobile.getByRole('dialog').getByRole('button', { name: 'Применить', exact: true }).click()
      expect(await mobile.locator('iframe[title="Превью проекта"]').evaluate((el) => [(el as HTMLIFrameElement).contentWindow!.innerWidth, (el as HTMLIFrameElement).contentWindow!.innerHeight])).toEqual([500, 600])
      const separatePromise = mobile.waitForEvent('popup')
      await more('Открыть в новой вкладке')
      const separate = await separatePromise
      await separate.waitForLoadState()
      expect(separate.url()).toContain('makeScheme=dark')
      expect(await separate.locator('body').evaluate((body) => getComputedStyle(body).backgroundColor)).toBe('rgb(0, 0, 0)')
      await separate.close()
      for (const width of [720, 721, 390]) {
        await mobile.setViewportSize({ width, height: 844 })
        await expect.poll(() => panels().isVisible()).toBe(width <= 720)
      }
      const published = await (await api('/api/make/' + id + '/publish', { method: 'POST', body: '{}' })).json() as { published: { url: string } }
      await fetch(new URL(published.published.url, BASE), { headers: { referer: 'https://example.org/review' } })
      await mobile.reload()
      await mobile.getByRole('tab', { name: 'Проект', exact: true }).click()
      const requests: string[] = []
      mobile.on('request', (request) => requests.push(request.url()))
      await mobile.getByRole('button', { name: 'Опубликован', exact: true }).click()
      const qr = mobile.getByRole('img', { name: 'QR-код публикации' })
      await qr.waitFor()
      const pixels = await qr.evaluate(async (element) => {
        const image = element as HTMLImageElement
        await image.decode()
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
        const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0)
        return { width: canvas.width, height: canvas.height, data: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data) }
      })
      expect(jsQR(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height)?.data).toBe(new URL(published.published.url, BASE).href)
      await mobile.getByRole('button', { name: 'Копировать', exact: true }).click()
      expect(await mobile.evaluate(() => navigator.clipboard.readText())).toBe(new URL(published.published.url, BASE).href)
      expect(requests.filter((url) => /^https?:/.test(url) && !url.startsWith(BASE))).toEqual([])
      expect(await mobile.getByTestId('make-publish-stats').textContent()).toContain('example.org (1)')
      expect(await mobile.locator('.make-publish-bar').first().getAttribute('title')).toMatch(/: 1$/)
      const bounds = await mobile.getByTestId('make-pane').evaluate((node) => ({ width: node.clientWidth, scroll: node.scrollWidth }))
      expect(bounds.scroll).toBeLessThanOrEqual(bounds.width)
      await mobile.screenshot({ path: join(tmpdir(), 'chat454-make-390.png'), animations: 'disabled' })
      await mobile.getByTestId('make-publish-stats').scrollIntoViewIfNeeded()
      await mobile.screenshot({ path: join(tmpdir(), 'chat454-stats-390.png'), animations: 'disabled' })
    } finally { await mobileContext.close() }
  }, 120_000)

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

// Геометрия проверяется на настоящем App: jsdom не замечает неявную колонку
// CSS Grid, пересечение шапки с галереей и устаревшую высоту textarea.
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import sharp from 'sharp'

const ROOT = resolve(__dirname, '..')
const PASSWORD = 'image-studio-layout-test'
const artifacts = process.env.VC_VISUAL_ARTIFACTS
let server: ChildProcess | undefined
let browser: Browser | undefined
let page: Page
let dataDir = ''
let base = ''
let conversationId = ''
let sessionToken = ''

async function screenshot(name: string): Promise<void> {
  if (!artifacts) return
  await mkdir(artifacts, { recursive: true })
  await page.screenshot({ path: join(artifacts, `${name}.png`), animations: 'disabled' })
}

async function expectFullWidth(width: number): Promise<void> {
  await expect.poll(async () => {
    const box = await page.locator('.workshop-split').boundingBox()
    return !!box && Math.abs(box.x) < 1 && Math.abs(box.width - width) < 1
  }).toBe(true)
}

describe('Студия картинок: адаптивная раскладка', () => {
  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'vc-images-layout-'))
    const reservation = createServer()
    await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
    const address = reservation.address()
    if (!address || typeof address === 'string') throw new Error('Не удалось выбрать порт')
    const port = address.port
    await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()))
    base = `http://127.0.0.1:${port}`
    server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: join(ROOT, 'apps/server'),
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', VC_DATA_DIR: dataDir, VC_WEB_DIR: join(ROOT, 'apps/web/dist'), VC_ADMIN_PASSWORD: PASSWORD },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    server.stdout?.on('data', chunk => { output = (output + chunk).slice(-8000) })
    server.stderr?.on('data', chunk => { output = (output + chunk).slice(-8000) })
    await vi.waitFor(async () => {
      if (server?.exitCode !== null) throw new Error(`Сервер завершился: ${output}`)
      expect((await fetch(`${base}/api/health`)).ok).toBe(true)
    }, { timeout: 45_000, interval: 250 })
    const login = await fetch(`${base}/api/session/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'admin', password: PASSWORD })
    })
    expect(login.ok).toBe(true)
    const { token } = await login.json() as { token: string }
    sessionToken = token
    const api = async (path: string, method: string, body: unknown): Promise<Response> => {
      const response = await fetch(`${base}${path}`, {
        method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body)
      })
      expect(response.ok).toBe(true)
      return response
    }
    await api('/api/settings', 'PUT', { onboarded: true, theme: 'green' })
    const created = await (await api('/api/conversations', 'POST', { title: 'Студия — проверка', assistantKind: 'images' })).json() as { id?: string; conversation?: { id: string } }
    conversationId = created.id ?? created.conversation!.id
    const portrait = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="160"><rect width="200" height="160" fill="white"/><circle cx="100" cy="64" r="38" fill="#d39b78"/><rect x="62" y="102" width="76" height="54" rx="18" fill="#315d91"/></svg>').toString('base64')
    await api(`/api/image-studio/${conversationId}/file`, 'POST', { path: 'портрет.svg', dataBase64: portrait })
    await api(`/api/image-studio/${conversationId}/file`, 'POST', { path: 'портрет-2.svg', dataBase64: portrait, source: 'портрет.svg' })
    const raster = await sharp(Buffer.from(portrait, 'base64')).png().toBuffer()
    await api(`/api/image-studio/${conversationId}/file`, 'POST', { path: 'portrait.png', dataBase64: raster.toString('base64') })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 950 }, reducedMotion: 'reduce' })
    await page.addInitScript(() => {
      const NativeWebSocket = window.WebSocket
      const sockets: WebSocket[] = []
      Object.assign(window, { shellTestSockets: sockets })
      window.WebSocket = class extends NativeWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); sockets.push(this) }
      }
    })
    await page.addInitScript(token => {
      localStorage.setItem('vc.session.token', token)
      // This suite represents a returning user; tour completion is tested separately.
      localStorage.setItem('vc:shell:admin:tour', 'true')
    }, token)
    await page.goto(`${base}/#/images/${conversationId}`)
    await page.getByRole('textbox', { name: 'Промпт для изображения' }).waitFor()
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

  // @testCase TC4
  it('applies the saved system scheme before the first App content appears', async () => {
    const response = await fetch(`${base}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${sessionToken}` }, body: JSON.stringify({ theme: 'system' }) })
    expect(response.ok).toBe(true)
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.evaluate(() => { localStorage.setItem('vc.theme', 'system'); localStorage.setItem('vc.theme.admin', 'system') })
    await page.addInitScript(() => {
      new MutationObserver((_, observer) => {
        if (document.querySelector('#root .app')) {
          document.documentElement.dataset.firstAppTheme = document.documentElement.dataset.theme
          observer.disconnect()
        }
      }).observe(document, { subtree: true, childList: true })
    })
    await page.reload()
    await page.getByRole('textbox', { name: 'Промпт для изображения' }).waitFor()
    expect(await page.locator('html').getAttribute('data-first-app-theme')).toBe('dark')
    await page.emulateMedia({ colorScheme: 'light' })
    await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBe('light')
    await fetch(`${base}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${sessionToken}` }, body: JSON.stringify({ theme: 'green' }) })
    await page.reload()
    await page.getByRole('textbox', { name: 'Промпт для изображения' }).waitFor()
  })

  // @testCase TC1
  it('keeps shell navigation usable at 390px and 200% zoom', async () => {
    for (const zoom of [1, 2]) {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.evaluate(value => { document.documentElement.style.zoom = String(value) }, zoom)
      const navigation = page.getByRole('navigation', { name: 'Основные разделы' })
      await navigation.waitFor({ state: 'visible' })
      expect(await navigation.getByRole('button').count()).toBe(5)
      const box = await navigation.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.y + box!.height, 'bottom navigation must stay inside the viewport').toBeLessThanOrEqual(845)
      expect(box!.x).toBeGreaterThanOrEqual(-1)
      expect(box!.x + box!.width).toBeLessThanOrEqual(391)
      const controls = await navigation.getByRole('button').all()
      for (const control of controls) {
        const bounds = await control.boundingBox()
        expect(bounds!.width).toBeGreaterThan(20)
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391)
      }
      await page.evaluate(() => {
        const sockets = (window as unknown as { shellTestSockets: WebSocket[] }).shellTestSockets
        for (const socket of sockets) if (socket.readyState === WebSocket.OPEN) socket.close(4000, 'Shell reconnect regression')
      })
      await page.getByText('Соединение потеряно — переподключаемся…').waitFor()
      await page.getByRole('button', { name: 'Повторить', exact: true }).click()
      try {
        await page.locator('.connection-banner').waitFor({ state: 'hidden', timeout: 10_000 })
        await page.getByText('Соединение восстановлено', { exact: true }).last().waitFor({ timeout: 10_000 })
      } catch (error) {
        await screenshot('shell-reconnect-failure')
        console.error('Shell reconnect state', await page.evaluate(() => ({ sockets: (window as unknown as { shellTestSockets: WebSocket[] }).shellTestSockets.map(socket => socket.readyState), toasts: document.querySelector('[data-testid="toasts"]')?.textContent, banner: document.querySelector('.connection-banner')?.textContent })))
        throw error
      }
      const recoveredNavigation = await navigation.boundingBox()
      expect(recoveredNavigation!.y + recoveredNavigation!.height, 'reconnect must not move navigation below the viewport').toBeLessThanOrEqual(845)
      const toastBounds = await page.getByTestId('toasts').boundingBox()
      expect(toastBounds!.y + toastBounds!.height).toBeLessThanOrEqual(box!.y)
      await screenshot(`shell-390-zoom-${zoom}`)
      await navigation.getByRole('button', { name: 'Ещё', exact: true }).click()
      await page.getByRole('dialog').waitFor()
      await page.keyboard.press('Escape')
      await page.getByText('Соединение восстановлено', { exact: true }).last().waitFor({ state: 'hidden', timeout: 10_000 })
    }
    await page.evaluate(() => { document.documentElement.style.zoom = '1' })
    await page.setViewportSize({ width: 721, height: 844 })
    expect(await page.getByRole('navigation', { name: 'Основные разделы' }).isVisible()).toBe(false)
    await page.setViewportSize({ width: 1440, height: 950 })
  })

  it('десктоп использует всю ширину при любом сохранённом состоянии Sidebar', async () => {
    for (const collapsed of ['0', '1']) {
      await page.evaluate(value => localStorage.setItem('vc:sidebarCollapsed', value), collapsed)
      await page.reload()
      await page.getByRole('textbox', { name: 'Промпт для изображения' }).waitFor()
      await expectFullWidth(1440)
    }
    await screenshot('desktop-1440')
  })

  it('узкие панели не пересекаются после изменения окна и сохранённой доли чата', async () => {
    for (const percent of ['25', '75']) {
      await page.evaluate(value => localStorage.setItem('vc.workshop.chatWidth.images', value), percent)
      await page.reload()
      await page.getByRole('textbox', { name: 'Промпт для изображения' }).waitFor()
      for (const width of [1024, 769]) {
        await page.setViewportSize({ width, height: 768 })
        await expectFullWidth(width)
        await expect.poll(async () => {
          const chat = await page.locator('#workshop-chat-pane').boundingBox()
          const divider = await page.getByRole('separator').boundingBox()
          const gallery = await page.locator('#workshop-side-pane').boundingBox()
          const settings = await page.getByRole('button', { name: 'Настройки разговора', exact: true }).boundingBox()
          return !!chat && !!divider && !!gallery && !!settings && chat.width >= 359.5 && gallery.width >= 319.5
            && chat.x + chat.width <= divider.x + .5 && divider.x + divider.width <= gallery.x + .5
            && settings.x + settings.width <= chat.x + chat.width + .5 && gallery.x + gallery.width <= width + .5
        }).toBe(true)
        await screenshot(`panels-${width}-${percent}`)
      }
    }
  })

  it('обе мобильные вкладки занимают экран, подсказка сообщения видна целиком', async () => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 })
      for (const name of ['Галерея', 'Чат']) {
        await page.getByRole('tab', { name, exact: true }).click()
        await expectFullWidth(width)
        if (name === 'Чат') {
          await expect.poll(() => page.getByRole('textbox', { name: 'Поле ввода сообщения' }).evaluate(
            element => element.scrollHeight <= element.clientHeight + 1
          )).toBe(true)
        }
        await screenshot(`mobile-${width}-${name === 'Чат' ? 'chat' : 'gallery'}`)
      }
    }
  })

  it('при изменении ширины пересчитывает высоту неизменённого черновика', async () => {
    await page.setViewportSize({ width: 1440, height: 950 })
    const divider = page.getByRole('separator')
    await divider.dblclick()
    const input = page.getByRole('textbox', { name: 'Поле ввода сообщения' })
    await input.fill('Один и тот же текст переносится при сужении окна.')
    const initial = await input.evaluate(element => element.clientHeight)
    await page.setViewportSize({ width: 769, height: 844 })
    await expect.poll(() => input.evaluate(element => element.clientHeight)).toBeGreaterThan(initial)
    await expect.poll(() => input.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true)
    await page.setViewportSize({ width: 1440, height: 950 })
    await expect.poll(() => input.evaluate(element => element.clientHeight)).toBe(initial)
  })

  it('на телефоне история, выделение и извлечение объекта остаются доступны прокруткой', async () => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 720 })
      await page.getByRole('tab', { name: 'Галерея', exact: true }).click()
      await page.getByRole('button', { name: 'Действия портрет-2.svg' }).click()
      await page.getByRole('menuitem', { name: 'Открыть на весь экран' }).click()
      const viewer = page.getByTestId('image-studio-viewer')
      await viewer.getByRole('button', { name: 'Ещё действия с картинкой' }).click()
      await viewer.getByRole('menuitem', { name: 'История версий' }).click()
      const history = viewer.getByRole('region', { name: 'История версий портрет-2.svg' })
      const restore = history.getByRole('button', { name: 'Откатиться сюда' }).first()
      await restore.scrollIntoViewIfNeeded()
      await expect.poll(() => restore.isVisible()).toBe(true)
      await viewer.getByRole('button', { name: 'Ещё действия с картинкой' }).click()
      await viewer.getByRole('menuitem', { name: 'Выделить объект или ретушировать' }).click()
      const selection = viewer.getByRole('region', { name: 'Выделение объекта: портрет-2.svg' })
      await expect.poll(() => selection.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return rect.left >= -1 && rect.right <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1
      })).toBe(true)
      const extract = selection.getByRole('button', { name: 'Извлечь объект отдельно' })
      await extract.scrollIntoViewIfNeeded()
      await expect.poll(() => extract.isVisible()).toBe(true)
      const stage = selection.locator('.image-studio-selection-stage')
      // Checking the footer scrolled the canvas away; pointer coordinates need the visible stage.
      await stage.scrollIntoViewIfNeeded()
      const box = await stage.boundingBox()
      if (!box) throw new Error('Selection stage is not visible')
      await page.mouse.move(box.x + box.width * .3, box.y + box.height * .25)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * .7, box.y + box.height * .8)
      await page.mouse.up()
      await expect.poll(() => extract.isEnabled()).toBe(true)
      await page.evaluate((token) => localStorage.setItem('vc.session.token', token), sessionToken)
      const responsePending = page.waitForResponse((response) => response.url().includes('/extract'))
      await extract.click()
      const response = await responsePending
      expect(response.ok(), await response.text()).toBe(true)
      await screenshot(`mobile-${width}-after-extract`)
      await selection.waitFor({ state: 'detached' })
      await screenshot(`mobile-${width}-extracted-view`)
      await expect.poll(async () => /портрет-2-объект(?:-\d+)?\.png/.test(await viewer.innerText())).toBe(true)
      const close = viewer.getByRole('button', { name: 'Закрыть' })
      await expect.poll(async () => {
        const rect = await close.boundingBox()
        return !!rect && rect.x >= 0 && rect.x + rect.width <= width + 1
      }).toBe(true)
      await close.click()
    }
    await screenshot('mobile-selection-history')
  })

  // @testCase TC08
  it('saves actual canvas crops, rotation and color correction as linked versions', async () => {
    await page.setViewportSize({ width: 1440, height: 950 })
    const source = 'portrait.png'
    for (const [label, ratio] of [['1:1', 1], ['4:5', 4 / 5], ['16:9', 16 / 9]] as const) {
      await page.getByRole('button', { name: `Открыть ${source} в полный размер`, exact: true }).click()
      const viewer = page.getByTestId('image-studio-viewer')
      await viewer.getByRole('button', { name: 'Ещё действия с картинкой' }).click()
      await viewer.getByRole('menuitem', { name: 'Обрезать (выделите область)' }).click()
      await viewer.getByRole('button', { name: label, exact: true }).click()
      const box = await viewer.locator('.image-studio-crop-stage').boundingBox()
      if (!box) throw new Error('Crop stage missing')
      await page.mouse.move(box.x + 10, box.y + 10)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * .55, box.y + box.height * .6)
      await page.mouse.up()
      const pending = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/file'))
      await viewer.getByRole('button', { name: 'Вырезать выделенное' }).click()
      const response = await pending
      expect(response.ok()).toBe(true)
      const body = response.request().postDataJSON()
      expect(body.source).toBe(source)
      expect(body.path).not.toBe(source)
      const image = await sharp(Buffer.from(body.dataBase64, 'base64')).metadata()
      expect(image.width! / image.height!).toBeCloseTo(ratio, 1)
      const files = await response.json()
      expect(files.find((file: { path: string }) => file.path === body.path)).toMatchObject({ source, operation: 'transform' })
      await viewer.getByRole('button', { name: 'Закрыть', exact: true }).click()
    }
    for (const label of ['Повернуть на 90°', 'Чёрно-белое']) {
      await page.getByRole('button', { name: `Действия ${source}`, exact: true }).click()
      await page.getByRole('menuitem', { name: 'Инструменты обработки' }).click()
      const pending = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/file'))
      await page.getByRole('button', { name: label, exact: true }).click()
      const response = await pending
      expect(response.ok()).toBe(true)
      const body = response.request().postDataJSON()
      expect(body.source).toBe(source)
      const decoded = await sharp(Buffer.from(body.dataBase64, 'base64')).removeAlpha().raw().toBuffer({ resolveWithObject: true })
      if (label.includes('90')) expect([decoded.info.width, decoded.info.height]).toEqual([160, 200])
      else for (let index = 0; index < decoded.data.length; index += 3) {
        expect(decoded.data[index]).toBe(decoded.data[index + 1])
        expect(decoded.data[index]).toBe(decoded.data[index + 2])
      }
    }
  })

  // @testCase TC01
  it('keeps 500 images windowed and uses two columns and a bottom composer at 390px', async () => {
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${sessionToken}` }
    const created = await fetch(base + '/api/conversations', { method: 'POST', headers, body: JSON.stringify({ title: 'Windowed gallery', assistantKind: 'images' }) })
    const body = await created.json() as { id?: string; conversation?: { id: string } }
    const id = body.id ?? body.conversation!.id
    const dataBase64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="teal"/></svg>').toString('base64')
    for (let index = 0; index < 500; index++) {
      const response = await fetch(`${base}/api/image-studio/${id}/file`, { method: 'POST', headers, body: JSON.stringify({ path: `window-${String(index).padStart(3, '0')}.svg`, dataBase64 }) })
      expect(response.ok).toBe(true)
    }
    await page.evaluate(() => { localStorage.setItem('vc.imgstudio.order', 'name'); localStorage.setItem('vc.imgstudio.composer', '0') })
    await page.goto(`${base}/`)
    await page.goto(`${base}/#/images/${id}`)
    for (const width of [721, 720, 390]) {
      await page.setViewportSize({ width, height: 844 })
      const galleryTab = page.getByRole('tab', { name: 'Галерея', exact: true })
      if (await galleryTab.isVisible()) await galleryTab.click()
      const grid = page.getByRole('list', { name: 'Галерея изображений' })
      await screenshot(`before-grid-${width}`)
      await grid.waitFor()
      await page.getByRole('combobox', { name: 'Порядок картинок' }).selectOption('name')
      const pane = page.locator('.image-studio').first()
      await expect.poll(() => grid.locator('.image-studio-card').count()).toBeLessThan(100)
      if (width <= 720) expect(await grid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2)
      const height = await pane.evaluate(element => element.scrollHeight)
      for (const fraction of [0, .25, .5, .75, 1]) {
        await pane.evaluate((element, top) => { element.scrollTop = top }, height * fraction)
        await expect.poll(() => grid.locator('.image-studio-card').count()).toBeGreaterThan(0)
        expect(await grid.locator('.image-studio-card').count()).toBeLessThan(100)
      }
      await screenshot(`before-last-${width}`)
      await expect.poll(() => grid.locator('[data-path]').evaluateAll(elements => elements.map(element => element.getAttribute('data-path')))).toContain('window-499.svg')
      await screenshot(`windowed-${width}`)
    }
    await page.getByRole('button', { name: /Рисование/ }).click()
    const composer = page.getByRole('dialog', { name: 'Рисование', exact: true })
    await composer.waitFor()
    await expect.poll(async () => { const box = await composer.boundingBox(); return !!box && box.y > 0 && box.y + box.height <= 845 }).toBe(true)
    await screenshot('composer-390')
    await composer.getByRole('button', { name: 'Закрыть', exact: true }).click()
  }, 120_000)
})

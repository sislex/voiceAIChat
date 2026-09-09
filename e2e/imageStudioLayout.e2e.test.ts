// Геометрия проверяется на настоящем App: jsdom не замечает неявную колонку
// CSS Grid, пересечение шапки с галереей и устаревшую высоту textarea.
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'

const ROOT = resolve(__dirname, '..')
const PASSWORD = 'image-studio-layout-test'
const artifacts = process.env.VC_VISUAL_ARTIFACTS
let server: ChildProcess | undefined
let browser: Browser | undefined
let page: Page
let dataDir = ''
let base = ''
let conversationId = ''

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
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 950 }, reducedMotion: 'reduce' })
    await page.addInitScript(token => localStorage.setItem('vc.session.token', token), token)
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
})

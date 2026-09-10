// Полная цепочка: App → WebReaderFrame → Recorder → proxy → собственное App.
// БД/учётная запись и порт принадлежат тесту, реальные пользовательские данные не нужны.
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'

const ROOT = resolve(__dirname, '..')
const PASSWORD = 'reader-project-fixture-only'
let server: ChildProcess | undefined
let browser: Browser | undefined
let page: Page
let dataDir = ''
let base = ''

describe('Reader: вход на собственную страницу проекта', () => {
  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'vc-reader-project-'))
    const reservation = createServer()
    await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
    const address = reservation.address()
    if (!address || typeof address === 'string') throw new Error('Не найден порт')
    const port = address.port
    await new Promise<void>(resolve => reservation.close(() => resolve()))
    base = `http://127.0.0.1:${port}`
    server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: join(ROOT, 'apps/server'),
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', VC_DATA_DIR: dataDir,
        VC_WEB_DIR: join(ROOT, 'apps/web/dist'), VC_WEB_RECORDER_DIR: join(ROOT, 'apps/web-recorder/dist'),
        VC_ADMIN_PASSWORD: PASSWORD, VC_BROWSER_HOST_ALIASES: '' },
      stdio: 'ignore'
    })
    await vi.waitFor(async () => {
      expect(server?.exitCode).toBeNull()
      expect((await fetch(base + '/api/health')).ok).toBe(true)
    }, { timeout: 30_000, interval: 200 })
    const login = await fetch(base + '/api/session/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'admin', password: PASSWORD }) })
    expect(login.ok).toBe(true)
    const { token } = await login.json() as { token: string }
    const api = async (path: string, method: string, body: unknown) => {
      const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
      expect(response.ok).toBe(true)
      return response.json()
    }
    await api('/api/settings', 'PUT', { onboarded: true, theme: 'green' })
    const conversation = await api('/api/conversations', 'POST', { title: 'Reader project QA', assistantKind: 'web-recorder' })
    const id = conversation.id ?? conversation.conversation.id
    await api(`/api/conversations/${id}/preview-url`, 'POST', { previewUrl: 'https://app.internal/#/machines' })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.setDefaultTimeout(10_000)
    await page.addInitScript(token => localStorage.setItem('vc.session.token', token), token)
    await page.goto(`${base}/#/web-reader/${id}`)
  })
  afterAll(async () => {
    await browser?.close()
    if (server && server.exitCode === null) {
      const closed = new Promise<void>(resolve => server!.once('exit', () => resolve()))
      server.kill('SIGTERM'); await closed
    }
    if (dataDir) await rm(dataDir, { recursive: true, force: true })
  })
  it('форма входа работает при cookie-сессии внешнего Reader и открывает deep link', async () => {
    const recorder = page.frameLocator('iframe[title="Web Reader"]')
    await recorder.getByRole('textbox', { name: 'Адрес превью' }).waitFor()
    const site = recorder.frameLocator('iframe[title="Предпросмотр сайта"]')
    await site.getByRole('textbox', { name: 'Пользователь', exact: true }).fill('admin')
    await site.getByLabel('Пароль', { exact: true }).fill(PASSWORD)
    await site.getByRole('button', { name: 'Войти', exact: true }).click()
    await site.getByRole('button', { name: 'Добавить машину', exact: true }).waitFor()
    expect(await site.getByRole('button', { name: 'Войти', exact: true }).count()).toBe(0)
    const originTime = await site.locator('html').evaluate(() => performance.timeOrigin)
    const saved = page.waitForResponse(response => response.url().startsWith(base + '/api/conversations/') && response.url().endsWith('/preview-url') && response.request().method() === 'POST')
    await site.getByRole('button', { name: 'Закрыть', exact: true }).click()
    expect((await saved).ok()).toBe(true)
    await expect.poll(() => recorder.getByRole('textbox', { name: 'Адрес превью' }).inputValue()).toBe('https://app.internal/#/')
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    expect(await site.locator('html').evaluate(() => performance.timeOrigin)).toBe(originTime)
    if (process.env.VC_VISUAL_ARTIFACTS) {
      await mkdir(process.env.VC_VISUAL_ARTIFACTS, { recursive: true })
      await page.screenshot({ path: join(process.env.VC_VISUAL_ARTIFACTS, 'reader-project-login.png') })
    }
  })
})

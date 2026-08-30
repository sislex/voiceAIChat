// E2E модуля «Сессии и устройства» в реальном Chromium. Проверяет то, чего не
// видят jsdom-тесты: живое обновление списка по WS (вход с другого устройства
// появляется без перезагрузки) и мгновенный уход на экран входа, когда текущую
// сессию завершают со стороны.
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'

const ROOT = resolve(__dirname, '..')
const WEB_DIST = join(ROOT, 'apps/web/dist')
// Порт спрашиваем у системы, а не берём случайный из диапазона: не добитый
// прошлым прогоном сервер иначе перехватывает подключение вместе со своими
// старыми данными, и тест падает с загадочными «лишними» сессиями.
let PORT = 0
let BASE = ''
const PASSWORD = 'e2e-sessions-pass'
const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1'

let server: ChildProcess | null = null
let dataDir = ''
let browser: Browser
let page: Page
let token = ''

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number }
      probe.close(() => resolve(port))
    })
  })
}

async function waitHealth(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return } catch { /* ещё не поднялся */ }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('сервер не поднялся за 60 с')
}

/** Вход «с другого устройства»: отдельный токен со своим User-Agent. */
async function loginAs(userAgent: string): Promise<string> {
  const res = await fetch(`${BASE}/api/session/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': userAgent },
    body: JSON.stringify({ name: 'admin', password: PASSWORD })
  })
  return ((await res.json()) as { token: string }).token
}

describe.skipIf(!existsSync(WEB_DIST))('Сессии и устройства E2E', () => {
  beforeAll(async () => {
    PORT = await freePort()
    BASE = `http://127.0.0.1:${PORT}`
    dataDir = await mkdtemp(join(tmpdir(), 'vc-e2e-sessions-'))
    server = spawn('npx', ['tsx', 'src/index.ts'], {
      cwd: join(ROOT, 'apps/server'),
      env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', VC_DATA_DIR: dataDir, VC_WEB_DIR: WEB_DIST, VC_ADMIN_PASSWORD: PASSWORD, VC_PUBLIC_URL: BASE },
      stdio: 'ignore'
    })
    await waitHealth()
    token = await loginAs('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36')

    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    await page.goto(`${BASE}/`)
    await page.evaluate((t) => localStorage.setItem('vc.session.token', t), token)
    // Deep-link из письма о новом входе открывает окно сессий напрямую.
    await page.goto(`${BASE}/#/security/sessions`)
    await page.reload()
  })

  afterAll(async () => {
    await browser?.close()
    if (server) {
      const stopped = new Promise<void>((done) => server!.once('exit', () => done()))
      server.kill('SIGTERM')
      await Promise.race([stopped, new Promise((r) => setTimeout(r, 5000))])
    }
    if (dataDir) await rm(dataDir, { recursive: true, force: true })
  })

  it('окно показывает текущее устройство, вход с телефона появляется без перезагрузки', async () => {
    const dialog = page.getByTestId('sessions-dialog')
    await expect.poll(() => dialog.isVisible(), { timeout: 30_000 }).toBe(true)
    // Точный текст: getByText без exact матчит и бейдж, и его строку-родителя.
    await expect.poll(() => page.getByText('это устройство', { exact: true }).count(), { timeout: 30_000 }).toBe(1)

    await loginAs(PHONE_UA)
    // Список обновляет WS-кадр sessions.update — страницу не трогаем.
    await expect.poll(() => page.getByText('Safari 17 · iOS').count(), { timeout: 30_000 }).toBe(1)
    await expect.poll(() => page.getByRole('button', { name: /Выйти на других устройствах/ }).count()).toBe(1)
  })

  it('завершение чужой сессии убирает карточку и отбирает доступ у того устройства', async () => {
    const phoneToken = await loginAs(PHONE_UA)
    await expect.poll(() => page.getByRole('button', { name: 'Завершить' }).count(), { timeout: 30_000 }).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Завершить' }).first().click()
    await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Продолжить' }).click()

    await expect.poll(async () => {
      const res = await fetch(`${BASE}/api/conversations`, { headers: { authorization: `Bearer ${phoneToken}` } })
      return res.status
    }, { timeout: 30_000 }).toBe(401)
  })

  it('когда завершают текущую сессию, вкладка сама уходит на экран входа', async () => {
    const sessions = (await (await fetch(`${BASE}/api/session/list`, { headers: { authorization: `Bearer ${token}` } })).json()) as { sessions: Array<{ sid: string; userAgent: string }> }
    const current = sessions.sessions.find((s) => s.userAgent.includes('Chrome'))!
    // Отзыв «со стороны» — как из админки или с другого устройства.
    await fetch(`${BASE}/api/admin/sessions/${current.sid}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })
    await expect.poll(() => page.getByTestId('login-form').count(), { timeout: 30_000 }).toBe(1)
  })
})

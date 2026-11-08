// E2E модуля «Сессии и устройства» в реальном Chromium: один сквозной UI-случай —
// живое обновление списка по WS (вход с другого устройства появляется без
// перезагрузки). Отзыв сессий и отказ в доступе проверяет серверный session.test.ts.
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { childAddress, loopbackRelay } from './listening-server'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'

const ROOT = resolve(__dirname, '..')
const WEB_DIST = join(ROOT, 'node_modules/@sislexa/core-ui/web')
let BASE = ''
let relay: Awaited<ReturnType<typeof loopbackRelay>>
const PASSWORD = 'e2e-sessions-pass'
const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1'

let server: ChildProcess | null = null
let dataDir = ''
let browser: Browser
let page: Page
let token = ''

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

describe('Сессии и устройства E2E', () => {
  beforeAll(async () => {
    if (!existsSync(WEB_DIST)) throw new Error('Build apps/web before session integration tests')
    relay = await loopbackRelay()
    BASE = relay.url
    dataDir = await mkdtemp(join(tmpdir(), 'vc-e2e-sessions-'))
    server = spawn(process.execPath, ['--import', 'tsx', '--import', join(ROOT, 'e2e/listening-address.mjs'), 'src/index.ts'], {
      cwd: join(ROOT, 'apps/server'),
      env: { ...process.env, PORT: '0', HOST: '127.0.0.1', VC_DATA_DIR: dataDir, VC_WEB_DIR: WEB_DIST, VC_ADMIN_PASSWORD: PASSWORD, VC_PUBLIC_URL: BASE },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    })
    relay.forwardTo(await childAddress(server))
    await waitHealth()
    token = await loginAs('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36')

    // This suite models a returning user; first-run overlays have separate coverage.
    const settings = await fetch(`${BASE}/api/settings`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ onboarded: true }) })
    expect(settings.ok).toBe(true)

    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    // Returning-user fixture; first entry is covered by TC9.
    await page.addInitScript(() => localStorage.setItem('vc:shell:admin:tour', 'true'))
    await page.goto(`${BASE}/`)
    await page.evaluate((t) => localStorage.setItem('vc.session.token', t), token)
    // Deep-link из письма о новом входе открывает окно сессий напрямую.
    await page.goto(`${BASE}/#/security/sessions`)
    await page.reload()
  })

  afterAll(async () => {
    await browser?.close()
    await relay?.close()
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
})

// E2E раздела «Проекты» в реальном Chromium: типы проекта, гейт возможностей и
// приглашение участника письмом. Проверяет то, чего не видят jsdom-тесты:
// сборку страницы целиком, каскад нативных селектов, переход по ссылке из
// письма и живое обновление списка приглашений.
//
// Письма ловим встроенным SMTP-приёмником на свободном порту — Mailpit для
// прогона не нужен, тест самодостаточен.
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'

const ROOT = resolve(__dirname, '..')
const WEB_DIST = join(ROOT, 'apps/web/dist')
const PORT = 8911 + Math.floor(Math.random() * 80)
const SMTP_PORT = PORT + 1000
const BASE = `http://127.0.0.1:${PORT}`
const PASSWORD = 'e2e-pass'

let server: ChildProcess | null = null
let smtp: Server | null = null
let dataDir = ''
let browser: Browser
let page: Page
let token = ''
/** Тексты писем, принятых фейковым SMTP. */
const letters: string[] = []

async function waitHealth(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return } catch { /* ещё не поднялся */ }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('сервер не поднялся за 60 с')
}

/** Минимальный SMTP: отвечает по протоколу и складывает тело письма. */
function startSmtp(): Promise<Server> {
  return new Promise((res) => {
    const srv = createServer((sock: Socket) => {
      let data = false
      let buf = ''
      let body = ''
      sock.write('220 e2e ESMTP\r\n')
      sock.on('data', (chunk) => {
        buf += chunk.toString('utf8')
        let idx: number
        while ((idx = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          if (data) {
            if (line === '.') { data = false; letters.push(body); body = ''; sock.write('250 OK\r\n') }
            else body += `${line}\n`
            continue
          }
          const cmd = line.split(' ')[0]?.toUpperCase()
          if (cmd === 'EHLO' || cmd === 'HELO') sock.write('250-e2e\r\n250 OK\r\n')
          else if (cmd === 'DATA') { data = true; sock.write('354 go\r\n') }
          else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end() }
          else sock.write('250 OK\r\n')
        }
      })
    })
    srv.listen(SMTP_PORT, '127.0.0.1', () => res(srv))
  })
}

/** Ссылка приглашения из multipart-письма: пробуем и как есть, и по base64-блокам. */
function decodeInviteLink(letter: string): string | undefined {
  const find = (text: string): string | undefined => /#\/project-invite\/([\w-]+)/.exec(text)?.[1]
  const direct = find(letter)
  if (direct) return direct
  let block = ''
  for (const line of `${letter}\n`.split('\n')) {
    if (/^[A-Za-z0-9+/=]+$/.test(line.trim()) && line.trim().length > 8) {
      block += line.trim()
      continue
    }
    if (block) {
      const found = find(Buffer.from(block, 'base64').toString('utf8'))
      if (found) return found
      block = ''
    }
  }
  return undefined
}

const api = async (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${BASE}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) } })

describe.skipIf(!existsSync(WEB_DIST))('Проекты E2E', () => {
  beforeAll(async () => {
    smtp = await startSmtp()
    dataDir = await mkdtemp(join(tmpdir(), 'vc-e2e-projects-'))
    server = spawn('npx', ['tsx', 'src/index.ts'], {
      cwd: join(ROOT, 'apps/server'),
      env: {
        ...process.env,
        PORT: String(PORT), HOST: '127.0.0.1', VC_DATA_DIR: dataDir, VC_WEB_DIR: WEB_DIST,
        VC_ADMIN_PASSWORD: PASSWORD,
        VC_SMTP_URL: `smtp://127.0.0.1:${SMTP_PORT}`,
        VC_MAIL_FROM: 'ChatAI <no-reply@e2e>',
        VC_PUBLIC_URL: BASE
      },
      stdio: 'ignore'
    })
    await waitHealth()
    const login = await fetch(`${BASE}/api/session/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'admin', password: PASSWORD }) })
    token = ((await login.json()) as { token: string }).token
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ onboarded: true }) })

    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    await page.goto(`${BASE}/`)
    await page.evaluate((t) => localStorage.setItem('vc.session.token', t), token)
    await page.goto(`${BASE}/#/projects`)
    await page.reload()
  })

  afterAll(async () => {
    await browser?.close()
    server?.kill('SIGTERM')
    smtp?.close()
    if (dataDir) await rm(dataDir, { recursive: true, force: true })
  })

  it('проект создаётся окном с каскадом типов; «Общий проект» получает короткую доску', async () => {
    await page.getByRole('button', { name: '+ Новый проект' }).click()
    const dialog = page.getByTestId('new-project-dialog')
    await dialog.getByLabel('Название').fill('Ремонт офиса')
    await dialog.locator('select').first().selectOption('type-general')
    // Возможности выбранного типа видны до создания.
    await expect.poll(() => page.getByTestId('new-project-type-summary').textContent()).toContain('только доска и задачи')
    await dialog.getByRole('button', { name: 'Создать' }).click()

    await expect.poll(() => page.locator('.jcol-head').count(), { timeout: 30_000 }).toBe(5)
    // Тип выключил релизы — вкладки нет вовсе.
    expect(await page.getByRole('tab', { name: 'Релизы' }).count()).toBe(0)
  })

  it('в проекте «Разработка ПО» вкладка релизов на месте', async () => {
    await page.getByRole('button', { name: '+ Новый проект' }).click()
    const dialog = page.getByTestId('new-project-dialog')
    await dialog.getByLabel('Название').fill('Разработка')
    await dialog.locator('select').first().selectOption('type-software')
    await dialog.getByRole('button', { name: 'Создать' }).click()
    await expect.poll(() => page.getByRole('tab', { name: 'Релизы' }).count(), { timeout: 30_000 }).toBe(1)
  })

  it('приглашение уходит письмом, ссылка из него открывает экран приглашения', async () => {
    const projects = (await (await api('/api/projects')).json()) as Array<{ id: string; name: string }>
    const project = projects.find((p) => p.name === 'Разработка')!
    letters.length = 0
    const invited = await api(`/api/projects/${project.id}/invitations`, { method: 'POST', body: JSON.stringify({ invitee: 'mate@example.com' }) })
    expect(invited.status).toBe(200)

    await expect.poll(() => letters.length, { timeout: 15_000 }).toBeGreaterThan(0)
    // Письмо — multipart с base64-частями: декодируем каждый непрерывный блок
    // base64-строк отдельно, иначе склейка с заголовками даёт мусор.
    const link = decodeInviteLink(letters.join('\n'))
    expect(link, 'в письме должна быть ссылка приглашения').toBeTruthy()

    // Экран приглашения открывается и до входа: показывает, куда зовут.
    const anon = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    await anon.goto(`${BASE}/#/project-invite/${link}`)
    await expect.poll(() => anon.getByTestId('invite-screen').isVisible(), { timeout: 30_000 }).toBe(true)
    await expect.poll(() => anon.getByTestId('invite-screen').textContent()).toContain('Разработка')
    await anon.close()
  })

  it('отказ гейта объясняется человеку, а не кодом', async () => {
    const projects = (await (await api('/api/projects')).json()) as Array<{ id: string; name: string }>
    const general = projects.find((p) => p.name === 'Ремонт офиса')!
    const message = await page.evaluate(async (id) => {
      try {
        await (window as unknown as { api: Record<string, (a: unknown) => Promise<unknown>> }).api['releases:branches']({ projectId: id })
        return 'ошибки не было'
      } catch (error) {
        return (error as Error).message
      }
    }, general.id)
    expect(message).toContain('релизов')
    expect(message).not.toContain('feature_unavailable')
  })

  it('приглашённый принимает приглашение из сайдбара и получает проект', async () => {
    // Самый рискованный путь фичи: приём проверяет, что приглашение адресовано
    // именно этому человеку. До сих пор он был покрыт только API-тестами.
    const MATE = 'mate'
    // Пароль не должен содержать логин — политика такие отклоняет.
    const MATE_PASSWORD = 'Qwerty-Sunrise-77'
    const created = await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: MATE, password: MATE_PASSWORD, role: 'developer' }) })
    expect(created.status, await created.text()).toBe(200)

    const projects = (await (await api('/api/projects')).json()) as Array<{ id: string; name: string }>
    const project = projects.find((p) => p.name === 'Разработка')!
    const invited = await api(`/api/projects/${project.id}/invitations`, { method: 'POST', body: JSON.stringify({ invitee: MATE }) })
    expect(invited.status).toBe(200)
    // Приглашение по логину письма не порождает — принимать придётся из интерфейса.
    expect(((await invited.json()) as { mailed: boolean }).mailed).toBe(false)

    const mateLogin = await fetch(`${BASE}/api/session/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: MATE, password: MATE_PASSWORD }) })
    const mateToken = ((await mateLogin.json()) as { token: string }).token

    // Онбординг — настройка пользователя, а не приложения: у нового человека его
    // оверлей перекрывает сайдбар, и клик по «Принять» не доходит до кнопки.
    await fetch(`${BASE}/api/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${mateToken}` },
      body: JSON.stringify({ onboarded: true })
    })

    const mate = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    try {
      await mate.goto(`${BASE}/`)
      await mate.evaluate((t) => localStorage.setItem('vc.session.token', t), mateToken)
      await mate.goto(`${BASE}/#/projects`)
      await mate.reload()

      const inbox = mate.locator('.proj-invites-inbox')
      await expect.poll(() => inbox.isVisible().catch(() => false), { timeout: 30_000 }).toBe(true)
      await expect.poll(() => inbox.textContent()).toContain('Разработка')

      // .first(): приглашений может быть несколько, а список перерисовывается по
      // WS-инвалидации — без явного ожидания клик попадает в момент перерисовки.
      await inbox.getByRole('button', { name: 'Принять' }).first().click({ timeout: 30_000 })

      // Сначала проверяем результат по данным: членство — это то, ради чего всё.
      await expect.poll(async () => {
        const response = await fetch(`${BASE}/api/projects`, { headers: { authorization: `Bearer ${mateToken}` } })
        const mine = (await response.json()) as Array<{ id: string }>
        return mine.map((p) => p.id).includes(project.id)
      }, { timeout: 30_000 }).toBe(true)

      // И только потом — что принятое приглашение ушло из списка.
      await expect.poll(() => inbox.isVisible().catch(() => false), { timeout: 30_000 }).toBe(false)
    } finally {
      await mate.close()
    }
  })

  it('чужую ссылку приглашения принять нельзя даже вошедшему', async () => {
    const projects = (await (await api('/api/projects')).json()) as Array<{ id: string; name: string }>
    const project = projects.find((p) => p.name === 'Разработка')!
    letters.length = 0
    await api(`/api/projects/${project.id}/invitations`, { method: 'POST', body: JSON.stringify({ invitee: 'stranger@example.com' }) })
    await expect.poll(() => letters.length, { timeout: 15_000 }).toBeGreaterThan(0)
    const token = decodeInviteLink(letters.join('\n'))!

    // Админ вошёл, но приглашение адресовано чужому адресу — утёкшая ссылка
    // не должна пускать в проект.
    const message = await page.evaluate(async (t) => {
      try {
        await (window as unknown as { api: Record<string, (a: unknown) => Promise<unknown>> }).api['invitations:accept']({ token: t })
        return 'приняли — этого быть не должно'
      } catch (error) {
        return (error as Error).message
      }
    }, token)
    expect(message).toContain('адресовано другому')
  })
})

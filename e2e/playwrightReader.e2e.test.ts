// Полный путь: панель → REST → browser-runner → Chromium и MCP → тот же Chromium.
// Собственный сайт проверяем на временной БД, чтобы не менять данные пользователя.
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { buildBrowserRunner } from '../apps/browser-runner/src/server.js'
import { previewOriginTarget } from '../apps/browser-runner/src/security.js'
import { createPreviewTurnTokens } from '../apps/server/src/reader/turnToken.js'
import { startReaderFormsFixture } from '../apps/browser-runner/src/test/readerForms.js'
import { BROWSER_UPLOAD_LIMIT_BYTES } from '../packages/shared/src/browserLimits'

const ROOT = resolve(__dirname, '..')
const PASSWORD = 'reader-audit-local-test-only'
const MCP_SECRET = 'reader-audit-local-mcp'
const artifacts = process.env.VC_VISUAL_ARTIFACTS
let server: ChildProcess | undefined
let runner: FastifyInstance | undefined
let browser: Browser | undefined
let page: Page
let dataDir = ''
let base = ''
let conversationId = ''
let turn = ''
let auth = ''
let forms: Awaited<ReturnType<typeof startReaderFormsFixture>> | undefined
const chats: Record<string, string> = {}

async function freePort(): Promise<number> {
  const socket = createServer()
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve))
  const address = socket.address()
  if (!address || typeof address === 'string') throw new Error('Free port unavailable')
  await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()))
  return address.port
}

async function api(path: string, method: string, body: unknown) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', authorization: auth }, body: JSON.stringify(body) })
  expect(response.ok, `${method} ${path}: ${await response.clone().text()}`).toBe(true)
  return response.json()
}

async function mcp(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const response = await fetch(`${base}/mcp/preview?k=${MCP_SECRET}&turn=${encodeURIComponent(turn)}`, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  })
  expect(response.status).toBe(200)
  const body = await response.json() as { result?: { isError?: boolean; content: Array<{ type: string; text?: string }> }; error?: unknown }
  expect(body.error).toBeUndefined()
  expect(body.result?.isError, JSON.stringify(body)).not.toBe(true)
  return body.result!.content.filter(item => item.type === 'text').map(item => item.text ?? '').join('\n')
}

async function capture(name: string): Promise<void> {
  if (!artifacts) return
  await mkdir(artifacts, { recursive: true })
  await page.waitForResponse(response => response.url().endsWith(`/api/browser/${conversationId}/screenshot`) && response.ok())
  // Поток может уже показать следующий кадр: равенство одному ответу HTTP
  // нестабильно даже при исправном UI. Декодирование проверяется отдельно.
  await page.screenshot({ path: join(artifacts, `${name}.png`), fullPage: true })
}

describe('Playwright Reader: настоящий интерфейс и инструменты модели', () => {
  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'vc-reader-e2e-'))
    const port = await freePort()
    base = `http://127.0.0.1:${port}`
    forms = await startReaderFormsFixture()
    runner = await buildBrowserRunner({ token: 'reader-e2e-runner', profilesRoot: join(dataDir, 'profiles'), previewOrigin: previewOriginTarget(base), hostAliases: new Map([['forms.reader.test', new URL(forms.origin).host]]), idleMs: 0 })
    const runnerUrl = await runner.listen({ host: '127.0.0.1', port: 0 })
    server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: join(ROOT, 'apps/server'),
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', VC_DATA_DIR: dataDir, VC_WEB_DIR: join(ROOT, 'apps/web/dist'),
        VC_ADMIN_PASSWORD: PASSWORD, VC_MCP_SECRET: MCP_SECRET, VC_BROWSER_RUNNER_URL: runnerUrl,
        VC_BROWSER_RUNNER_TOKEN: 'reader-e2e-runner', VC_BROWSER_PREVIEW_BASE: base },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    server.stdout?.on('data', chunk => { output = (output + chunk).slice(-8000) })
    server.stderr?.on('data', chunk => { output = (output + chunk).slice(-8000) })
    await vi.waitFor(async () => {
      if (server?.exitCode !== null) throw new Error(`Test server exited: ${output}`)
      expect((await fetch(`${base}/api/health`)).ok).toBe(true)
    }, { timeout: 45_000, interval: 250 })
    const login = await fetch(`${base}/api/session/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'admin', password: PASSWORD }) })
    expect(login.ok).toBe(true)
    const { token } = await login.json() as { token: string }
    auth = `Bearer ${token}`
    await api('/api/settings', 'PUT', { onboarded: true, theme: 'green' })
    for (const [kind, title] of [['playwright-reader', 'Reader audit'], ['make', 'Make audit'], ['images', 'Images audit'], ['chat', 'Chat audit']]) {
      const created = await api('/api/conversations', 'POST', { title, ...(kind !== 'chat' ? { assistantKind: kind } : {}) }) as { id?: string; conversation?: { id: string } }
      chats[kind] = created.id ?? created.conversation!.id
    }
    conversationId = chats['playwright-reader']
    turn = createPreviewTurnTokens(MCP_SECRET).issue({ userId: 'admin', conversationId })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
    await page.addInitScript(token => localStorage.setItem('vc.session.token', token), token)
    await page.goto(`${base}/#/playwright-reader/${conversationId}`)
    await page.getByRole('textbox', { name: 'Адрес страницы', exact: true }).waitFor()
    await vi.waitFor(async () => expect(await page.getByRole('textbox', { name: 'Адрес страницы', exact: true }).isEnabled()).toBe(true), { timeout: 15_000 })
  })

  afterEach(async context => {
    if (context.task.result?.state !== 'fail' || !artifacts || !page) return
    await mkdir(artifacts, { recursive: true })
    await page.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true })
    await writeFile(join(artifacts, 'failure.txt'), await page.locator('body').innerText())
  })

  afterAll(async () => {
    await browser?.close()
    // Внутренние страницы держат WS к ядру. Закрываем их до остановки ядра,
    // чтобы завершение стенда не зависело от ещё работающего клиента.
    await runner?.close()
    if (server && server.exitCode === null) {
      const stopped = new Promise<void>(resolve => server!.once('exit', () => resolve()))
      server.kill('SIGTERM')
      await stopped
    }
    await forms?.close()
    if (dataDir) await rm(dataDir, { recursive: true, force: true })
  })

  it('человек открывает собственный сайт и получает отображаемый JPEG-кадр', async () => {
    const address = page.getByRole('textbox', { name: 'Адрес страницы', exact: true })
    await address.fill(`${base}/#/chat/${chats.chat}`)
    await page.getByRole('button', { name: 'Открыть', exact: true }).click()
    await expect.poll(() => mcp('read')).toContain('Пользователь')
    const frame = page.locator('img[alt="Кадр Chromium"]')
    await expect.poll(() => frame.getAttribute('src')).toMatch(/^data:image\/jpeg;base64,/)
    await expect.poll(() => frame.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    expect(await page.getByText(/ушла с проверяемого сайта/).count()).toBe(0)
    await capture('01-project-login')
  })

  it('модель входит тестовой учёткой и открывает chat, Make и Images с работающим JS', async () => {
    await mcp('type', { selector: 'input[aria-label="Пользователь"]', text: 'admin' })
    await mcp('type', { selector: 'input[aria-label="Пароль"]', text: PASSWORD })
    await mcp('click', { selector: 'button[type="submit"]' })
    await mcp('wait', { selector: '.chat-page' })
    for (const [kind, route, selector] of [['chat', 'chat', '.chat-page'], ['make', 'make', '.app--make'], ['images', 'images', '.app--image-studio']]) {
      await mcp('open', { url: `${base}/#/${route}/${chats[kind]}` })
      await mcp('wait', { selector })
      const content = await mcp('read', { selector })
      expect(content.length).toBeGreaterThan(30)
      await expect.poll(() => page.getByRole('textbox', { name: 'Адрес страницы', exact: true }).inputValue(), { timeout: 10_000 }).toBe(`${base}/#/${route}/${chats[kind]}`)
      await expect.poll(() => page.locator('.playwright-reader-actor').getAttribute('data-actor'), { timeout: 10_000 }).toBe('assistant')
      if (artifacts) await writeFile(join(artifacts, `02-${kind}-mcp.json`), content)
      await capture(`02-project-${kind}`)
    }
  })

  it('новая вкладка, навигация и переключение работают из панели после действий модели', async () => {
    await page.getByRole('button', { name: 'Новая вкладка', exact: true }).click()
    await expect.poll(() => page.getByRole('tablist', { name: 'Вкладки страницы' }).getByRole('tab').count()).toBe(2)
    const address = page.getByRole('textbox', { name: 'Адрес страницы', exact: true })
    await address.fill(`${base}/#/chat/${chats.chat}`)
    await address.press('Enter')
    await mcp('wait', { selector: '.chat-page' })
    await page.getByRole('tablist', { name: 'Вкладки страницы' }).getByRole('tab').first().click()
    await mcp('wait', { selector: '.app--image-studio' })
    await capture('03-tabs-after-model-actions')
  })

  it('сохраняет черновик адреса при действиях модели и возвращает актуальный URL по Escape', async () => {
    const address = page.getByRole('textbox', { name: 'Адрес страницы', exact: true })
    await address.fill('https://draft.example.test/')
    const url = `${base}/#/make/${chats.make}`
    await mcp('open', { url })
    await mcp('wait', { selector: '.app--make' })
    await expect.poll(() => page.getByRole('tablist', { name: 'Вкладки страницы' }).getByRole('tab', { selected: true }).getAttribute('title'), { timeout: 10_000 }).toBe(url)
    expect(await address.inputValue()).toBe('https://draft.example.test/')
    await address.press('Escape')
    expect(await address.inputValue()).toBe(url)
    await capture('04-draft-after-model-navigation')
  })

  it('показывает потерю кадров и восстанавливает трансляцию после возврата сети', async () => {
    const pattern = '**/api/browser/*/screenshot'
    await page.route(pattern, route => route.abort('failed'))
    try {
      await expect.poll(() => page.getByText(/Кадр не обновляется/).count(), { timeout: 15_000 }).toBe(1)
      if (artifacts) await page.screenshot({ path: join(artifacts, '05-frame-connection-lost.png') })
    } finally { await page.unroute(pattern) }
    await expect.poll(() => page.getByText(/Кадр не обновляется/).count(), { timeout: 15_000 }).toBe(0)
    await capture('05-frame-connection-restored')
  })

  it('модель управляет полями, отдельной прокруткой и файлами через настоящий MCP', async () => {
    await mcp('open', { url: 'http://forms.reader.test/' })
    await mcp('click', { selector: '#modifiers', modifiers: ['shift', 'alt'] })
    const modifiers = JSON.parse(await mcp('read', { selector: '#modifiers-result' })) as { text: string }
    expect(JSON.parse(modifiers.text)).toMatchObject({ shift: true, alt: true, ctrl: false, meta: false })
    await mcp('type', { selector: '#other', text: 'Фокус был здесь' })
    await mcp('press', { selector: '#target', key: 'Enter' })
    expect(await mcp('read', { selector: '#key-result' })).toContain('target:Enter')
    await mcp('scroll', { selector: '#scroller', dy: 500 })
    expect(await mcp('read', { selector: '#scroll-result' })).toContain('inner:500')
    await mcp('upload', { selector: '#file', name: 'empty.txt', base64: '' })
    expect(await mcp('read', { selector: '#file-result' })).toContain('file:empty.txt:0')
    await mcp('upload', { selector: '#file', name: 'eight-mebibytes.bin', base64: Buffer.alloc(BROWSER_UPLOAD_LIMIT_BYTES).toString('base64') })
    expect(await mcp('read', { selector: '#file-result' })).toContain(`file:eight-mebibytes.bin:${BROWSER_UPLOAD_LIMIT_BYTES}`)
    await capture('06-model-forms-and-upload')
    await mcp('click', { selector: '#next' })
    const text = await mcp('read')
    expect(text).toContain('http://forms.reader.test/next')
    expect(text).toContain('Следующая страница')
  })
})

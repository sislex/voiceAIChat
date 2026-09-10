import { startReaderDiagnosticsFixture } from '../apps/browser-runner/src/test/readerDiagnostics.js'
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
import { startReaderFramesFixture } from '../apps/browser-runner/src/test/readerFrames.js'
import { startReaderDownloadsFixture } from '../apps/browser-runner/src/test/readerDownloads.js'
import { startReaderDialogsFixture } from '../apps/browser-runner/src/test/readerDialogs.js'
import { startReaderInputFixture } from '../apps/browser-runner/src/test/readerInput.js'
import { startReaderProfileFixture } from '../apps/browser-runner/src/test/readerProfile.js'
import { startReaderFormsFixture } from '../apps/browser-runner/src/test/readerForms.js'
import { BROWSER_UPLOAD_LIMIT_BYTES } from '../packages/shared/src/browserLimits'
import { runScenarioStep, type ScenarioSend } from '../packages/shared/src/scenarioStep'
import type { BrowserSelectorResult } from '../packages/shared/src/types'

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
let frameSite: Awaited<ReturnType<typeof startReaderFramesFixture>> | undefined
let profileSite: Awaited<ReturnType<typeof startReaderProfileFixture>> | undefined
let inputSite: Awaited<ReturnType<typeof startReaderInputFixture>> | undefined
let dialogSite: Awaited<ReturnType<typeof startReaderDialogsFixture>> | undefined
let diagnosticSite: Awaited<ReturnType<typeof startReaderDiagnosticsFixture>> | undefined
let downloadSite: Awaited<ReturnType<typeof startReaderDownloadsFixture>> | undefined
const chats: Record<string, string> = {}
const browserTrace: Array<Record<string, unknown>> = []
const browserFailures: Array<{ path: string; status: number; body: string }> = []

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

async function mcpReply(name: string, args: Record<string, unknown> = {}, expectedError = false) {
  const response = await fetch(`${base}/mcp/preview?k=${MCP_SECRET}&turn=${encodeURIComponent(turn)}`, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  })
  expect(response.status).toBe(200)
  const body = await response.json() as { result?: { isError?: boolean; content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> }; error?: unknown }
  expect(body.error).toBeUndefined()
  if (expectedError) expect(body.result?.isError, JSON.stringify(body)).toBe(true)
  else expect(body.result?.isError, JSON.stringify(body)).not.toBe(true)
  return body.result!
}

async function mcp(name: string, args: Record<string, unknown> = {}): Promise<string> {
  return (await mcpReply(name, args)).content.filter(item => item.type === 'text').map(item => item.text ?? '').join('\n')
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
    if (artifacts) await mkdir(artifacts, { recursive: true })
    dataDir = await mkdtemp(join(tmpdir(), 'vc-reader-e2e-'))
    const port = await freePort()
    base = `http://127.0.0.1:${port}`
    forms = await startReaderFormsFixture()
    frameSite = await startReaderFramesFixture()
    profileSite = await startReaderProfileFixture()
    inputSite = await startReaderInputFixture()
    dialogSite = await startReaderDialogsFixture()
    downloadSite = await startReaderDownloadsFixture()
    diagnosticSite = await startReaderDiagnosticsFixture()
    runner = await buildBrowserRunner({ token: 'reader-e2e-runner', profilesRoot: join(dataDir, 'profiles'), previewOrigin: previewOriginTarget(base), hostAliases: new Map([['diag.reader.test', new URL(diagnosticSite.origin).host], ['downloads.reader.test', new URL(downloadSite.origin).host], ['dialog.reader.test', new URL(dialogSite.origin).host], ['input.reader.test', new URL(inputSite.origin).host], ['profile.reader.test', new URL(profileSite.origin).host], ['forms.reader.test', new URL(forms.origin).host], ['frames.reader.test', new URL(frameSite.origin).host], ['child.reader.test', new URL(frameSite.childOrigin).host]]), idleMs: 0 })
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
    page.on('pageerror', error => browserTrace.push({ at: Date.now(), event: 'pageerror', message: error.message }))
    page.on('request', request => {
      if (!request.url().includes('/api/browser/')) return
      browserTrace.push({ at: Date.now(), event: 'request', path: new URL(request.url()).pathname, command: request.postDataJSON()?.command?.type })
    })
    page.on('response', response => {
      if (response.url().includes('/api/browser/')) void response.json().then(body => {
        browserTrace.push({ at: Date.now(), event: 'response', path: new URL(response.url()).pathname, status: response.status(), dialogs: body.dialogs?.map((item: { id: string; type: string }) => ({ id: item.id, type: item.type })) })
      }).catch(() => undefined)

      if (response.status() < 400 || !response.url().includes('/api/browser/')) return
      void response.text().then(body => browserFailures.push({ path: new URL(response.url()).pathname, status: response.status(), body: body.slice(0, 1000) })).catch(() => undefined)
    })
    await page.addInitScript(token => {
      // Унаследованный вход переносится в cookie один раз. Повторная запись
      // Bearer при каждом reload искусственно запускала миграцию заново.
      if (sessionStorage.getItem('reader-test-initialized')) return
      localStorage.setItem('vc.session.token', token)
      sessionStorage.setItem('reader-test-initialized', '1')
    }, token)
    await page.goto(`${base}/#/playwright-reader/${conversationId}`)
    await page.getByRole('textbox', { name: 'Адрес страницы', exact: true }).waitFor()
    await vi.waitFor(async () => expect(await page.getByRole('textbox', { name: 'Адрес страницы', exact: true }).isEnabled()).toBe(true), { timeout: 15_000 })
  })

  afterEach(async context => {
    if (context.task.result?.state !== 'fail' || !artifacts || !page) return
    await mkdir(artifacts, { recursive: true })
    await page.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true })
    await writeFile(join(artifacts, 'failure.txt'), await page.locator('body').innerText())
    await writeFile(join(artifacts, 'browser-failures.json'), JSON.stringify(browserFailures, null, 2))
    browserTrace.push({ at: Date.now(), event: 'visibility', hidden: await page.evaluate(() => document.hidden) })
    await writeFile(join(artifacts, 'browser-trace.json'), JSON.stringify(browserTrace.slice(-100), null, 2))
    await writeFile(join(artifacts, 'pending-dialogs.json'), await mcp('dialogs'))
    await writeFile(join(artifacts, 'chromium-console.json'), await mcp('console'))
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
    await frameSite?.close()
    await profileSite?.close()
    await inputSite?.close()
    await dialogSite?.close()
    await downloadSite?.close()
    await diagnosticSite?.close()
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

  it('модель ведёт несколько вкладок и popup, человек восстанавливает пустую панель', async () => {
    type Tabs = { activeTabId: string; incarnation: string; tabs: Array<{ id: string; openerTabId?: string }> }
    const tabs = async () => JSON.parse(await mcp('tabs')) as Tabs
    await mcp('viewport', { width: 390 })
    const created = JSON.parse(await mcp('new-tab', { url: 'http://forms.reader.test/' })) as Tabs
    const opener = created.activeTabId
    expect(JSON.parse(await mcp('evaluate', { code: 'innerWidth' }))).toMatchObject({ value: 390 })
    await mcp('click', { selector: '#popup' })
    await expect.poll(async () => (await tabs()).tabs.some(tab => tab.openerTabId === opener)).toBe(true)
    const child = (await tabs()).tabs.find(tab => tab.openerTabId === opener)!
    await mcp('select-tab', { tabId: child.id })
    expect(await mcp('read')).toContain('Переход завершён')
    expect(JSON.parse(await mcp('close-tab', { tabId: child.id }))).toMatchObject({ activeTabId: opener })
    await mcp('type', { selector: '#target', text: 'Черновик до перезагрузки' })
    await mcp('reload')
    expect(JSON.parse(await mcp('evaluate', { code: 'document.querySelector("#target").value' }))).toMatchObject({ value: '' })
    expect(JSON.parse(await mcp('stop-loading'))).toMatchObject({ incarnation: created.incarnation, activeTabId: opener })
    expect(await mcp('read')).toContain('Формы Reader')
    await mcp('viewport', { width: 1280 })
    await capture('07-tabs-and-popup-through-mcp')
    for (const tab of (await tabs()).tabs) await mcp('close-tab', { tabId: tab.id })
    await expect.poll(() => page.getByText('Все вкладки закрыты', { exact: true }).count(), { timeout: 15_000 }).toBe(1)
    await page.getByRole('button', { name: 'Новая вкладка', exact: true }).click()
    await expect.poll(async () => (await tabs()).tabs.length).toBe(1)
    await expect.poll(() => page.getByText('Все вкладки закрыты', { exact: true }).count()).toBe(0)
    await mcp('close-tab', { tabId: (await tabs()).activeTabId })
    await expect.poll(() => page.getByText('Все вкладки закрыты', { exact: true }).count(), { timeout: 15_000 }).toBe(1)
    await page.getByLabel('Адрес страницы', { exact: true }).fill('http://forms.reader.test/')
    await page.getByLabel('Адрес страницы', { exact: true }).press('Enter')
    await expect.poll(async () => (await tabs()).tabs.length).toBe(1)
    expect(await mcp('read')).toContain('Формы Reader')
    await capture('08-human-recovers-empty-tabs')
  })


  it('модель читает структуру, продолжает документ и действует по результату поиска', async () => {
    await mcp('open', { url: 'http://forms.reader.test/reading' })
    const read = async (args: Record<string, unknown> = {}) => JSON.parse(await mcp('read', args)) as BrowserSelectorResult
    const contents = await read()
    expect(contents.headings).toContainEqual({ level: 1, text: 'Почта' })
    expect(contents.links).toContainEqual({ text: 'Открыть письмо', href: 'http://forms.reader.test/next' })
    expect(contents.inputs?.find(input => input.type === 'password')?.value).toBe('')
    expect(contents.tables?.[0].rows[1]).toEqual(['Команда', 'Привет'])
    expect(contents.frames).toContainEqual({ selector: '#preview', src: 'http://forms.reader.test/next', title: 'Превью письма', name: 'preview' })
    await mcp('type', { selector: '#subject', text: 'Письмо от модели' })
    expect((await read({ selector: '#subject' })).text).toBe('Письмо от модели')
    expect(await read({ selector: '#long', limit: 100, offset: 5950 })).toMatchObject({ text: '0123456789'.repeat(5), total: 6000, offset: 5950 })
    const found = JSON.parse(await mcp('find', { text: 'Next >> literal', visibleOnly: true })) as BrowserSelectorResult
    await mcp('click', { selector: found.matches![0].selector })
    expect((await read({ selector: '#click-result' })).text).toBe('нажато')
    expect(JSON.parse(await mcp('find', { selector: '.choice', limit: 1, visibleOnly: true }))).toMatchObject({ total: 2, truncated: true, matches: [{ text: 'Видимо', visible: true }] })
    await capture('14-model-structured-reading')
    if (artifacts) await writeFile(join(artifacts, '14-model-read.json'), JSON.stringify(contents, null, 2))
  })

  it('модель ждёт реальную готовность SPA и формы через MCP', async () => {
    await mcp('open', { url: 'http://forms.reader.test/waiting' })
    await mcp('click', { selector: '#begin' })
    const ready = JSON.parse(await mcp('wait', { selector: '#status', text: 'Готово', url: 'http://forms.reader.test/waiting#ready', predicate: 'window.appReady', timeoutMs: 3000 })) as BrowserSelectorResult
    expect(ready).toMatchObject({ ok: true, waitedMs: expect.any(Number), page: { url: 'http://forms.reader.test/waiting#ready' } })
    for (const options of [
      { selector: '#spinner', state: 'hidden' }, { selector: '#spinner', state: 'attached' },
      { selector: '#send', enabled: true }, { selector: '#field', editable: true, value: 'готово' },
      { selector: '#check', checked: true }, { selector: '.row', count: 2 }, { loadState: 'load' }
    ]) expect(JSON.parse(await mcp('wait', options))).toMatchObject({ ok: true })
    await mcp('type', { selector: '#field', text: 'Поле дождалось готовности' })
    expect(JSON.parse(await mcp('read', { selector: '#field' }))).toMatchObject({ text: 'Поле дождалось готовности' })
    await mcp('click', { selector: '#clear' })
    expect(JSON.parse(await mcp('wait', { selector: '#spinner', state: 'detached' }))).toMatchObject({ ok: true })
    expect(JSON.parse(await mcp('wait', { selector: '.row', count: 0 }))).toMatchObject({ ok: true })
    await capture('15-model-waits-for-ready-page')
  })

  it('модель читает компоненты Shadow DOM и нажимает именно найденную кнопку', async () => {
    await mcp('open', { url: 'http://forms.reader.test/shadow' })
    const contents = JSON.parse(await mcp('read')) as BrowserSelectorResult
    expect(contents.headings).toContainEqual({ level: 2, text: 'Теневая форма' })
    expect(contents.text).toContain('Вложенная кнопка')
    expect(contents.text!.split('Действие из слота')).toHaveLength(2)
    expect(contents.text).not.toContain('Скрытый текст компонента')
    expect(contents.inputs).toContainEqual(expect.objectContaining({ selector: '#disabled-field', disabled: true }))
    const field = contents.inputs!.find(input => input.label === 'Внутренняя подпись')!
    await mcp('type', { selector: field.selector, text: 'Модель внутри компонента' })
    expect(JSON.parse(await mcp('read', { selector: field.selector }))).toMatchObject({ text: 'Модель внутри компонента' })
    for (const [text, expected] of [['Теневое действие', 'shadow'], ['Действие из слота', 'slot'], ['Вложенная кнопка', 'nested']]) {
      const found = JSON.parse(await mcp('find', { text })) as BrowserSelectorResult
      await mcp('click', { selector: found.matches![0].selector })
      expect(JSON.parse(await mcp('read', { selector: '#result' }))).toMatchObject({ text: expected })
    }
    await mcp('click', { selector: '.repeat', text: 'Вторая' })
    expect(JSON.parse(await mcp('read', { selector: '#result' }))).toMatchObject({ text: 'second' })
    await mcp('scroll', { to: 'top' })
    await capture('16-model-shadow-components')
    if (artifacts) await writeFile(join(artifacts, '16-model-shadow-read.json'), JSON.stringify(contents, null, 2))
  })

  it('модель работает внутри настоящего превью Make', async () => {
    await api(`/api/make/${chats.make}/notes`, 'PUT', { stack: 'html-js', uiKit: 'none' })
    await api(`/api/make/${chats.make}/file`, 'PUT', { path: 'index.html', content: `<!doctype html><title>Reader внутри Make</title><h1>Форма проекта Make</h1><label>Название <input id="make-value"></label><button id="make-save" onclick="document.getElementById('make-result').textContent=document.getElementById('make-value').value">Проверить</button><p id="make-result">Пусто</p>` })
    await mcp('open', { url: `${base}/#/make/${chats.make}` })
    await mcp('wait', { selector: '.make-frame' })
    let frame: string[] = []
    await expect.poll(async () => {
      const result = JSON.parse(await mcp('frames')) as { frames: Array<{ path: string[]; url: string }> }
      frame = result.frames.find(item => item.url.includes(`/api/preview/make/${chats.make}/`))?.path ?? []
      return frame.length
    }).toBeGreaterThan(0)
    await mcp('wait', { frame, text: 'Форма проекта Make' })
    expect(JSON.parse(await mcp('read', { frame })).text).toContain('Форма проекта Make')
    await mcp('type', { frame, selector: '#make-value', text: 'Проверено моделью' })
    await mcp('click', { frame, selector: '#make-save' })
    expect(JSON.parse(await mcp('read', { frame, selector: '#make-result' })).text).toBe('Проверено моделью')
    await capture('17-model-inside-make-preview')
  })


  it('модель выбирает вложенные документы через MCP, читает стили и делает снимок frame', async () => {
    await mcp('open', { url: 'http://frames.reader.test/' })
    await mcp('wait', { loadState: 'load' })
    const catalog = JSON.parse(await mcp('frames')) as { frames: Array<{ path: string[]; url: string }> }
    const frame = catalog.frames.find(item => item.url === 'http://child.reader.test/frame')!.path
    const nested = catalog.frames.find(item => item.url === 'http://child.reader.test/nested')!.path
    expect(JSON.parse(await mcp('read', { frame, selector: '#field' })).text).toBe('child')
    expect(JSON.parse(await mcp('read', { frame: nested, selector: '#field' })).text).toBe('nested')
    await mcp('wait', { frame, url: 'http://child.reader.test/frame', predicate: 'window.frameMarker === "child"' })
    expect(JSON.parse(await mcp('evaluate', { frame, code: 'window.frameMarker' }))).toMatchObject({ value: 'child' })
    expect(JSON.parse(await mcp('styles', { frame, selector: '#field', properties: ['color'] }))).toMatchObject({ styles: { color: 'rgb(0, 128, 0)' } })
    await mcp('type', { frame, selector: '#field', text: 'Модель в iframe' })
    await mcp('click', { frame: nested, selector: '#nested-action' })
    expect(JSON.parse(await mcp('read', { frame: nested })).text).toContain('Глубокий клик')
    const shot = await mcpReply('screenshot', { frame, selector: 'body' })
    expect(shot.content.find(item => item.type === 'text')?.text).toContain('только видимая часть')
    const picture = shot.content.find(item => item.type === 'image')!
    if (artifacts) await writeFile(join(artifacts, '19-scoped-frame.png'), Buffer.from(picture.data!, 'base64'))
    await capture('18-model-nested-frames')
    await mcp('open', { frame, url: 'http://child.reader.test/next' })
    expect(JSON.parse(await mcp('read', { frame }))).toMatchObject({ text: 'Внутренний переход', page: { url: 'http://frames.reader.test/' }, frame: { url: 'http://child.reader.test/next' } })
  })

  it('модель получает нужную область и полную страницу с точными метаданными снимка', async () => {
    await mcp('open', { url: 'http://forms.reader.test/capture' })
    const shot = async (args: Record<string, unknown>, name: string) => {
      const reply = await mcpReply('screenshot', args)
      const picture = reply.content.find(item => item.type === 'image')!
      expect(picture.mimeType).toBe('image/png')
      const bytes = Buffer.from(picture.data!, 'base64')
      if (artifacts) await writeFile(join(artifacts, `${name}.png`), bytes)
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), text: reply.content.filter(item => item.type === 'text').map(item => item.text).join('\n') }
    }
    const rect = await shot({ rect: { x: 40, y: 900, width: 160, height: 90 }, animations: 'disabled', timeoutMs: 2000 }, '09-model-region')
    expect(rect).toMatchObject({ width: 160, height: 90 })
    expect(rect.text).toContain('x=40, y=900, 160×90')
    expect(rect.text).toContain('http://forms.reader.test/capture')
    expect(rect.text).toContain('Проверка снимков')
    const node = await shot({ selector: '#tile' }, '10-model-element')
    expect(node).toMatchObject({ width: 160, height: 90 })
    expect(node.text).toContain('x=40, y=900')
    const height = (JSON.parse(await mcp('evaluate', { code: 'document.scrollingElement.scrollHeight' })) as { value: number }).value
    expect(height).toBeGreaterThanOrEqual(1800)
    const full = await shot({ fullPage: true }, '11-model-full-page')
    expect(full.height).toBe(height)
    expect(full.text).toContain(`${full.width}×${height}`)
    await mcp('scroll', { to: 'top' })
    await mcp('scroll', { dy: 500 })
    expect((await shot({}, '12-model-scrolled-viewport')).text).toContain('y=500')
    await capture('13-reader-after-model-screenshots')
  })

  it('сценарий модели дочитывает длинное превью Make через MCP и находит ошибку в конце', async () => {
    const text = 'Длинная страница проекта. '.repeat(1500)
    await api(`/api/make/${chats.make}/file`, 'PUT', { path: 'index.html', content: `<!doctype html><title>Длинная проверка Make</title><h1>Проверка отчёта</h1><p>${text}</p><p id="result">Задача создана. Ошибка в подвале</p>` })
    await mcp('open', { url: `${base}/#/make/${chats.make}` })
    await mcp('wait', { selector: '.make-frame' })
    let frame: string[] = []
    await expect.poll(async () => {
      const result = JSON.parse(await mcp('frames')) as { frames: Array<{ path: string[]; url: string }> }
      frame = result.frames.find(item => item.url.includes(`/api/preview/make/${chats.make}/`))?.path ?? []
      return frame.length
    }).toBeGreaterThan(0)
    await mcp('wait', { frame, selector: '#result' })
    const send: ScenarioSend = async command => {
      if (command.type !== 'selector') throw new Error('Ожидалась DOM-команда')
      const { kind, ...args } = command.action
      return JSON.parse(await mcp(kind, { ...args, ...(command.frame ? { frame: command.frame } : {}) }))
    }
    const step = { id: 'long', title: 'Подвал отчёта', action: { kind: 'wait' as const, frame, loadState: 'load' as const } }
    const positive = await runScenarioStep({ ...step, expectText: 'Задача создана' }, send, { expectTimeoutMs: 0 })
    const negative = await runScenarioStep({ ...step, expectAbsentText: 'Ошибка в подвале' }, send, { expectTimeoutMs: 0 })
    expect(positive).toMatchObject({ ok: true })
    expect(negative).toMatchObject({ ok: false, failure: 'expectation', detail: expect.stringContaining('недопустимый текст') })
    await mcp('scroll', { frame, to: 'bottom' })
    if (artifacts) await writeFile(join(artifacts, '20-scenario-mcp-results.json'), JSON.stringify({ positive, negative }, null, 2))
    await capture('20-scenario-make-footer')
  })

  it('панель исполняет проверку первого перехода и останавливается при недоступном стартовом адресе', async () => {
    await mcp('open', { url: 'http://forms.reader.test/next' })
    await expect.poll(() => page.getByRole('textbox', { name: 'Адрес страницы', exact: true }).inputValue(), { timeout: 10_000 }).toBe('http://forms.reader.test/next')
    await page.getByRole('button', { name: 'Записать сценарий', exact: true }).click()
    await page.getByLabel('Ожидаемый текст', { exact: true }).fill('Переход завершён')
    await page.getByRole('button', { name: 'Ждать текст', exact: true }).click()
    await page.getByRole('button', { name: 'Прогнать сценарий', exact: true }).click()
    await page.getByText('прогон: ок', { exact: true }).waitFor()
    await capture('21-scenario-first-expectation')
    const pattern = '**/api/browser/*/command'
    let checks = 0
    await page.route(pattern, async route => {
      const body = route.request().postDataJSON()
      if (body.command?.type === 'navigate') {
        // Настоящий отказ политики раннера вместо поддельного успешного ответа.
        return route.continue({ postData: JSON.stringify({ ...body, command: { type: 'navigate', url: 'http://127.0.0.1:1/' } }) })
      }
      if (body.command?.type === 'selector') checks++
      return route.continue()
    })
    try {
      await page.getByRole('button', { name: 'Прогнать сценарий', exact: true }).click()
      await page.getByText(/Стартовый адрес не открылся/).waitFor()
      expect(checks).toBe(0)
      expect(await page.getByText('прогон: ок', { exact: true }).count()).toBe(0)
      await capture('22-scenario-blocked-navigation')
    } finally { await page.unroute(pattern); await page.getByLabel('Очистить запись', { exact: true }).click() }
  })

  it('вход в собственный проект, URL и размер окна сохраняются после перезапуска и открытия панели', async () => {
    const url = `${base}/#/chat/${chats.chat}`
    await mcp('open', { url })
    await mcp('wait', { selector: '.chat-page' })
    await page.getByRole('button', { name: 'Телефон', exact: true }).click()
    await expect.poll(async () => JSON.parse(await mcp('evaluate', { code: 'innerWidth' })).value).toBe(390)
    const priorIncarnation = JSON.parse(await mcp('tabs')).incarnation
    await page.getByRole('button', { name: 'Перезапустить', exact: true }).click()
    await expect.poll(() => page.getByRole('textbox', { name: 'Адрес страницы', exact: true }).isEnabled(), { timeout: 15000 }).toBe(true)
    await mcp('wait', { selector: '.chat-page' })
    expect(JSON.parse(await mcp('tabs')).incarnation).not.toBe(priorIncarnation)
    expect(JSON.parse(await mcp('evaluate', { code: 'innerWidth' })).value).toBe(390)
    expect(await page.getByRole('textbox', { name: 'Адрес страницы', exact: true }).inputValue()).toBe(url)
    await page.reload()
    await page.getByRole('textbox', { name: 'Адрес страницы', exact: true }).waitFor()
    await expect.poll(() => page.getByRole('textbox', { name: 'Адрес страницы', exact: true }).isEnabled(), { timeout: 15000 }).toBe(true)
    await mcp('wait', { selector: '.chat-page' })
    expect(JSON.parse(await mcp('evaluate', { code: 'innerWidth' })).value).toBe(390)
    await capture('23-project-persistent-login')
  })

  it('модель восстанавливает сессионную cookie, затем полностью очищает данные сайта', async () => {
    await mcp('open', { url: 'http://profile.reader.test/account#details' })
    await mcp('click', { selector: '#login' })
    await mcp('wait', { text: 'Тестовый вход сохранён' })
    const priorIncarnation = JSON.parse(await mcp('tabs')).incarnation
    await page.getByRole('button', { name: 'Перезапустить', exact: true }).click()
    await expect.poll(() => page.getByRole('textbox', { name: 'Адрес страницы', exact: true }).isEnabled(), { timeout: 15000 }).toBe(true)
    await mcp('wait', { selector: '#login' })
    expect(JSON.parse(await mcp('tabs')).incarnation).not.toBe(priorIncarnation)
    const before = JSON.parse(await mcp('evaluate', { code: 'window.profileState()' })).value
    expect(before).toMatchObject({ cookies: { session: true, persistent: true, path: true }, local: 'test-user', databases: ['reader-auth'], caches: ['reader-cache'], workers: 1 })
    const cleared = JSON.parse(await mcp('reset-session', { host: 'profile.reader.test' }))
    // Стенды используют один loopback host с разными портами: cookie не разделяются по порту.
    expect(cleared).toMatchObject({ ok: true, clearedOrigins: ['http://profile.reader.test'] })
    expect(cleared.clearedCookies).toBeGreaterThanOrEqual(3)
    const after = JSON.parse(await mcp('evaluate', { code: 'window.profileState()' })).value
    expect(after).toMatchObject({ cookies: { session: false, persistent: false, path: false }, local: null, databases: [], caches: [], workers: 0 })
    if (artifacts) await writeFile(join(artifacts, '24-profile-reset.json'), JSON.stringify({ before, cleared, after }, null, 2))
  })

  it('кнопка панели очищает cookie и хранилища с перезагрузкой страницы', async () => {
    await mcp('click', { selector: '#login' })
    await mcp('wait', { text: 'Тестовый вход сохранён' })
    await page.getByRole('button', { name: 'Очистить сессию сайта', exact: true }).click()
    await expect.poll(async () => (await mcp('read')).includes('Вход не выполнен'), { timeout: 10000 }).toBe(true)
    expect(JSON.parse(await mcp('evaluate', { code: 'window.profileState()' })).value).toMatchObject({ cookies: { session: false, persistent: false, path: false }, local: null, session: null, databases: [], caches: [], workers: 0 })
    await capture('25-profile-cleared-from-panel')
  })

  it('панель передаёт колесо, сочетания клавиш, paste и двойной клик без лишних событий', async () => {
    await mcp('open', { url: 'http://input.reader.test/' })
    await page.getByRole('button', { name: 'Десктоп', exact: true }).click()
    await expect.poll(async () => JSON.parse(await mcp('evaluate', { code: 'innerWidth' })).value).toBe(1280)
    const frame = page.locator('img[alt="Кадр Chromium"]')
    await expect.poll(() => frame.evaluate(image => (image as HTMLImageElement).naturalWidth), { timeout: 10000 }).toBe(1280)
    const point = async (x: number, y: number) => {
      const box = await frame.boundingBox()
      if (!box) throw new Error('Кадр недоступен')
      return { x: box.x + x * box.width / 1280, y: box.y + y * box.height / 800 }
    }
    const wheel = await point(400, 250)
    await page.mouse.move(wheel.x, wheel.y)
    await page.mouse.wheel(80, 180)
    await expect.poll(async () => JSON.parse(await mcp('evaluate', { code: '({ left: document.querySelector("#pane").scrollLeft, top: document.querySelector("#pane").scrollTop })' })).value, { timeout: 10000 }).toEqual({ left: 80, top: 180 })
    const field = await point(90, 30)
    await page.mouse.click(field.x, field.y)
    await frame.press('ControlOrMeta+a')
    await frame.press('A')
    await frame.press('Z')
    await expect.poll(async () => JSON.parse(await mcp('evaluate', { code: 'document.querySelector("#field").value' })).value).toBe('AZ')
    const message = await point(750, 60)
    await page.mouse.click(message.x, message.y)
    await frame.evaluate(element => {
      const data = new DataTransfer(); data.setData('text/plain', 'Письмо\n😀')
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: data }))
    })
    await expect.poll(async () => JSON.parse(await mcp('evaluate', { code: 'document.querySelector("#message").value' })).value).toBe('Письмо\n😀')
    await mcp('evaluate', { code: 'events=[]' })
    const button = await point(330, 40)
    await page.mouse.dblclick(button.x, button.y)
    await expect.poll(async () => JSON.parse(await mcp('evaluate', { code: 'events.filter(e=>e.type==="click").length' })).value).toBe(2)
    expect(JSON.parse(await mcp('evaluate', { code: 'events.filter(e=>e.type==="dblclick").length' })).value).toBe(1)
    await capture('26-keyboard-paste-doubleclick')
  })

  it('модель прокручивает обе оси контейнера и получает фактическую позицию', async () => {
    expect(JSON.parse(await mcp('scroll', { selector: '#pane', dx: 170, dy: 20 }))).toMatchObject({ ok: true, scrolled: { left: 250, top: 200 } })
    expect(JSON.parse(await mcp('scroll', { frame: '#frame', selector: '#pane', dx: 250, dy: 40 }))).toMatchObject({ ok: true, scrolled: { left: 250, top: 40 } })
    await capture('27-horizontal-scroll')
  })

  it('модель получает confirm и prompt, человек видит их и результат явного ответа', async () => {
    await mcp('open', { url: 'http://dialog.reader.test/' })
    const started = Date.now()
    const blocked = await mcpReply('click', { selector: '#confirm' }, true)
    expect(blocked.content.map(item => item.text).join(' ')).toContain('Открыт диалог confirm')
    expect(Date.now() - started).toBeLessThan(3000)
    const confirmation = JSON.parse(await mcp('dialogs')).dialogs[0]
    expect(confirmation).toMatchObject({ type: 'confirm', message: 'Подтвердить действие?' })
    await page.getByRole('dialog', { name: 'Диалог сайта' }).waitFor()
    if (artifacts) await page.screenshot({ path: join(artifacts, '28-confirm-awaits-answer.png'), fullPage: true })
    await mcp('handle-dialog', { dialogId: confirmation.id, accept: false })
    await expect.poll(async () => page.getByRole('dialog', { name: 'Диалог сайта' }).count(), { timeout: 10000 }).toBe(0)
    expect(await mcp('read', { selector: '#result' })).toContain('confirm:false')
    await mcpReply('click', { selector: '#prompt' }, true)
    const prompt = JSON.parse(await mcp('dialogs')).dialogs[0]
    expect(prompt.defaultValue).toBe('Черновик')
    await mcp('handle-dialog', { dialogId: prompt.id, accept: true, promptText: 'Документ модели' })
    expect(await mcp('read', { selector: '#result' })).toContain('prompt:Документ модели')
    await capture('29-model-answered-prompt')
  })

  it('панель отвечает на alert и prompt, затем оставляет защищённую страницу открытой', async () => {
    await mcpReply('click', { selector: '#alert' }, true)
    let dialog = page.getByRole('dialog', { name: 'Диалог сайта' })
    await dialog.getByRole('button', { name: 'ОК', exact: true }).click()
    await expect.poll(async () => JSON.parse(await mcp('dialogs')).total).toBe(0)
    expect(await mcp('read', { selector: '#result' })).toContain('alert completed')
    await mcpReply('click', { selector: '#prompt' }, true)
    expect(JSON.parse(await mcp('dialogs')).dialogs[0]?.type).toBe('prompt')
    dialog = page.getByRole('dialog', { name: 'Диалог сайта' })
    await dialog.getByLabel('Ответ сайту').fill('Название пользователя')
    if (artifacts) await page.screenshot({ path: join(artifacts, '30-human-prompt.png'), fullPage: true })
    await dialog.getByRole('button', { name: 'ОК', exact: true }).click()
    await expect.poll(async () => JSON.parse(await mcp('dialogs')).total).toBe(0)
    expect(await mcp('read', { selector: '#result' })).toContain('prompt:Название пользователя')
    await mcp('click', { selector: '#guard' })
    await mcpReply('open', { url: 'http://dialog.reader.test/next' }, true)
    await page.getByRole('dialog', { name: 'Покинуть страницу?' }).getByRole('button', { name: 'Остаться' }).click()
    await expect.poll(async () => JSON.parse(await mcp('dialogs')).total).toBe(0)
    expect(JSON.parse(await mcp('tabs')).currentUrl).toBe('http://dialog.reader.test/')
    await mcpReply('open', { url: 'http://dialog.reader.test/next' }, true)
    await page.getByRole('dialog', { name: 'Покинуть страницу?' }).getByRole('button', { name: 'Покинуть страницу', exact: true }).click()
    await expect.poll(async () => JSON.parse(await mcp('tabs')).currentUrl).toBe('http://dialog.reader.test/next')
    await capture('31-human-chose-navigation')
  })

  it('модель скачивает отчёт, дочитывает файл и открывает прямой адрес вложения', async () => {
    await mcp('open', { url: 'http://downloads.reader.test/' })
    await mcp('click', { selector: '#file' })
    let file: { id: string; state: string; filename: string } | undefined
    await expect.poll(async () => { file = JSON.parse(await mcp('downloads')).downloads.find((item: { filename: string }) => item.filename === 'Отчёт.txt'); return file?.state }).toBe('completed')
    let text = '', offset = 0
    for (let i = 0; i < 6; i++) {
      const part = JSON.parse(await mcp('read-download', { downloadId: file!.id, offset }))
      text += part.text
      if (part.nextOffset === undefined) break
      offset = part.nextOffset
    }
    expect(text).toBe('Начало 😀\n' + 'Строка отчёта\n'.repeat(2200) + 'Конец')
    await mcp('open', { url: 'http://downloads.reader.test/file' })
    expect(JSON.parse(await mcp('downloads')).total).toBe(2)
    await capture('32-model-downloaded-report')
  })

  it('панель сохраняет исходный бинарный файл, отменяет поток и удаляет скачивание', async () => {
    await mcp('click', { selector: '#binary' })
    let file: { id: string; state: string; filename: string } | undefined
    await expect.poll(async () => { file = JSON.parse(await mcp('downloads')).downloads.find((item: { filename: string }) => item.filename === 'data.bin'); return file?.state }).toBe('completed')
    expect(Buffer.from(JSON.parse(await mcp('read-download', { downloadId: file!.id, encoding: 'base64' })).base64, 'base64')).toEqual(Buffer.from([0,255,1,2,3,128]))
    await page.getByRole('button', { name: /^Скачивания/ }).click()
    const panel = page.getByRole('region', { name: 'Скачивания', exact: true })
    const pending = page.waitForEvent('download')
    await panel.getByRole('button', { name: 'Скачать data.bin', exact: true }).click()
    const saved = await pending
    expect(saved.suggestedFilename()).toBe('data.bin')
    const stream = await saved.createReadStream(); if (!stream) throw new Error('Saved file unavailable')
    const parts: Buffer[] = []; for await (const part of stream) parts.push(Buffer.from(part))
    expect(Buffer.concat(parts)).toEqual(Buffer.from([0,255,1,2,3,128]))
    await mcp('click', { selector: '#slow' })
    await panel.getByRole('button', { name: 'Отменить скачивание slow.bin', exact: true }).click()
    await expect.poll(async () => JSON.parse(await mcp('downloads')).downloads.find((item: { filename: string }) => item.filename === 'slow.bin')?.state).toBe('canceled')
    await panel.getByRole('button', { name: 'Удалить скачивание data.bin', exact: true }).click()
    await expect.poll(async () => JSON.parse(await mcp('downloads')).downloads.some((item: { id: string }) => item.id === file!.id)).toBe(false)
    const missing = await mcpReply('read-download', { downloadId: file!.id }, true)
    expect(missing.content.map(item => item.text).join(' ')).toContain('stale_download')
    await capture('33-human-download-controls')
  })

  it('экспорт Blob из настоящего iframe Make доступен модели как файл', async () => {
    await api(`/api/make/${chats.make}/file`, 'PUT', { path: 'index.html', content: `<!doctype html><title>Экспорт проекта</title><h1>Файл из Make</h1><button id="export" onclick="const link=document.createElement('a');link.href=window.URL.createObjectURL(new Blob(['Проект Make 😀'],{type:'text/plain'}));link.download='make-export.txt';link.click()">Экспортировать проект</button>` })
    await mcp('open', { url: `${base}/#/make/${chats.make}` })
    // Предыдущая проверка reset-session очищает cookie loopback-хоста, включая
    // тестовый вход ядра на другом порту. Вход здесь проверяется заново.
    await mcp('wait', { selector: '.app--make, input[aria-label="Пользователь"]' })
    if (JSON.parse(await mcp('evaluate', { code: 'Boolean(document.querySelector(\'input[aria-label="Пользователь"]\'))' })).value) {
      await mcp('type', { selector: 'input[aria-label="Пользователь"]', text: 'admin' })
      await mcp('type', { selector: 'input[aria-label="Пароль"]', text: PASSWORD })
      await mcp('click', { selector: 'button[type="submit"]' })
    }
    await mcp('wait', { selector: '.make-frame' })
    let frame: string[] = []
    await expect.poll(async () => { frame = JSON.parse(await mcp('frames')).frames.find((item: { url: string }) => item.url.includes(`/api/preview/make/${chats.make}/`))?.path ?? []; return frame.length }).toBeGreaterThan(0)
    await mcp('wait', { frame, text: 'Файл из Make' })
    await mcp('click', { frame, selector: '#export' })
    let file: { id: string; state: string } | undefined
    await expect.poll(async () => { file = JSON.parse(await mcp('downloads')).downloads.find((item: { filename: string }) => item.filename === 'make-export.txt'); return file?.state }).toBe('completed')
    expect(JSON.parse(await mcp('read-download', { downloadId: file!.id })).text).toBe('Проект Make 😀')
    await capture('34-make-export-download')
  })

  it('диагностика модели видит реальные сбои, literal warn, курсор и страницы журнала', async () => {
    await mcp('new-tab', { url: 'http://diag.reader.test/' })
    await mcp('click', { selector: '#logs' })
    expect(JSON.parse(await mcp('console', { level: 'warn' })).console[0].text).toBe('Warning marker')
    expect(JSON.parse(await mcp('console', { pattern: 'literal [x]' })).console).toHaveLength(1)
    await mcp('click', { selector: '#network' })
    await mcp('wait', { selector: 'output', text: 'Requests finished' })
    const failed = JSON.parse(await mcp('network', { failedOnly: true, filter: 'diag.reader.test' }))
    expect(failed.network).toHaveLength(2)
    expect(failed.network.find((row: any) => row.url.endsWith('/broken'))).toMatchObject({ state: 'failed', status: 0, error: expect.stringContaining('ERR_') })
    await mcp('click', { selector: '#error' })
    await expect.poll(async () => JSON.parse(await mcp('console', { level: 'error' })).console.some((row: any) => row.stack?.includes('diag.reader.test'))).toBe(true)
    const errors = JSON.parse(await mcp('console', { level: 'error' }))
    await mcp('click', { selector: '#spam' })
    const latest = JSON.parse(await mcp('console', { level: 'error', since: errors.cursor, limit: 100 }))
    expect(latest).toMatchObject({ total: 100, truncated: true })
    expect(JSON.parse(await mcp('console', { before: latest.nextBefore, since: errors.cursor, level: 'error' })).console.length).toBeGreaterThan(0)
    const selected = JSON.parse(await mcp('tabs')).activeTabId
    await mcp('new-tab', { url: 'http://diag.reader.test/other' })
    expect(JSON.parse(await mcp('console')).console).toHaveLength(0)
    expect(JSON.parse(await mcp('console', { tabId: selected, level: 'warn', clear: true })).cleared).toBe(1)
    expect(JSON.parse(await mcp('console', { tabId: selected, level: 'error' })).total).toBeGreaterThanOrEqual(100)
    await mcp('select-tab', { tabId: selected })
    await expect.poll(async () => page.getByRole('tab', { name: 'Диагностика /', exact: true }).getAttribute('aria-selected'), { timeout: 10000 }).toBe('true')
    if (await page.getByRole('region', { name: 'Скачивания' }).count()) await page.getByRole('button', { name: /^Скачивания/ }).click()
    await page.getByText('Ошибки страницы', { exact: true }).click()
    await expect.poll(async () => page.getByRole('region', { name: 'Диагностика страницы' }).textContent(), { timeout: 10000 }).toContain('ERR_')
    await capture('35-network-diagnostics')
    await page.getByLabel('Скрыть диагностику').click()
  })

  it('на странице нашего проекта диагностика показывает источник и восстанавливается после HTTP-сбоя чтения', async () => {
    await mcp('open', { url: `${base}/#/chat/${chats.chat}` })
    if (JSON.parse(await mcp('find', { selector: 'input[type="password"]' })).elements?.length) {
      await mcp('set', { selector: 'input[placeholder="Логин"]', value: 'admin' })
      await mcp('set', { selector: 'input[type="password"]', value: PASSWORD })
      await mcp('click', { selector: 'button[type="submit"]' })
    }
    await mcp('evaluate', { code: 'console.error("Ошибка теста собственного проекта")' })
    await page.route(`**/api/browser/${conversationId}/command`, async route => {
      const body = route.request().postDataJSON()
      if (body.command?.type === 'inspect') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'runner_unavailable', message: 'Логи временно недоступны' } }) })
      else await route.continue()
    })
    await page.getByText('Ошибки страницы', { exact: true }).click()
    await expect.poll(async () => page.getByRole('region', { name: 'Диагностика страницы' }).textContent()).toContain('Диагностика недоступна')
    expect(await page.getByText('Страница не жаловалась.').count()).toBe(0)
    await page.unroute(`**/api/browser/${conversationId}/command`)
    await page.getByLabel('Обновить диагностику').click()
    await expect.poll(async () => page.getByRole('region', { name: 'Диагностика страницы' }).textContent()).toContain('Ошибка теста собственного проекта')
    await capture('36-project-diagnostics-recovered')
  })

  it('evaluate восстанавливает настоящее превью Make после sync/async timeout и описывает его DOM', async () => {
    await api(`/api/make/${chats.make}/file`, 'PUT', { path: 'index.html', content: '<!doctype html><title>Evaluate Make</title><h1>Файл из Make</h1>' })
    await mcp('new-tab', { url: `${base}/#/make/${chats.make}` })
    await mcp('wait', { selector: '.make-frame', timeoutMs: 10000 })
    await mcp('wait', { frame: '.make-frame', selector: 'h1', text: 'Файл из Make', timeoutMs: 5000 })
    for (const code of ['while(true){}', 'new Promise(()=>{})']) {
      const result = await mcpReply('evaluate', { frame: '.make-frame', code, timeoutMs: 150 }, true)
      expect(result.content[0].text).toContain('лимит времени')
      const recovered = JSON.parse(await mcp('evaluate', { frame: '.make-frame', code: 'document.querySelector("h1")' }))
      expect(recovered.value).toMatchObject({ $type: 'Element', tag: 'h1', text: 'Файл из Make' })
      expect(recovered.valueFormat).toBe('preview')
    }
    const complex = JSON.parse(await mcp('evaluate', { frame: '.make-frame', code: '(()=>{const x={name:"Make"};x.self=x;return new Map([["state",x],["count",123n]])})()' }))
    expect(complex.value.entries[0][1]).toMatchObject({ name: 'Make', self: { $ref: '/value/entries/0/1' } })
    expect(complex.value.entries[1][1]).toEqual({ $type: 'bigint', value: '123' })
    const large = JSON.parse(await mcp('evaluate', { code: '"\\u0000".repeat(20000)' }))
    expect(large).toMatchObject({ truncated: true, valueFormat: 'preview-json' })
    expect(JSON.stringify(large).length).toBeLessThan(21000)
    await capture('37-evaluate-make-recovered')
  })

  it('человек отвечает на prompt позднее deadline evaluate и получает результат на странице', async () => {
    await mcp('open', { url: 'http://dialog.reader.test/' })
    const response = await mcpReply('evaluate', { code: 'document.querySelector("#result").textContent=prompt("Как назвать проект?","Черновик")', timeoutMs: 100 }, true)
    expect(response.content[0].text).toContain('Открыт диалог')
    await page.waitForTimeout(350)
    const dialog = page.getByRole('dialog', { name: 'Диалог сайта' })
    await expect.poll(async () => dialog.count(), { timeout: 10000 }).toBe(1)
    await dialog.getByRole('textbox').fill('Имя после паузы')
    if (artifacts) await page.screenshot({ path: join(artifacts, '39-evaluate-dialog-paused.png'), fullPage: true })
    await dialog.getByRole('button', { name: 'ОК', exact: true }).click()
    await expect.poll(async () => JSON.parse(await mcp('read', { selector: '#result' })).text, { timeout: 10000 }).toBe('Имя после паузы')
    await capture('38-evaluate-human-dialog')
  })

})

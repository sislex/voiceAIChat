// Настоящий App, сервер, MCP и отдельный Chromium раннера; внешние аккаунты не нужны.
import { createServer } from 'node:net'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { buildBrowserRunner } from '../apps/browser-runner/src/server.js'
import { buildServer } from '../apps/server/src/server.js'
import { loadConfig } from '../apps/server/src/config.js'
import { createPreviewTurnTokens } from '@voicechat/web-reader-contracts'
import type { BrowserCommand, BrowserSessionMetadata } from '@voicechat/shared/types'

let app: FastifyInstance, runner: FastifyInstance, site: FastifyInstance, browser: Browser, page: Page
let base: string, token: string, id: string, data: string, native: BrowserSessionMetadata
let browserFailures: string[] = []
const secret = 'reader-native-fixture-secret', target = 'http://93.184.216.34:8080/page'
const api = async (path: string, method = 'GET', body?: unknown) => {
  const response = await fetch(base + path, { method, headers: { authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const result = await response.json(); expect(response.ok, JSON.stringify(result)).toBe(true); return result
}
const command = (command: BrowserCommand) => api('/api/browser/' + id + '/command', 'POST', { incarnation: native.incarnation, command })
const mcp = async (name: string, args: Record<string, unknown> = {}) => {
  const turn = createPreviewTurnTokens(secret).issue({ userId: 'admin', conversationId: id })
  const response = await fetch(base + '/mcp/preview?k=' + secret + '&turn=' + turn, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })
  const result = (await response.json()).result; expect(result.isError, JSON.stringify(result)).not.toBe(true)
  return JSON.parse(result.content.find((item: { type: string }) => item.type === 'text').text)
}
const start = async () => {
  await page.getByRole('combobox', { name: 'Движок Web Reader' }).selectOption('chromium')
  await page.getByAltText('Кадр Chromium').waitFor()
  native = await api('/api/browser/' + id + '/start', 'POST', {})
}

describe('Web Reader: единый разговор в полном Chromium', () => {
  beforeAll(async () => {
    data = await mkdtemp(join(tmpdir(), 'vc-reader-native-'))
    const reservation = createServer(); await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
    const address = reservation.address(); if (!address || typeof address === 'string') throw new Error('Нет порта')
    const port = address.port; await new Promise<void>(resolve => reservation.close(() => resolve())); base = 'http://127.0.0.1:' + port
    site = Fastify()
    site.get('/page', async (_req, reply) => reply.header('content-security-policy', "frame-ancestors 'none'").header('x-frame-options', 'DENY').type('text/html; charset=utf-8').send(`<!doctype html><title>Native Reader QA</title><h1>Native Reader QA</h1><label>Имя<input id="name" oninput="document.querySelector('output').textContent=this.value"></label><button id="next" onclick="history.pushState({},'', '?step=2#/next');document.title='Следующая страница'">Дальше</button><output>initial</output><script>window.marker=Math.random()</script>`))
    await site.listen({ host: '127.0.0.1', port: 0 })
    const siteAddress = site.server.address(); if (!siteAddress || typeof siteAddress === 'string') throw new Error('Нет адреса сайта')
    runner = await buildBrowserRunner({ token: secret, profilesRoot: join(data, 'profiles'), hostAliases: new Map([['93.184.216.34:8080', '127.0.0.1:' + siteAddress.port]]), previewOrigin: '127.0.0.1:' + port, idleMs: 0 })
    const runnerBase = await runner.listen({ host: '127.0.0.1', port: 0 })
    app = await buildServer({ config: loadConfig({ ...process.env, PORT: String(port), HOST: '127.0.0.1', VC_DATA_DIR: data, VC_ADMIN_PASSWORD: secret, VC_WEB_DIR: resolve('apps/web/dist'), VC_WEB_RECORDER_DIR: resolve('apps/web-recorder/dist'), VC_MCP_SECRET: secret, VC_BROWSER_RUNNER_URL: runnerBase, VC_BROWSER_RUNNER_TOKEN: secret, VC_BROWSER_PREVIEW_BASE: base }) })
    await app.listen({ host: '127.0.0.1', port })
    const login = await fetch(base + '/api/session/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'admin', password: secret }) }); token = (await login.json()).token
    await api('/api/settings', 'PUT', { onboarded: true, theme: 'green' }); browser = await chromium.launch()
  })
  beforeEach(async () => {
    const created = await api('/api/conversations', 'POST', { title: 'Native Reader QA', assistantKind: 'web-recorder' }); id = created.id ?? created.conversation.id
    browserFailures = []
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(12_000)
    page.on('pageerror', error => browserFailures.push(error.message))
    page.on('response', response => { if (response.url().includes('/api/browser/') && response.status() >= 400) void response.text().then(text => browserFailures.push(response.status() + ' ' + new URL(response.url()).pathname + ' ' + text)).catch(() => {}) })
    // Сессия как после входа: initScript возвращал удалённый legacy-токен при
    // каждом reload и провоцировал повторную миграцию с ротацией CSRF.
    const session = await page.request.post(base + '/api/session/cookie', { headers: { authorization: 'Bearer ' + token } })
    expect(session.ok()).toBe(true)
    await page.goto(base + '/#/web-reader/' + id)
    await page.getByRole('combobox', { name: 'Движок Web Reader' }).waitFor()
  })
  afterEach(async context => {
    if (context.task.result?.state === 'fail' && page && !page.isClosed()) {
      const report = { test: context.task.name, errors: browserFailures, body: (await page.locator('body').innerText()).slice(0, 6000), frames: await Promise.all(page.frames().map(async frame => ({url:frame.url(), html:(await frame.content().catch(()=>'' )).slice(0,20000)}))), surfaces:await page.locator('iframe, .webpreview, [role=status], [role=alert]').evaluateAll(elements=>elements.map(el=>({html:el.outerHTML,rect:el.getBoundingClientRect().toJSON(),display:getComputedStyle(el).display}))) }
      const directory = process.env.VC_VISUAL_ARTIFACTS || '/tmp/reader-cycle-artifacts'
      await mkdir(directory, { recursive: true }); await writeFile(join(directory, 'failure.json'), JSON.stringify(report, null, 2)); await page.screenshot({ path: join(directory, 'failure.png') })
    }
    await page?.close(); if (id) await fetch(base + '/api/browser/' + id, { method: 'DELETE', headers: { authorization: 'Bearer ' + token } }) })
  afterAll(async () => { await browser?.close(); await app?.close(); await runner?.close(); await site?.close(); if (data) await rm(data, { recursive: true, force: true }) })
  it('пользователь переключает движок и выбор остаётся в разговоре', async () => {
    await start(); expect((await api('/api/conversations/' + id + '?scope=web-reader')).conversation).toMatchObject({ assistantKind: 'web-recorder', previewEngine: 'chromium' })
    await page.reload(); await page.getByAltText('Кадр Chromium').waitFor(); expect(await page.getByRole('combobox', { name: 'Движок Web Reader' }).inputValue()).toBe('chromium')
  })
  it('первый запуск открывает ранее сохранённый URL', async () => {
    await api('/api/conversations/' + id + '/preview-url', 'POST', { previewUrl: target, previewEngine: 'chromium' }); await page.reload()
    await page.getByAltText('Кадр Chromium').waitFor()
    await expect.poll(() => page.getByRole('textbox', { name: 'Адрес страницы' }).inputValue(), { timeout: 6000 }).toBe(target)
  })
  it('модель читает страницу с запретом iframe в том же Chromium', async () => {
    await start(); await mcp('open', { url: target }); expect(await mcp('read')).toMatchObject({ text: expect.stringContaining('Native Reader QA') })
    await expect.poll(() => page.getByRole('textbox', { name: 'Адрес страницы' }).inputValue(), { timeout: 6000 }).toBe(target)
  })
  it('model audits the native document through MCP while the user owns control', async () => {
    await start(); await mcp('open', { url: target })
    await page.getByRole('button', { name: 'Взять управление', exact: true }).click()
    await page.getByText('Управление у вас.', { exact: false }).waitFor()
    try {
      const result = await mcp('audit', { rules: ['document-language-missing'] })
      expect(result).toMatchObject({ ok: true, page: { url: target }, audit: { surface: 'chromium', total: 1, findings: [expect.objectContaining({ id: 'document-language-missing' })] } })
      expect((await mcp('audit', { group: 'layout', mode: 'list', limit: 30 })).audit.rules).toHaveLength(30)
      expect((await command({ type: 'status' })).control).toBe('user')
      await expect.poll(() => page.getByRole('button', { name: 'Вернуть управление модели' }).isVisible()).toBe(true)
    } finally { await page.getByRole('button', { name: 'Вернуть управление модели' }).click() }
  })
  it('ввод модели виден пользователю и обычным browser-командам', async () => {
    await start(); await mcp('open', { url: target }); await mcp('type', { selector: '#name', text: 'Привет от модели' })
    expect(await command({ type: 'selector', action: { kind: 'read', selector: 'output' } })).toMatchObject({ text: 'Привет от модели' })
    const shot = await api('/api/browser/' + id + '/screenshot', 'POST', { incarnation: native.incarnation }); expect(shot.dataUrl).toMatch(/^data:image\//)
  })
  it('пользовательский ввод в кадре читает модель', async () => {
    await start(); await mcp('open', { url: target })
    await command({ type: 'selector', action: { kind: 'click', selector: '#name' } }); await command({ type: 'input', action: { type: 'type', text: 'От пользователя' } })
    expect(await mcp('read', { selector: 'output' })).toMatchObject({ text: 'От пользователя' })
  })
  it('SPA после click модели обновляет URL и БД без перезагрузки страницы', async () => {
    await start(); await mcp('open', { url: target })
    const before = await command({ type: 'inspect', action: { kind: 'evaluate', code: 'window.marker' } })
    await mcp('click', { selector: '#next' })
    await expect.poll(async () => (await api('/api/conversations/' + id + '?scope=web-reader')).conversation.previewUrl, { timeout: 6000 }).toBe(target + '?step=2#/next')
    expect(before).toMatchObject({ ok: true, valueType: 'number' })
    // Время выполнения каждого evaluate различается; перезагрузку выявляет marker.
    expect(await command({ type: 'inspect', action: { kind: 'evaluate', code: 'window.marker' } })).toMatchObject({ ok: true, value: before.value, valueType: 'number' })
  })
  it('обновление кадра не стирает редактируемый адрес', async () => {
    await start(); await mcp('open', { url: target }); const input = page.getByRole('textbox', { name: 'Адрес страницы' })
    await input.fill('https://draft.example/'); await mcp('click', { selector: '#next' })
    await expect.poll(async () => (await api('/api/conversations/' + id + '?scope=web-reader')).conversation.previewUrl, { timeout: 6000 }).toBe(target + '?step=2#/next')
    expect(await input.inputValue()).toBe('https://draft.example/')
  })
  it('текущий проект открывается моделью с cookie через доверенный origin', async () => {
    await start(); const previousFrame = await page.getByAltText('Кадр Chromium').getAttribute('src'); expect(await mcp('open', { url: 'https://app.internal/#/machines' })).toMatchObject({ currentUrl: 'https://app.internal/#/machines' })
    expect(await mcp('read')).toMatchObject({ text: expect.stringContaining('Войти') })
    await expect.poll(() => page.getByRole('textbox', { name: 'Адрес страницы' }).inputValue(), { timeout: 6000 }).toBe('https://app.internal/#/machines')
    await expect.poll(() => page.getByAltText('Кадр Chromium').getAttribute('src'), { timeout: 6000 }).not.toBe(previousFrame)
    await page.getByAltText('Кадр Chromium').evaluate(el => (el as HTMLImageElement).decode())
    if (process.env.VC_VISUAL_ARTIFACTS) { await mcp('wait', { selector: 'input[type=password]', timeoutMs: 6000 }); await page.waitForResponse(response => response.url().endsWith('/screenshot') && response.request().method() === 'POST'); await page.waitForResponse(response => response.url().endsWith('/screenshot') && response.request().method() === 'POST'); await page.getByAltText('Кадр Chromium').evaluate(el => (el as HTMLImageElement).decode()); await mkdir(process.env.VC_VISUAL_ARTIFACTS, { recursive: true }); await page.screenshot({ path: join(process.env.VC_VISUAL_ARTIFACTS, 'reader-native.png') }) }
  })
  it('Chromium пропускает скрытую копию и отклоняет две видимые цели без клика', async () => {
    await start(); await mcp('open', { url: target })
    expect(await command({ type: 'inspect', action: { kind: 'evaluate', code: `document.body.insertAdjacentHTML('afterbegin', '<input class="strict-input" style="display:none"><input class="strict-input"><button class="duplicate" onclick="window.badClick=true">Копия</button><button class="duplicate" onclick="window.badClick=true">Копия</button>'); document.querySelectorAll('.strict-input')[1].oninput = event => document.querySelector('output').textContent = event.target.value` } })).toMatchObject({ ok: true })
    await mcp('type', { selector: '.strict-input', text: 'Только видимое поле' })
    expect(await mcp('read', { selector: 'output' })).toMatchObject({ text: 'Только видимое поле' })
    expect(await command({ type: 'selector', action: { kind: 'click', selector: '.duplicate' } })).toMatchObject({ ok: false, error: expect.stringContaining('несколько') })
    expect(await command({ type: 'inspect', action: { kind: 'evaluate', code: 'Boolean(window.badClick)' } })).toMatchObject({ value: false })
  })
  it('ссылка find сохраняет узел после перестановки и отклоняет его DOM-копию', async () => {
    await start(); await mcp('open', { url: target })
    const found = await mcp('find', { selector: 'button' })
    const selector = found.matches[0].selector
    expect(selector).toContain('data-voicechat-reader-ref')
    await command({ type: 'inspect', action: { kind: 'evaluate', code: `document.body.prepend(document.createElement('button')); document.body.append(document.querySelector('#next'))` } })
    await mcp('click', { selector })
    expect(await command({ type: 'status' })).toMatchObject({ currentUrl: target + '?step=2#/next' })
    await command({ type: 'inspect', action: { kind: 'evaluate', code: `const el=document.querySelector('#next'); el.replaceWith(el.cloneNode(true))` } })
    expect(await command({ type: 'selector', action: { kind: 'click', selector } })).toMatchObject({ ok: false, error: expect.stringContaining('stale_element_ref') })
  })
  it('ручное управление блокирует запись модели и возвращается кнопкой панели', async () => {
    await start(); await mcp('open', { url: target })
    await page.getByRole('button', { name: 'Взять управление', exact: true }).click()
    await page.getByText('Управление у вас.', { exact: false }).waitFor()
    const turn = createPreviewTurnTokens(secret).issue({ userId: 'admin', conversationId: id })
    const response = await fetch(base + '/mcp/preview?k=' + secret + '&turn=' + turn, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'type', arguments: { selector: '#name', text: 'Запрещённый ввод' } } }) })
    const result = (await response.json()).result
    expect(result.isError).toBe(true); expect(JSON.stringify(result)).toContain('human_control')
    expect(await command({ type: 'selector', action: { kind: 'read', selector: 'output' } })).toMatchObject({ text: 'initial' })
    await page.getByRole('button', { name: 'Вернуть управление модели' }).click()
    await expect.poll(async () => (await command({ type: 'status' })).control).toBe('shared')
    await mcp('type', { selector: '#name', text: 'После возврата' })
    expect(await mcp('read', { selector: 'output' })).toMatchObject({ text: 'После возврата' })
    if (process.env.VC_VISUAL_ARTIFACTS) { await page.getByRole('button', { name: 'Взять управление', exact: true }).click(); await page.getByText('Управление у вас.', { exact: false }).waitFor(); await page.waitForResponse(response => response.url().endsWith('/screenshot') && response.ok()); await page.waitForResponse(response => response.url().endsWith('/screenshot') && response.ok()); await page.getByAltText('Кадр Chromium').evaluate(el => (el as HTMLImageElement).decode()); await mkdir(process.env.VC_VISUAL_ARTIFACTS, { recursive: true }); await page.screenshot({ path: join(process.env.VC_VISUAL_ARTIFACTS, 'reader-control.png') }) }
  })
  it('одновременные команды выполняются по очереди, отмена не выпускает поздний ввод', async () => {
    await start(); await mcp('open', { url: target })
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
    await expect.poll(async () => (await command({ type: 'status' })).queuedCommands).toBe(0)
    const active = command({ type: 'inspect', action: { kind: 'evaluate', code: `new Promise(resolve => setTimeout(() => { document.querySelector('output').textContent='active'; resolve('done') }, 800))` } })
    await expect.poll(async () => (await command({ type: 'status' })).queuedCommands).toBeGreaterThan(0)
    const pending = fetch(base + '/api/browser/' + id + '/command', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ incarnation: native.incarnation, command: { type: 'selector', action: { kind: 'type', selector: '#name', text: 'Нельзя выполнить' } } }) })
    await expect.poll(async () => (await command({ type: 'status' })).queuedCommands).toBeGreaterThan(1)
    await command({ type: 'control', owner: 'user' })
    const user = command({ type: 'selector', action: { kind: 'type', selector: '#name', text: 'Ручной ввод' } })
    const cancelled = await pending
    expect(cancelled.ok).toBe(false); expect(await cancelled.text()).toContain('command_cancelled')
    await active; await user
    expect(await command({ type: 'selector', action: { kind: 'read', selector: 'output' } })).toMatchObject({ text: 'Ручной ввод' })
  })
  it('ошибка сохранения движка оставляет рабочий быстрый просмотр', async () => {
    await page.route(base + '/api/conversations/' + id + '/preview-url', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"fixture_unavailable"}' }))
    await page.getByRole('combobox', { name: 'Движок Web Reader' }).selectOption('chromium')
    await page.getByRole('alert').filter({ hasText: 'fixture_unavailable' }).waitFor()
    expect(await page.getByRole('combobox', { name: 'Движок Web Reader' }).inputValue()).toBe('proxy')
    await page.frameLocator('iframe[title="Web Reader"]').getByRole('textbox', { name: 'Адрес превью' }).waitFor()
  })
  it('возврат в быстрый просмотр сохраняет разговор и адрес проекта', async () => {
    await start(); await mcp('open', { url: 'https://app.internal/#/machines' })
    await expect.poll(async () => (await api('/api/conversations/' + id + '?scope=web-reader')).conversation.previewUrl, { timeout: 6000 }).toBe('https://app.internal/#/machines')
    await page.getByRole('combobox', { name: 'Движок Web Reader' }).selectOption('proxy')
    await page.frameLocator('iframe[title="Web Reader"]').getByRole('textbox', { name: 'Адрес превью' }).waitFor()
    expect((await api('/api/conversations/' + id + '?scope=web-reader')).conversation.previewEngine).toBe('proxy')
    expect(page.url()).toContain('/web-reader/' + id)
  })
})

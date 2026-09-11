import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import type { FastifyInstance } from 'fastify'
import { loadConfig } from '../apps/server/src/config.js'
import { buildServer } from '../apps/server/src/server.js'
import { PreviewActionRelay } from '@voicechat/web-reader-contracts'
import type { PreviewAction, ServerMessage } from '@voicechat/shared/index'

let app: FastifyInstance, browser: Browser, page: Page, base: string, dataDir: string, token: string, conversationId: string
let pageLoads = 0
const relay = new PreviewActionRelay()
const target = 'http://93.184.216.34:8787/reader-qa/page'
const changed: Array<Extract<ServerMessage, { t: 'reader.changed' }>> = []
const api = async (path: string, method = 'GET', body?: unknown) => {
  const response = await fetch(base + path, { method, headers: { authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  expect(response.ok).toBe(true); return response.json()
}
const act = (action: PreviewAction, id = conversationId) => relay.request('admin', id, action, 10_000)
const recorder = () => page.frameLocator('iframe[title="Web Reader"]')
const site = () => recorder().frameLocator('iframe[title="Предпросмотр сайта"]')
const paint = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
const open = async () => { const outcome = await act({ kind: 'open', url: target }); expect(outcome, outcome.error).toMatchObject({ ok: true }); await site().getByRole('heading', { name: 'Model QA' }).waitFor(); await paint() }

describe('Reader: модель управляет настоящим App через relay и WebSocket', () => {
  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'vc-reader-model-'))
    const reservation = createServer(); await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
    const address = reservation.address(); if (!address || typeof address === 'string') throw new Error('Нет порта')
    const port = address.port; await new Promise<void>(resolve => reservation.close(() => resolve()))
    base = 'http://127.0.0.1:' + port
    vi.stubEnv('VC_BROWSER_HOST_ALIASES', '93.184.216.34:8787=127.0.0.1:' + port)
    app = await buildServer({ config: loadConfig({ ...process.env, PORT: String(port), HOST: '127.0.0.1', VC_DATA_DIR: dataDir, VC_ADMIN_PASSWORD: 'reader-model-fixture-only', VC_WEB_DIR: resolve('apps/web/dist'), VC_WEB_RECORDER_DIR: resolve('apps/web-recorder/dist'), VC_BROWSER_HOST_ALIASES: '93.184.216.34:8787=127.0.0.1:' + port }), previewRelay: relay })
    app.get('/reader-qa/page', async (_req, reply) => {
      pageLoads++
      return reply.type('text/html').send('<!doctype html><title>Model QA</title><h1>Model QA</h1><label>Имя<input id="name"></label><button id="next" onclick="document.querySelector(\'output\').textContent=\'changed\';history.pushState({},\'\',\'?step=2#/next\')">Дальше</button><output>initial</output><script>window.qaMarker=Math.random()</script>')
    })
    app.get('/reader-qa/redirect', async (_req, reply) => reply.redirect('/reader-qa/page?final=1'))
    await app.listen({ host: '127.0.0.1', port })
    const response = await fetch(base + '/api/session/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'admin', password: 'reader-model-fixture-only' }) })
    expect(response.ok).toBe(true); token = (await response.json() as { token: string }).token
    await api('/api/settings', 'PUT', { onboarded: true, theme: 'green' }); browser = await chromium.launch()
  })
  beforeEach(async () => {
    const conversation = await api('/api/conversations', 'POST', { title: 'Reader model QA', assistantKind: 'web-recorder' }); conversationId = conversation.id ?? conversation.conversation.id
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(7000)
    page.on('websocket', socket => socket.on('framereceived', event => {
      try { const message = JSON.parse(String(event.payload)); if (message.t === 'reader.changed') changed.push(message) } catch { /* бинарные кадры к этим проверкам не относятся */ }
    }))
    await page.addInitScript(token => localStorage.setItem('vc.session.token', token), token)
    await page.goto(base + '/#/web-reader/' + conversationId)
    await page.waitForFunction(() => localStorage.getItem('voicechat:web-reader-active-registration:v1'))
    pageLoads = 0; changed.length = 0
  })
  afterEach(async () => { await page?.close() })
  afterAll(async () => { await browser?.close(); await app?.close(); vi.unstubAllEnvs(); if (dataDir) await rm(dataDir, { recursive: true, force: true }) })
  it('open модели выпускает preview-cookie даже из пустого Reader', async () => {
    const cookie = page.waitForResponse(response => response.url() === base + '/api/session/preview')
    await open(); expect((await cookie).ok()).toBe(true)
    expect(await recorder().getByRole('textbox', { name: 'Адрес превью' }).inputValue()).toBe(target)
  })
  it('open загружает страницу ровно один раз, включая обработку reader.changed', async () => {
    await open(); expect(pageLoads).toBe(1)
    expect(changed.some(event => event.action.kind === 'open' && event.navigated)).toBe(true)
  })
  it('навигационный click модели сохраняет DOM и состояние страницы', async () => {
    await open(); const marker = await site().locator('html').evaluate(() => Reflect.get(window, 'qaMarker'))
    expect(await act({ kind: 'click', selector: '#next' })).toMatchObject({ ok: true }); await paint()
    await expect.poll(() => recorder().getByRole('textbox', { name: 'Адрес превью' }).inputValue()).toBe(target + '?step=2#/next')
    expect(await site().locator('output').textContent()).toBe('changed')
    expect(await site().locator('html').evaluate(() => Reflect.get(window, 'qaMarker'))).toBe(marker); expect(pageLoads).toBe(1)
  })
  it('type и read модели работают с живым пользовательским полем', async () => {
    await open(); expect(await act({ kind: 'type', selector: '#name', text: 'Проверка модели' })).toMatchObject({ ok: true })
    expect(await site().getByLabel('Имя').inputValue()).toBe('Проверка модели')
    expect(await act({ kind: 'read' })).toMatchObject({ ok: true, result: { page: { title: 'Model QA' } } })
  })
  it('probe observes the live proxy control through App, relay and WebSocket', async () => {
    await open()
    await site().locator('#name').evaluate(el => { const input = el as HTMLInputElement; input.type = 'password'; input.value = 'proxy-probe-secret'; input.readOnly = true; input.focus() })
    const snapshot = () => site().locator('html').evaluate(() => ({ html: document.documentElement.outerHTML, value: (document.querySelector('#name') as HTMLInputElement).value, focus: document.activeElement?.id, marker: Reflect.get(window, 'qaMarker'), scrollY }))
    const before = await snapshot()
    const outcome = await act({ kind: 'probe', selector: '#name' })
    expect(outcome, outcome.error).toMatchObject({ ok: true, result: { page: { url: target }, probe: { surface: 'proxy', state: { nativeReadOnly: true }, pointer: { status: 'reachable' } } } })
    expect(JSON.stringify(outcome)).not.toContain('proxy-probe-secret')
    expect(await snapshot()).toEqual(before)
    await expect.poll(() => changed.find(event => event.action.kind === 'probe')).toMatchObject({ address: target, title: 'Model QA' })
    expect(pageLoads).toBe(1)
  })
  it('back и forward не перемонтируют документ после history-перехода', async () => {
    await open(); const marker = await site().locator('html').evaluate(() => Reflect.get(window, 'qaMarker'))
    await act({ kind: 'click', selector: '#next' }); expect(await act({ kind: 'back' })).toMatchObject({ ok: true })
    await expect.poll(() => recorder().getByRole('textbox', { name: 'Адрес превью' }).inputValue()).toBe(target)
    expect(await act({ kind: 'forward' })).toMatchObject({ ok: true })
    await expect.poll(() => recorder().getByRole('textbox', { name: 'Адрес превью' }).inputValue()).toBe(target + '?step=2#/next')
    expect(await site().locator('html').evaluate(() => Reflect.get(window, 'qaMarker'))).toBe(marker); expect(pageLoads).toBe(1)
  })
  it('после redirect модель и сохранённый разговор получают конечный адрес', async () => {
    const final = target + '?final=1'
    expect(await act({ kind: 'open', url: target.replace('/page', '/redirect') })).toMatchObject({ ok: true, result: { url: final } })
    await expect.poll(async () => (await api('/api/conversations/' + conversationId + '?scope=web-reader')).conversation.previewUrl).toBe(final)
  })
  it('сбой сохранения виден и повторяется без повторной загрузки сайта', async () => {
    const path = base + '/api/conversations/' + conversationId + '/preview-url'
    await page.route(path, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"fixture_unavailable"}' }), { times: 1 })
    expect(await act({ kind: 'open', url: target })).toMatchObject({ ok: false, error: expect.stringContaining('сохранить') })
    await page.getByRole('button', { name: 'Повторить сохранение' }).click()
    await expect.poll(async () => (await api('/api/conversations/' + conversationId + '?scope=web-reader')).conversation.previewUrl).toBe(target)
    expect(pageLoads).toBe(1)
  })
  it('ошибка подготовки cookie останавливает open до запроса сайта', async () => {
    await page.route(base + '/api/session/preview', route => route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"forbidden"}' }))
    expect(await act({ kind: 'open', url: target })).toMatchObject({ ok: false, error: expect.stringContaining('подготовить') })
    expect(pageLoads).toBe(0); await page.getByText('Не удалось подготовить Web Preview.', { exact: true }).waitFor()
  })
  it('команда чужого разговора не меняет активную страницу', async () => {
    expect(await act({ kind: 'open', url: target }, 'another-conversation')).toMatchObject({ ok: false }); expect(pageLoads).toBe(0)
  })
  it('reader.changed для read содержит страницу из вложенного result.page', async () => {
    await open(); expect(await act({ kind: 'read' })).toMatchObject({ ok: true })
    await expect.poll(() => changed.find(event => event.action.kind === 'read')).toMatchObject({ address: target, title: 'Model QA' })
  })
})

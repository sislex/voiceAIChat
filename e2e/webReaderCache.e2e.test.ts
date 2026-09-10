import fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { clearPreviewCookies, registerPreviewProxy } from '../apps/server/src/routes/previewProxy.js'

let app: FastifyInstance
let browser: Browser
let page: Page
let base: string
const state = { allowed: true, online: true, body: 'first', type: 'text/css', headers: {} as Record<string, string>, calls: 0 }
let id = 0
const target = (): string => '/api/preview?url=' + encodeURIComponent(`http://cache-browser.machine.internal:5173/${id}/asset.css`)
const read = (options: { method?: string; headers?: Record<string, string> } = {}) => page.evaluate(async ({ url, options }) => {
  const response = await fetch(url, options)
  return { status: response.status, body: await response.text(), cache: response.headers.get('cache-control') }
}, { url: target(), options })

describe('Reader: реальный браузерный и серверный кэш', () => {
  beforeAll(async () => {
    app = fastify()
    app.addHook('onRequest', async req => {
      ;(req as unknown as { user: { name: string; role: string } }).user = { name: String(req.headers['x-test-user'] ?? 'cache-browser-alice'), role: 'user' }
    })
    app.get('/', async (_req, reply) => reply.type('text/html').send('<!doctype html><h1>Reader cache QA</h1>'))
    registerPreviewProxy(app, { machines: { canUse: async () => state.allowed, bridge: {
      isOnline: () => state.online,
      http: async () => {
        state.calls++
        return { status: 200, headers: { 'content-type': state.type, ...state.headers }, bodyBase64: Buffer.from(state.body).toString('base64') }
      }
    } } })
    base = await app.listen({ host: '127.0.0.1', port: 0 })
    browser = await chromium.launch()
    page = await browser.newPage()
    await page.goto(base)
  })
  beforeEach(() => {
    id++; Object.assign(state, { allowed: true, online: true, body: 'first', type: 'text/css', headers: {}, calls: 0 })
    clearPreviewCookies('cache-browser-alice'); clearPreviewCookies('cache-browser-bob')
  })
  afterAll(async () => { await browser?.close(); await app?.close() })
  it('ресурс переиспользуется сервером, браузер перепроверяет права', async () => {
    expect((await read()).cache).toBe('private, no-cache')
    expect((await read()).body).toBe('first')
    expect(state.calls).toBe(1)
  })
  it('отзыв доступа виден сразу после удачной загрузки', async () => {
    await read(); state.allowed = false
    expect((await read()).status).toBe(403)
  })
  it('новый пользователь не получает старое представление', async () => {
    await read(); state.body = 'second user'
    expect((await read({ headers: { 'x-test-user': 'cache-browser-bob' } })).body).toBe('second user')
  })
  it('JSON страницы не застывает на минуту', async () => {
    state.type = 'application/json'; state.body = '{"version":1}'; await read()
    state.body = '{"version":2}'
    expect((await read()).body).toBe('{"version":2}')
  })
  it('no-store сохраняется до браузера', async () => {
    state.headers = { 'cache-control': 'no-store' }
    expect((await read()).cache).toContain('no-store')
    state.body = 'fresh'; expect((await read()).body).toBe('fresh')
  })
  it('Vary не смешивает разные представления', async () => {
    state.headers = { vary: 'Accept-Language' }; await read(); state.body = 'changed'
    expect((await read()).body).toBe('changed')
  })
  it('Set-Cookie отключает публичное переиспользование', async () => {
    state.headers = { 'set-cookie': 'session=fixture; Path=/' }; await read(); state.body = 'signed in'
    expect((await read()).body).toBe('signed in')
  })
  it('запрос с Authorization страницы получает актуальное тело', async () => {
    await read(); state.body = 'private'
    expect((await read({ headers: { 'x-preview-authorization': 'Bearer fixture' } })).body).toBe('private')
  })
  it('принудительная перезагрузка и мутация обновляют статику', async () => {
    await read(); state.body = 'reloaded'
    expect((await read({ headers: { 'cache-control': 'no-cache' } })).body).toBe('reloaded')
    state.body = 'saved'; await read({ method: 'POST' })
    expect((await read()).body).toBe('saved')
  })
  it('отключённая машина не маскируется браузерным кэшем', async () => {
    await read(); state.online = false
    expect((await read()).status).toBe(502)
  })
})

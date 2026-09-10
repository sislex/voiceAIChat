import fastify, { type FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { registerPreviewProxy } from '../apps/web-reader/src/routes/previewProxy.js'
import type { PreviewDomAction, PreviewActionResultMessage } from '@voicechat/shared/previewActions'

let app: FastifyInstance
let browser: Browser
let page: Page
let base: string
const site = 'http://navigation-cycle.machine.internal:5173'
const body = `<!doctype html><html><head><title>Navigation QA</title></head><body>
<h1 id="title">Navigation QA</h1><a href="#section">Якорь</a><h2 id="section">Раздел</h2>
<button id="push" onclick="history.pushState({step:1},'', '/deep/next?x=1#/pushed')">Push</button>
<button id="replace" onclick="history.replaceState({step:2},'', '/replaced?x=2#/replaced')">Replace</button>
<a href="/second#chapter">Следующая</a>
<script>window.marker = Math.random();</script></body></html>`

const frame = () => page.frames().find(frame => frame.parentFrame())!
const act = (action: PreviewDomAction): Promise<PreviewActionResultMessage> => page.evaluate(action => new Promise<PreviewActionResultMessage>((resolve, reject) => {
  const child = document.querySelector('iframe')!.contentWindow!
  const requestId = crypto.randomUUID()
  const timer = setTimeout(() => { removeEventListener('message', listener); reject(new Error('Нет ответа DOM-моста')) }, 5000)
  const listener = (event: MessageEvent) => {
    if (event.source !== child || event.data?.type !== 'voicechat.preview.action-result.v1' || event.data.requestId !== requestId) return
    clearTimeout(timer); removeEventListener('message', listener); resolve(event.data)
  }
  addEventListener('message', listener)
  child.postMessage({ type: 'voicechat.preview.action.v1', requestId, action }, location.origin)
}), action)
const open = async (path = '/#/initial') => {
  await page.goto(base + '/host?url=' + encodeURIComponent(site + path))
  await page.frameLocator('iframe').getByRole('heading', { name: 'Navigation QA', exact: true }).waitFor()
  await expect.poll(() => page.locator('#current').textContent()).toContain(site)
}

describe('Reader: адрес страницы, SPA и история в Chromium', () => {
  beforeAll(async () => {
    app = fastify()
    app.addHook('onRequest', async req => {
      ;(req as unknown as { user: { name: string; role: string } }).user = { name: 'navigation-e2e', role: 'user' }
    })
    app.get<{ Querystring: { url: string } }>('/host', async (req, reply) => reply.type('text/html; charset=utf-8').send(`<!doctype html><html><head><script>window.startHistory=history.length;window.ready=[];addEventListener('message',e=>{if(e.source===document.querySelector('iframe')?.contentWindow&&e.data?.type==='voicechat.preview.page-ready.v1'){window.ready.push(e.data.url);document.querySelector('#current').textContent=e.data.url}})</script></head><body><output id="current"></output><iframe src="/api/preview?url=${encodeURIComponent(req.query.url)}"></iframe></body></html>`))
    registerPreviewProxy(app, { machines: { canUse: async () => true, bridge: {
      isOnline: () => true,
      http: async (_id, request) => request.path === '/redirect'
        ? { status: 302, headers: { location: '/destination#/landed' }, bodyBase64: '' }
        : { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, bodyBase64: Buffer.from(body).toString('base64') }
    } } })
    base = await app.listen({ host: '127.0.0.1', port: 0 })
    browser = await chromium.launch()
  })
  beforeEach(async () => { page = await browser.newPage(); page.setDefaultTimeout(5000) })
  afterEach(async () => { await page?.close() })
  afterAll(async () => { await browser?.close(); await app?.close() })
  it('redirect сообщает конечный URL и hash', async () => {
    await open('/redirect')
    expect(await page.locator('#current').textContent()).toBe(site + '/destination#/landed')
    expect(new URL(frame().url()).searchParams.get('url')).toBe(site + '/destination#/landed')
  })
  it('восстанавливает deep link без лишней записи истории', async () => {
    await open()
    expect(new URL(frame().url()).hash).toBe('#/initial')
    expect(await frame().evaluate('history.length')).toBe(await page.evaluate('window.startHistory'))
  })
  it('pushState сохраняет hash и состояние без нового документа', async () => {
    await open(); const marker = await frame().evaluate('window.marker')
    await page.frameLocator('iframe').getByRole('button', { name: 'Push', exact: true }).click()
    await expect.poll(() => page.locator('#current').textContent()).toBe(site + '/deep/next?x=1#/pushed')
    expect(await frame().evaluate('history.state')).toEqual({ step: 1 })
    expect(await frame().evaluate('window.marker')).toBe(marker)
  })
  it('replaceState меняет адрес, сохраняя длину истории', async () => {
    await open(); const length = await frame().evaluate('history.length')
    await page.frameLocator('iframe').getByRole('button', { name: 'Replace', exact: true }).click()
    await expect.poll(() => page.locator('#current').textContent()).toBe(site + '/replaced?x=2#/replaced')
    expect(await frame().evaluate('history.length')).toBe(length)
  })
  it('read возвращает текущий hash после клика по якорю', async () => {
    await open(); await page.frameLocator('iframe').getByRole('link', { name: 'Якорь', exact: true }).click()
    const result = await act({ kind: 'read' })
    expect(result).toMatchObject({ ok: true, result: { page: { url: site + '/#section' } } })
  })
  it('popstate возвращает подтверждённый URL родителю', async () => {
    await open(); await page.frameLocator('iframe').getByRole('button', { name: 'Push', exact: true }).click()
    await frame().evaluate('history.back()')
    await expect.poll(() => page.locator('#current').textContent()).toBe(site + '/#/initial')
  })
  it('удаление hash не восстанавливает старый фрагмент из query', async () => {
    await open(); await frame().evaluate('location.hash = ""')
    await expect.poll(async () => (await act({ kind: 'read' })).result).toMatchObject({ page: { url: site + '/' } })
  })
  it('переход между документами сообщает логический URL следующей страницы', async () => {
    await open(); await page.frameLocator('iframe').getByRole('link', { name: 'Следующая', exact: true }).click()
    await expect.poll(() => page.locator('#current').textContent()).toBe(site + '/second#chapter')
    expect(await act({ kind: 'read' })).toMatchObject({ ok: true, result: { page: { url: site + '/second#chapter' } } })
  })
  it('pagehide/pageshow восстанавливают мост сохранённого документа', async () => {
    await open()
    await frame().evaluate(() => { dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })) })
    expect(await act({ kind: 'read' })).toMatchObject({ ok: true })
  })
  it('после redirect относительный fetch использует каталог назначения', async () => {
    await open('/redirect')
    await frame().evaluate('history.pushState({}, "", "/deep/page")')
    const result = await frame().evaluate(async () => {
      const response = await fetch('./data')
      return new URL(response.url).searchParams.get('url')
    })
    expect(result).toBe(site + '/deep/data')
  })
})

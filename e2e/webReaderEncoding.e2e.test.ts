import Fastify, { type FastifyInstance } from 'fastify'
import { gzipSync, deflateSync, brotliCompressSync } from 'node:zlib'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { registerPreviewProxy } from '../apps/server/src/routes/previewProxy.js'
import type { ReaderProjectRequest } from '../packages/shared/src/previewProject'
let app: FastifyInstance, browser: Browser, page: Page, base: string
const cp = Buffer.from([0xcf,0xf0,0xe8,0xe2,0xe5,0xf2]), png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVn8AAAAASUVORK5CYII=', 'base64')
const legacy = (prefix: string, suffix = '') => Buffer.concat([Buffer.from(prefix), cp, Buffer.from(suffix)])
const doc = '<!doctype html><h1>Привет</h1><button id="ready">Проверить</button>'
const inner = () => page.frameLocator('iframe')
const open = async (path: string) => { await page.goto(base + '/host?path=' + encodeURIComponent(path)); await inner().locator('body').waitFor() }
const requests: ReaderProjectRequest[] = []
describe('Reader: кодировки и сжатые ответы в Chromium', () => {
  beforeAll(async () => {
    app = Fastify(); app.addHook('onRequest', async request => { Object.assign(request, { user: { name: 'encoding-fixture' } }) })
    app.get<{ Querystring: { path: string } }>('/host', async (req, reply) => reply.type('text/html; charset=utf-8').send('<iframe style="width:1000px;height:700px" src="/api/preview?url=' + encodeURIComponent('https://app.internal' + req.query.path) + '"></iframe>'))
    registerPreviewProxy(app, { projectResource: async request => {
      requests.push(request); let body = Buffer.from(doc), type = 'text/html', encoding: string | undefined, status = 200
      const path = request.path
      if (path === '/header') { body = legacy('<h1>','</h1>'); type += '; charset=windows-1251' }
      if (path === '/meta') body = legacy('<meta content="text/html; charset=windows-1251" http-equiv="Content-Type"><h1>','</h1>')
      if (path === '/bom') body = Buffer.concat([Buffer.from([255,254]), Buffer.from(doc,'utf16le')])
      if (path === '/css') body = Buffer.from('<link rel="stylesheet" href="/legacy.css"><h1 id="css">CSS</h1>')
      if (path === '/legacy.css') { body = legacy('@charset "windows-1251";#css::after{content:"','"}'); type = 'text/css' }
      if (path === '/js') body = Buffer.from('<h1 id="js">initial</h1><script src="/legacy.js"></script>')
      if (path === '/legacy.js') { body = legacy('document.querySelector("#js").textContent="','"'); type = 'application/javascript; charset=windows-1251' }
      if (path === '/image') body = Buffer.from('<img id="pixel" src="/pixel.png">')
      if (path === '/pixel.png') { body = png; type = 'image/png' }
      if (path.startsWith('/compressed/')) { encoding = path.split('/')[2]; body = encoding === 'gzip' ? gzipSync(body) : encoding === 'br' ? brotliCompressSync(body) : deflateSync(body) }
      if (path === '/broken') { encoding = 'gzip'; body = Buffer.from('broken') }
      if (path === '/bomb') { encoding = 'gzip'; body = gzipSync(Buffer.alloc(5*1024*1024+1)) }
      if (path === '/redirect') return { status: 302, headers: { location: '/final' }, bodyBase64: '' }
      if (path === '/final') { type = 'application/json'; body = Buffer.from(JSON.stringify({ method: request.method, body: request.bodyBase64, headers: request.headers })) }
      return { status, headers: { 'content-type': type, ...(encoding ? { 'content-encoding': encoding } : {}) }, bodyBase64: body.toString('base64') }
    } }); base = await app.listen({ host: '127.0.0.1', port: 0 }); browser = await chromium.launch()
  })
  beforeEach(async () => { page = await browser.newPage(); page.setDefaultTimeout(6000); requests.length = 0 }); afterEach(async () => { await page?.close() }); afterAll(async () => { await browser?.close(); await app?.close() })
  it('UTF-8 без charset не портит текст и встроенные команды Reader', async () => {
    await open('/utf8'); await inner().getByRole('heading', { name: 'Привет' }).waitFor(); await inner().locator('#voicechat-preview-inspector').waitFor({ state: 'attached' }); expect(await inner().locator('body').evaluate(() => document.characterSet)).toBe('UTF-8')
  })
  it('HTTP Windows-1251 декодируется и возвращается браузеру как UTF-8', async () => { await open('/header'); await inner().getByRole('heading', { name: 'Привет' }).waitFor(); expect(await inner().locator('body').evaluate(() => document.characterSet)).toBe('UTF-8') })
  it('meta http-equiv определяет исходную кодировку', async () => { await open('/meta'); await inner().getByRole('heading', { name: 'Привет' }).waitFor() })
  it('UTF-16 BOM не ломает HTML и инъекцию', async () => { await open('/bom'); await inner().getByRole('heading', { name: 'Привет' }).waitFor(); await inner().locator('#voicechat-preview-inspector').waitFor({ state: 'attached' }) })
  it('CSS в legacy charset сохраняет русское содержимое', async () => { await open('/css'); await expect.poll(() => inner().locator('#css').evaluate(el => getComputedStyle(el, '::after').content)).toBe('"Привет"') })
  it('JS в legacy charset выполняется с правильными строками', async () => { await open('/js'); await inner().getByRole('heading', { name: 'Привет' }).waitFor() })
  it('бинарный ответ проекта сохраняется побайтно и декодируется как картинка', async () => {
    await open('/image'); await expect.poll(() => inner().locator('#pixel').evaluate(el => (el as HTMLImageElement).naturalWidth)).toBe(1)
    const response = await page.request.get(base + '/api/preview?url=' + encodeURIComponent('https://app.internal/pixel.png')); expect(await response.body()).toEqual(png)
  })
  it('gzip, br и deflate проходят распаковку до инъекции скрипта', async () => {
    for (const format of ['gzip','br','deflate']) { await open('/compressed/' + format); await inner().getByRole('heading', { name: 'Привет' }).waitFor(); await inner().locator('#voicechat-preview-inspector').waitFor({ state: 'attached' }) }
  })
  it('битое сжатие и превышение распакованного размера показывают причину', async () => {
    await open('/broken'); await inner().getByRole('heading', { name: 'Сайт не загрузился' }).waitFor(); expect(await inner().locator('body').textContent()).toContain('распаковать')
    const response = await page.request.get(base + '/api/preview?url=' + encodeURIComponent('https://app.internal/bomb')); expect(response.status()).toBe(413)
  })
  it('302 сохраняет PUT с телом и убирает тело POST', async () => {
    await open('/utf8'); const result = await inner().locator('body').evaluate(async () => { const values = []; for (const method of ['PUT','POST']) values.push(await (await fetch('/redirect', { method, body: 'value', headers: { 'content-type': 'text/plain' } })).json()); return values })
    expect(result[0]).toMatchObject({ method: 'PUT', body: Buffer.from('value').toString('base64') }); expect(result[1]).toMatchObject({ method: 'GET' }); expect(result[1]).not.toHaveProperty('body'); expect(result[1].headers).not.toHaveProperty('content-type')
  })
})

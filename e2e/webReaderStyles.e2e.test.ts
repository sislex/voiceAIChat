import fastify, { type FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { registerPreviewProxy } from '../apps/web-reader/src/routes/previewProxy.js'

let app: FastifyInstance, browser: Browser, page: Page, base: string, source = ''
const site = 'http://styles-cycle.machine.internal:5173'
const requests: string[] = []
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXTUAAAAASUVORK5CYII='
const open = async (head: string, body = '<div id="target">Styles QA</div>') => {
  source = '<!doctype html><html><head>' + head + '</head><body>' + body + '</body></html>'; requests.length = 0
  await page.goto(base + '/api/preview?url=' + encodeURIComponent(site + '/assets/styles/page'))
}
const targetImage = async () => {
  await expect.poll(() => page.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1)
  return page.locator('img').evaluate((img: HTMLImageElement) => img.currentSrc)
}

describe('Reader: стили и responsive images в Chromium', () => {
  beforeAll(async () => {
    app = fastify()
    app.addHook('onRequest', async req => { ;(req as unknown as { user: { name: string; role: string } }).user = { name: 'styles-e2e', role: 'user' } })
    registerPreviewProxy(app, { machines: { canUse: async () => true, bridge: { isOnline: () => true, http: async (_id, request) => {
      requests.push(request.path)
      const isPage = request.path === '/assets/styles/page', isCss = request.path.endsWith('.css')
      return { status: 200, headers: { 'content-type': isPage ? 'text/html; charset=utf-8' : isCss ? 'text/css' : 'image/png' }, bodyBase64: isPage ? Buffer.from(source).toString('base64') : isCss ? Buffer.from('#target{color:green}').toString('base64') : pixel }
    } } } })
    base = await app.listen({ host: '127.0.0.1', port: 0 }); browser = await chromium.launch()
  })
  beforeEach(async () => { page = await browser.newPage({ deviceScaleFactor: 1 }); page.setDefaultTimeout(5000) })
  afterEach(async () => { await page?.close() })
  afterAll(async () => { await browser?.close(); await app?.close() })
  it('картинка CSS со скобкой загружается по полному адресу', async () => {
    await open('<style>#target{background:url("../img/a)b.png")}</style>')
    expect(requests).toContain('/assets/img/a)b.png')
  })
  it('CSS escape превращается в правильное имя ресурса', async () => {
    await open(String.raw`<style>#target{background:url("../img/\66 oo.png")}</style>`)
    expect(requests).toContain('/assets/img/foo.png')
  })
  it('комментарии со ссылками не изменяются', async () => {
    const style = '/* url(private.png) */ #target{color:red}'; await open('<style>' + style + '</style>')
    expect(await page.locator('style').textContent()).toBe(style)
  })
  it('content отображает исходную строку url', async () => {
    await open('<style>#target::before{content:"url(private.png)"}</style>')
    expect(await page.locator('#target').evaluate(el => getComputedStyle(el, '::before').content)).toBe('"url(private.png)"')
  })
  it('quoted @import загружает и применяет внешнюю таблицу', async () => {
    await open('<style>@import "./theme.css" layer(theme) screen;</style>')
    expect(await page.locator('#target').evaluate(el => getComputedStyle(el).color)).toBe('rgb(0, 128, 0)')
  })
  it('image-set загружает строковый источник с корректным type', async () => {
    await open('<style>#target{background:image-set("./one.png" type("image/png") 1x, "./two.png" 2x)}</style>')
    expect(requests).toContain('/assets/styles/one.png')
  })
  it('локальный SVG filter остаётся фрагментом текущего документа', async () => {
    await open('<style>#target{filter:url(#effect)}</style>', '<svg><filter id="effect"><feGaussianBlur stdDeviation="1"/></filter></svg><div id="target">Filter</div>')
    expect(await page.locator('style').textContent()).toBe('#target{filter:url(#effect)}')
    expect(requests.filter(path => path !== '/assets/styles/page')).toEqual([])
  })
  it('data URL внутри srcset остаётся декодируемой картинкой', async () => {
    await open('', '<img srcset="data:image/png;base64,' + pixel + ' 1x, ./large.png 2x">')
    expect(await targetImage()).toBe('data:image/png;base64,' + pixel)
  })
  it('srcset с запятой в пути загружает правильный ресурс', async () => {
    await open('', '<img srcset="./a,b.png 1x, ./large.png 2x">')
    expect(new URL(await targetImage()).searchParams.get('url')).toBe(site + '/assets/styles/a,b.png')
  })
  it('imagesrcset preload и picture используют адреса прокси', async () => {
    await open('<link rel="preload" as="image" imagesrcset="./preload.png 1x, ./large.png 2x">', '<picture><source srcset="./source.png 1x"><img></picture>')
    expect(requests).toContain('/assets/styles/preload.png')
    expect(new URL(await targetImage()).searchParams.get('url')).toBe(site + '/assets/styles/source.png')
  })
})

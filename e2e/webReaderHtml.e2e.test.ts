// Реальный Chromium загружает документы через production-прокси Reader.
// Машинный HTTP-порт заменён детерминированной фикстурой: внешняя сеть не влияет
// на результат, а SSRF-проверки и cookie проекта не ослабляются ради теста.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import fastify, { type FastifyInstance } from 'fastify'
import { chromium, type Browser, type Page } from 'playwright'
import { registerPreviewProxy } from '../apps/server/src/routes/previewProxy.js'

let app: FastifyInstance
let browser: Browser
let page: Page
let base: string
const calls: string[] = []
const target = 'http://html-cycle.machine.internal:5173/'
const html = `<!doctype html><html><head><base href="/assets/">
<link rel=stylesheet href=theme.css integrity="sha256-wrong">
<script>window.fixtureTemplate = '<a href="/unchanged"></a></body><head>';</script>
<script type=module>import "./module.js"; window.lazyFixture = () => import('./lazy.js');</script>
</head><body><h1>Reader HTML</h1>
<a id=query href="/search?a=1&amp;b=2">Запрос</a>
<img id=unquoted src=/logo.svg>
<img id=base src=logo.svg>
<img id=lazy data-src="/original.svg" data-href="/original" src=/logo.svg>
<a id=anchor href=#section>Якорь</a><h2 id=section>Раздел</h2>
<form method=post><button id=submit formaction=/save>Отправить</button></form>
<a id=popup href=/next target=_BLANK>Далее</a>
<p id=styled>Цвет</p><!-- <img src="/untouched.svg"> -->
</body></html>`

describe('Web Reader: цикл 01 в Chromium', () => {
  beforeAll(async () => {
    app = fastify()
    app.addHook('onRequest', async req => {
      ;(req as unknown as { user: { name: string; role: string } }).user = { name: 'reader-e2e', role: 'user' }
    })
    registerPreviewProxy(app, { machines: { canUse: async () => true, bridge: {
      isOnline: () => true,
      http: async (_id, request) => {
        calls.push(request.path)
        const path = request.path
        const type = path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8'
        const body = path === '/' ? html
          : path.endsWith('module.js') ? 'window.moduleLoaded = true;'
          : path.endsWith('lazy.js') ? 'window.lazyLoaded = true;'
          : path.endsWith('.css') ? '#styled { color: rgb(1, 2, 3); background-image: url("./logo.svg"); }'
          : path.endsWith('.svg') ? '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="green"/></svg>'
          : `<html><body><h1>Получен ${path}</h1></body></html>`
        return { status: 200, headers: { 'content-type': type }, bodyBase64: Buffer.from(body).toString('base64') }
      }
    } } })
    base = await app.listen({ host: '127.0.0.1', port: 0 })
    browser = await chromium.launch()
    page = await browser.newPage()
    page.setDefaultTimeout(5_000)
  })
  afterAll(async () => { await browser?.close(); await app?.close() })

  const open = async (): Promise<void> => {
    await page.goto(base + '/api/preview?url=' + encodeURIComponent(target))
    await page.getByRole('heading', { name: 'Reader HTML', exact: true }).waitFor()
  }
  beforeEach(open)
  it('query с HTML entities достигает апстрима без искажения', async () => {
    await page.getByRole('link', { name: 'Запрос', exact: true }).click()
    await page.getByRole('heading', { name: 'Получен /search?a=1&b=2' }).waitFor()
  })
  it('ресурс без кавычек действительно загружается', async () => {
    expect(await page.locator('#unquoted').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(10)
  })
  it('JavaScript с HTML-строками исполняется без повреждения', async () => {
    expect(await page.evaluate('window.fixtureTemplate')).toBe('<a href="/unchanged"></a></body><head>')
  })
  it('данные lazy-loader остаются исходными', async () => {
    expect(await page.locator('#lazy').getAttribute('data-src')).toBe('/original.svg')
    expect(await page.locator('#lazy').getAttribute('data-href')).toBe('/original')
  })
  it('base направляет относительную картинку в правильный каталог', async () => {
    expect(calls).toContain('/assets/logo.svg')
    expect(await page.locator('#base').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(10)
  })
  it('якорь сохраняет экземпляр документа', async () => {
    const before = calls.length
    await page.getByRole('link', { name: 'Якорь', exact: true }).click()
    expect(new URL(page.url()).hash).toBe('#section')
    expect(calls.length).toBe(before)
    expect(await page.evaluate('window.moduleLoaded')).toBe(true)
  })
  it('formaction отправляет форму через прокси', async () => {
    await page.getByRole('button', { name: 'Отправить', exact: true }).click()
    await page.getByRole('heading', { name: 'Получен /save' }).waitFor()
  })
  it('target без кавычек не создаёт лишнюю вкладку', async () => {
    await page.getByRole('link', { name: 'Далее', exact: true }).click()
    await page.getByRole('heading', { name: 'Получен /next' }).waitFor()
    expect(page.context().pages()).toHaveLength(1)
  })
  it('CSS после rewrite загружается при исходной integrity', async () => {
    expect(await page.locator('#styled').evaluate(el => getComputedStyle(el).color)).toBe('rgb(1, 2, 3)')
  })
  it('inline module загружает статический и ленивый модули', async () => {
    expect(await page.evaluate('window.moduleLoaded')).toBe(true)
    await page.evaluate('window.lazyFixture()')
    expect(await page.evaluate('window.lazyLoaded')).toBe(true)
    if (process.env.VC_VISUAL_ARTIFACTS) {
      await mkdir(process.env.VC_VISUAL_ARTIFACTS, { recursive: true })
      await page.screenshot({ path: join(process.env.VC_VISUAL_ARTIFACTS, 'web-reader-cycle-01.png'), fullPage: true })
    }
  })
})

import fastify, { type FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { registerPreviewProxy } from '../apps/server/src/routes/previewProxy.js'

let app: FastifyInstance, browser: Browser, page: Page, base: string
const site = 'http://forms-cycle.machine.internal:5173'
let source = '', last: { method: string; path: string; body: string; contentType: string } | undefined
const frame = () => page.frames().find(frame => frame.parentFrame())!
const open = async (html: string) => {
  source = '<!doctype html><html><head><title>Forms QA</title></head><body>' + html + '</body></html>'
  await page.goto(base + '/host')
  await page.frameLocator('iframe').locator('body').waitFor()
  await frame().waitForFunction(() => !!document.getElementById('voicechat-preview-inspector'))
  last = undefined
}
const submit = async () => {
  await page.frameLocator('iframe').getByRole('button', { name: 'Отправить' }).click()
  await expect.poll(() => last).toBeTruthy()
}

describe('Reader: нативные формы и ссылки в Chromium', () => {
  beforeAll(async () => {
    app = fastify()
    app.addHook('onRequest', async req => { ;(req as unknown as { user: { name: string; role: string } }).user = { name: 'forms-e2e', role: 'user' } })
    app.get('/host', async (_req, reply) => reply.type('text/html').send(`<iframe src="/api/preview?url=${encodeURIComponent(site + '/catalog/page?old=1')}"></iframe>`))
    registerPreviewProxy(app, { machines: { canUse: async () => true, bridge: { isOnline: () => true, http: async (_id, request) => {
      if(request.path !== '/catalog/page?old=1') last = { method: request.method, path: request.path, body: Buffer.from(request.bodyBase64 || '', 'base64').toString(), contentType: request.headers?.['content-type'] || '' }
      return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, bodyBase64: Buffer.from(request.path === '/catalog/page?old=1' ? source : '<!doctype html><h1>Получено</h1>').toString('base64') }
    } } } })
    base = await app.listen({ host: '127.0.0.1', port: 0 }); browser = await chromium.launch()
  })
  beforeEach(async () => { page = await browser.newPage(); page.setDefaultTimeout(5000) })
  afterEach(async () => { await page?.close() })
  afterAll(async () => { await browser?.close(); await app?.close() })
  it('GET не теряет адрес назначения при сериализации query', async () => {
    await open('<form action="/search?old=1"><input name="q" value="кот & пёс"><button>Отправить</button></form>'); await submit()
    expect(last).toMatchObject({ method: 'GET', path: '/search?q=%D0%BA%D0%BE%D1%82+%26+%D0%BF%D1%91%D1%81', body: '' })
  })
  it('GET без action использует адрес документа вместо origin оболочки', async () => {
    await open('<form><input name="q" value="value"><button>Отправить</button></form>'); await submit()
    expect(last?.path).toBe('/catalog/page?q=value')
  })
  it('GET сохраняет повторения, checkbox и name/value submitter', async () => {
    await open('<form action="/search"><input name="tag" value="a"><input name="tag" value="b"><input disabled name="skip" value="x"><input type="checkbox" name="on" checked><button name="intent" value="find">Отправить</button></form>'); await submit()
    expect(last?.path).toBe('/search?tag=a&tag=b&on=on&intent=find')
  })
  it('formaction и formmethod кнопки переопределяют форму', async () => {
    await open('<form method="post" action="/wrong"><input name="q" value="right"><button formaction="./alternative" formmethod="get">Отправить</button></form>'); await submit()
    expect(last).toMatchObject({ method: 'GET', path: '/catalog/alternative?q=right' })
  })
  it('динамическая POST-форма сохраняет тело и не открывает другую вкладку', async () => {
    await open('<div id="root"></div><script>document.getElementById("root").innerHTML=\'<form method="post" action="/save" target="_blank"><input name="message" value="a & b"><button name="commit" value="yes">Отправить</button></form>\'</script>'); await submit()
    expect(last).toMatchObject({ method: 'POST', path: '/save', body: 'message=a+%26+b&commit=yes' })
    expect(page.context().pages()).toHaveLength(1)
  })
  it('динамический POST multipart доставляет файл нативной отправкой', async () => {
    await open('<form id="f" method="post" enctype="multipart/form-data"><input name="file" type="file"><button>Отправить</button></form><script>document.getElementById("f").action="/upload"</script>')
    await page.frameLocator('iframe').locator('input').setInputFiles({ name: 'qa.txt', mimeType: 'text/plain', buffer: Buffer.from('reader-file-qa') }); await submit()
    expect(last?.path).toBe('/upload'); expect(last?.contentType).toContain('multipart/form-data; boundary=')
    expect(last?.body).toContain('filename="qa.txt"'); expect(last?.body).toContain('reader-file-qa')
  })
  it('form.submit() тоже оборачивает GET без события submit', async () => {
    await open('<form id="f" action="/program"><input name="q" value="direct"></form><button onclick="document.getElementById(\'f\').submit()">Отправить</button>'); await submit()
    expect(last?.path).toBe('/program?q=direct')
  })
  it('не выполняет нативный переход после preventDefault приложения', async () => {
    await open('<form action="/blocked" onsubmit="event.preventDefault();document.getElementById(\'status\').textContent=\'handled\'"><button>Отправить</button></form><output id="status"></output>')
    await page.frameLocator('iframe').getByRole('button').click()
    expect(await page.frameLocator('iframe').locator('#status').textContent()).toBe('handled')
    await frame().evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect(last).toBeUndefined()
  })
  it('динамическая относительная ссылка идёт через прокси', async () => {
    await open('<div id="root"></div><script>document.getElementById("root").innerHTML=\'<a href="../next" target="_blank"><span>Перейти</span></a>\'</script>')
    await page.frameLocator('iframe').getByRole('link').click(); await expect.poll(() => last?.path).toBe('/next')
    expect(new URL(frame().url()).pathname).toBe('/api/preview'); expect(page.context().pages()).toHaveLength(1)
  })
  it('ссылку из Shadow DOM оборачивает по composedPath', async () => {
    await open('<div id="root"></div><script>document.getElementById("root").attachShadow({mode:"open"}).innerHTML=\'<a href="/shadow">Перейти</a>\'</script>')
    await page.frameLocator('iframe').getByRole('link').click(); await expect.poll(() => last?.path).toBe('/shadow')
  })
})

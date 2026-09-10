import fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import { resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { registerPreviewProxy } from '../apps/web-reader/src/routes/previewProxy.js'
let app: FastifyInstance, browser: Browser, page: Page, base: string
let unavailable = false
const site = 'http://ui-cycle.machine.internal:5173'
const body = '<!doctype html><title>Reader UI QA</title><h1>Проверка страницы</h1><button id="next" onclick="history.pushState({},\'\',\'/next\')">Далее</button><input aria-label="Имя"><p>Содержимое страницы</p>'
const shell = () => page.frameLocator('iframe[title="Web Reader"]')
const content = () => shell().frameLocator('iframe')
const waitReady = async () => { await content().getByRole('heading', { name: 'Проверка страницы' }).waitFor(); await expect.poll(() => shell().locator('.webpreview-load-status').count()).toBe(0) }

describe('Reader: адресная строка и адаптивный интерфейс в Chromium', () => {
  beforeAll(async () => {
    app = fastify()
    app.addHook('onRequest', async req => { ;(req as unknown as { user: { name: string; role: string } }).user = { name: 'reader-ui-e2e', role: 'user' } })
    await app.register(fastifyStatic, { root: resolve(process.env.VC_READER_TEST_DIST ?? 'apps/web-recorder/dist'), prefix: '/web-recorder/' })
    app.get('/host', async (_req, reply) => reply.type('text/html').send(`<!doctype html><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%}</style><iframe title="Web Reader" src="/web-recorder/"></iframe><script>addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==document.querySelector('iframe').contentWindow)return;if(e.data.kind==='ready')e.source.postMessage({type:'voicechat.web-recorder.v1',kind:'init',protocolVersion:2,conversationId:'qa',registrationId:'ui',previewUrl:'${site}/page',capabilities:[]},location.origin)})</script>`))
    registerPreviewProxy(app, { machines: { canUse: async () => true, bridge: { isOnline: () => true, http: async () => unavailable ? ({ status: 502, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, bodyBase64: Buffer.from('{"message":"Тестовая страница временно недоступна"}').toString('base64') }) : ({ status: 200, headers: { 'content-type': 'text/html', 'cache-control': 'no-store' }, bodyBase64: Buffer.from(body).toString('base64') }) } } })
    base = await app.listen({ host: '127.0.0.1', port: 0 }); browser = await chromium.launch()
  })
  beforeEach(async () => { unavailable = false; page = await browser.newPage({ viewport: { width: 1100, height: 760 } }); page.setDefaultTimeout(5000); await page.goto(base + '/host'); await waitReady() })
  afterEach(async () => { await page?.close() })
  afterAll(async () => { await browser?.close(); await app?.close() })
  it('использует стандартный режим документа и мобильный viewport', async () => {
    expect(await shell().locator('html').evaluate(el => ({ mode: document.compatMode, lang: el.lang, viewport: document.querySelector('meta[name=viewport]')?.getAttribute('content') }))).toMatchObject({ mode: 'CSS1Compat', lang: 'ru', viewport: expect.stringContaining('width=device-width') })
  })
  it('убирает стандартные поля body и наследует шрифт кнопок', async () => {
    expect(await shell().locator('body').evaluate(el => getComputedStyle(el).margin)).toBe('0px')
    expect(await shell().getByRole('button', { name: 'Открыть', exact: true }).evaluate(el => getComputedStyle(el).fontFamily)).not.toMatch(/Times New Roman|Arial$/)
  })
  it('открывает адрес машины без схемы', async () => {
    await shell().getByLabel('Адрес превью').fill('ui-cycle.machine.internal:5173/bare')
    await shell().getByRole('button', { name: 'Открыть', exact: true }).click(); await waitReady()
    expect(await shell().getByLabel('Адрес превью').inputValue()).toBe(site + '/bare')
  })
  it('разрешает относительный путь после SPA-перехода', async () => {
    await content().getByRole('button', { name: 'Далее' }).click()
    await expect.poll(() => shell().getByLabel('Адрес превью').inputValue()).toBe(site + '/next')
    await shell().getByLabel('Адрес превью').fill('./settings?tab=reader'); await shell().getByRole('button', { name: 'Открыть', exact: true }).click(); await waitReady()
    expect(await shell().getByLabel('Адрес превью').inputValue()).toBe(site + '/settings?tab=reader')
  })
  it('обновляет фактический адрес после SPA-перехода', async () => {
    await content().getByRole('button', { name: 'Далее' }).click()
    await content().locator('body').evaluate(el => el.setAttribute('data-old-document', 'yes'))
    await shell().getByRole('button', { name: 'Обновить страницу', exact: true }).click(); await waitReady()
    expect(await content().locator('body').getAttribute('data-old-document')).toBeNull()
    expect(await shell().getByLabel('Адрес превью').inputValue()).toBe(site + '/next')
  })
  it('показывает ошибку загрузки и успешно повторяет запрос', async () => {
    unavailable = true; await shell().getByRole('button', { name: 'Обновить страницу', exact: true }).click()
    await shell().getByRole('alert').filter({ hasText: 'Тестовая страница временно недоступна' }).waitFor()
    unavailable = false; await shell().getByRole('button', { name: 'Повторить загрузку' }).click(); await waitReady()
    expect(await shell().getByRole('alert').count()).toBe(0)
  })
  it('включает только один режим взаимодействия с элементами', async () => {
    await shell().locator('summary').click(); await shell().getByRole('button', { name: '⌖ Выбор элемента' }).click()
    await shell().locator('summary').click(); await shell().getByRole('button', { name: '✎ Редактировать' }).click()
    expect(await shell().getByRole('button', { name: '⌖ Выбор элемента', includeHidden: true }).getAttribute('aria-pressed')).toBe('false')
    expect(await shell().getByRole('button', { name: '✎ Редактировать', includeHidden: true }).getAttribute('aria-pressed')).toBe('true')
  })
  it('закрывает инструменты по Escape и возвращает фокус', async () => {
    await shell().locator('summary').click(); await page.keyboard.press('Tab'); await page.keyboard.press('Escape')
    expect(await shell().locator('details').getAttribute('open')).toBeNull()
    expect(await shell().locator('summary').evaluate(el => document.activeElement === el)).toBe(true)
    await shell().locator('summary').click(); await shell().getByLabel('Адрес превью').click()
    expect(await shell().locator('details').getAttribute('open')).toBeNull()
  })
  it('сохраняет выбранные 1024 пикселя внутри узкой панели', async () => {
    await page.setViewportSize({ width: 375, height: 760 }); await shell().getByLabel('Ширина вьюпорта').selectOption('1024')
    expect(await content().locator('body').evaluate(() => window.innerWidth)).toBe(1024)
    expect(await shell().locator('.webpreview-viewport').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
  })
  it('помещает тулбар на мобильном экране и показывает состояние записи', async () => {
    await page.setViewportSize({ width: 375, height: 760 })
    expect(await shell().locator('body').evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(await shell().getByRole('button', { name: 'Открыть', exact: true }).evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(36)
    await shell().locator('summary').click(); await shell().getByRole('button', { name: 'Записать сценарий' }).click()
    expect(await shell().getByRole('button', { name: 'Остановить запись', includeHidden: true }).getAttribute('aria-pressed')).toBe('true')
    if (process.env.VC_VISUAL_ARTIFACTS) { await mkdir(process.env.VC_VISUAL_ARTIFACTS, { recursive: true }); await page.screenshot({ path: resolve(process.env.VC_VISUAL_ARTIFACTS, 'reader-cycle09-mobile.png') }) }
  })
})

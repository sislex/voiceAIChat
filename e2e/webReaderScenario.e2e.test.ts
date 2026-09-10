import fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import { resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { registerPreviewProxy } from '../apps/server/src/routes/previewProxy.js'
let app: FastifyInstance, browser: Browser, page: Page, base: string
let unavailable = false
const site = 'http://scenario-cycle.machine.internal:5173'
const body = `<!doctype html><title>Scenario QA</title><h1>Проверка страницы</h1><button id="first" onclick="document.getElementById('count').textContent=String(Number(document.getElementById('count').textContent)+1)">Первый</button><output id="count">0</output><input id="name" aria-label="Имя"><input id="password" type="password"><a id="next" href="/next">Далее</a><button id="hold">Отложить</button><script>addEventListener('message',e=>{if(e.data?.type==='voicechat.preview.action.v1'&&e.data.action?.selector==='#hold'){e.stopImmediatePropagation();window.delayedRequest=e.data.requestId}},true)</script>`
const shell = () => page.frameLocator('iframe[title="Web Reader"]')
const content = () => shell().frameLocator('iframe')
const waitReady = async () => { await content().getByRole('heading', { name: 'Проверка страницы' }).waitFor(); await expect.poll(() => shell().locator('.webpreview-load-status').count()).toBe(0) }

describe('Reader: последовательные сценарии в Chromium', () => {
  beforeAll(async () => {
    app = fastify()
    app.addHook('onRequest', async req => { ;(req as unknown as { user: { name: string; role: string } }).user = { name: 'reader-ui-e2e', role: 'user' } })
    await app.register(fastifyStatic, { root: resolve(process.env.VC_READER_TEST_DIST ?? 'apps/web-recorder/dist'), prefix: '/web-recorder/' })
    app.get('/host', async (_req, reply) => reply.type('text/html').send(`<!doctype html><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%}</style><iframe title="Web Reader" src="/web-recorder/"></iframe><script>addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==document.querySelector('iframe').contentWindow)return;if(e.data.kind==='ready')e.source.postMessage({type:'voicechat.web-recorder.v1',kind:'init',protocolVersion:2,conversationId:'qa',registrationId:'ui',previewUrl:'${site}/page',capabilities:[]},location.origin)})</script>`))
    registerPreviewProxy(app, { machines: { canUse: async () => true, bridge: { isOnline: () => true, http: async (_id, request) => { if (request.path === '/next') await new Promise(resolve => setTimeout(resolve, 150)); return unavailable ? ({ status: 502, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, bodyBase64: Buffer.from('{"message":"Тестовая страница временно недоступна"}').toString('base64') }) : ({ status: 200, headers: { 'content-type': 'text/html', 'cache-control': 'no-store' }, bodyBase64: Buffer.from(body).toString('base64') }) } } } })
    base = await app.listen({ host: '127.0.0.1', port: 0 }); browser = await chromium.launch()
  })
  beforeEach(async () => { unavailable = false; page = await browser.newPage({ viewport: { width: 1100, height: 760 } }); page.setDefaultTimeout(5000) })
  afterEach(async () => { await page?.close() })
  afterAll(async () => { await browser?.close(); await app?.close() })

  const click = (selector: string) => ({ kind: 'click', selector, text: '', sensitive: false })
  const typeStep = (selector: string, text: string, sensitive = false) => ({ kind: 'type', selector, text, sensitive })
  const openScenario = async (steps: object[]) => {
    await page.addInitScript(({ site, steps }) => { localStorage.setItem('voicechat.reader.scenario.v1:' + site + '/page', JSON.stringify(steps)) }, { site, steps })
    await page.goto(base + '/host'); await waitReady()
  }
  const run = async () => shell().getByRole('button', { name: 'Запустить', exact: true }).click()
  const progress = () => shell().locator('.webpreview-run-status')
  const finishDelayed = async () => content().locator('body').evaluate(() => {
    parent.postMessage({ type: 'voicechat.preview.action-result.v1', requestId: (window as unknown as { delayedRequest: string }).delayedRequest, ok: true }, location.origin)
  })
  it('ждёт подтверждения предыдущего действия', async () => {
    await openScenario([click('#hold'), click('#first')]); await run()
    await content().locator('body').evaluate(() => new Promise(resolve => setTimeout(resolve, 120)))
    expect(await content().locator('#count').textContent()).toBe('0')
    await finishDelayed(); await expect.poll(() => progress().getAttribute('data-status')).toBe('passed')
    expect(await content().locator('#count').textContent()).toBe('1')
  })
  it('продолжает на новом документе после навигации', async () => {
    await openScenario([click('#next'), typeStep('#name', 'новая страница')]); await run()
    await expect.poll(() => progress().getAttribute('data-status')).toBe('passed')
    expect(await shell().getByLabel('Адрес превью').inputValue()).toBe(site + '/next')
    expect(await content().getByLabel('Имя').inputValue()).toBe('новая страница')
  })
  it('останавливается при ошибке первого шага', async () => {
    await openScenario([click('#missing'), click('#first')]); await run()
    await expect.poll(() => progress().getAttribute('data-status')).toBe('failed')
    expect(await content().locator('#count').textContent()).toBe('0')
    expect(await progress().textContent()).toContain('Шаг 1')
  })
  it('не начинает сценарий без последнего секрета', async () => {
    await openScenario([click('#first'), typeStep('#password', '', true)]); await run()
    await expect.poll(() => progress().getAttribute('data-status')).toBe('failed')
    expect(await content().locator('#count').textContent()).toBe('0')
  })
  it('кнопка остановки отменяет оставшиеся действия', async () => {
    await openScenario([click('#hold'), click('#first')]); await run()
    await shell().getByRole('button', { name: 'Остановить сценарий' }).click()
    await expect.poll(() => progress().getAttribute('data-status')).toBe('cancelled')
    await finishDelayed()
    expect(await content().locator('#count').textContent()).toBe('0')
  })
  it('обновление страницы отменяет старый запуск', async () => {
    await openScenario([click('#hold'), click('#first')]); await run()
    await shell().getByRole('button', { name: 'Обновить страницу' }).click(); await waitReady()
    await expect.poll(() => progress().getAttribute('data-status')).toBe('cancelled')
    expect(await content().locator('#count').textContent()).toBe('0')
  })
  it('блокирует второй запуск и изменения выполняемых шагов', async () => {
    await openScenario([click('#hold')]); await run()
    expect(await shell().getByRole('button', { name: 'Запустить', exact: true }).isDisabled()).toBe(true)
    expect(await shell().getByLabel('Селектор шага 1').isDisabled()).toBe(true)
    expect(await shell().getByRole('button', { name: 'Очистить', exact: true }).isDisabled()).toBe(true)
  })
  it('не дописывает воспроизведение в запись', async () => {
    await openScenario([click('#first')])
    await shell().locator('summary').click(); await shell().getByRole('button', { name: 'Записать сценарий' }).click(); await run()
    await expect.poll(() => progress().getAttribute('data-status')).toBe('passed')
    expect(await shell().getByLabel('Селектор шага 2').count()).toBe(0)
    expect(await shell().getByRole('button', { name: 'Записать сценарий', includeHidden: true }).getAttribute('aria-pressed')).toBe('false')
  })
  it('очищает введённый секрет после выполнения', async () => {
    await openScenario([typeStep('#password', '', true)])
    await shell().getByLabel('Секретное значение шага 1').fill('temporary-test-value'); await run()
    await expect.poll(() => progress().getAttribute('data-status')).toBe('passed')
    expect(await content().locator('#password').inputValue()).toBe('temporary-test-value')
    expect(await shell().getByLabel('Секретное значение шага 1').inputValue()).toBe('')
    expect(await shell().locator('body').evaluate(() => Object.values(localStorage).join(''))).not.toContain('temporary-test-value')
  })
  it('показывает число выполненных шагов', async () => {
    await openScenario([click('#first'), typeStep('#name', 'готово')]); await run()
    await expect.poll(() => progress().getAttribute('data-status')).toBe('passed')
    expect(await progress().textContent()).toContain('2 из 2')
    if (process.env.VC_VISUAL_ARTIFACTS) { await mkdir(process.env.VC_VISUAL_ARTIFACTS, { recursive: true }); await page.screenshot({ path: resolve(process.env.VC_VISUAL_ARTIFACTS, 'reader-cycle10-scenario.png') }) }
  })
})

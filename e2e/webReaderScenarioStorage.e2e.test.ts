import fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { parse } from 'acorn'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { registerPreviewProxy } from '../apps/web-reader/src/routes/previewProxy.js'
let app: FastifyInstance, browser: Browser, page: Page, base: string
let unavailable = false
const site = 'http://scenario-cycle.machine.internal:5173'
const body = `<!doctype html><title>Scenario QA</title><h1>Проверка страницы</h1><button id="first" onclick="document.getElementById('count').textContent=String(Number(document.getElementById('count').textContent)+1)">Первый</button><output id="count">0</output><input id="name" aria-label="Имя"><input id="password" type="password"><a id="next" href="/next">Далее</a><button id="hold">Отложить</button><script>addEventListener('message',e=>{if(e.data?.type==='voicechat.preview.action.v1'&&e.data.action?.selector==='#hold'){e.stopImmediatePropagation();window.delayedRequest=e.data.requestId}},true)</script>`
const shell = () => page.frameLocator('iframe[title="Web Reader"]')
const content = () => shell().frameLocator('iframe')
const waitReady = async () => { await content().getByRole('heading', { name: 'Проверка страницы' }).waitFor(); await expect.poll(() => shell().locator('.webpreview-load-status').count()).toBe(0) }

describe('Reader: сохранение и редактирование сценария в Chromium', () => {
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
  const openScenario = async (steps: unknown[], extra: Record<string, string> = {}) => {
    await page.addInitScript(({ site, steps, extra }) => { if (!location.pathname.startsWith('/web-recorder')) return; localStorage.setItem('voicechat.reader.scenario.v1:' + site + '/page', JSON.stringify(steps)); for (const [key,value] of Object.entries(extra)) localStorage.setItem(key,value) }, { site, steps, extra })
    await page.goto(base + '/host'); await waitReady()
  }
  const exported = async () => {
    const download = page.waitForEvent('download')
    await shell().getByRole('button', { name: 'Экспорт в Playwright' }).click()
    const artifact = await download; expect(artifact.suggestedFilename()).toBe('web-reader-scenario.spec.ts')
    return readFile((await artifact.path())!, 'utf8')
  }
  it('загружает валидные шаги рядом с повреждёнными записями', async () => {
    await openScenario([null, false, 5, [], click('#first')])
    expect(await shell().getByLabel('Селектор шага 1').inputValue()).toBe('#first')
    expect(await shell().getByLabel('Селектор шага 2').count()).toBe(0)
  })
  it('не создаёт неограниченный DOM из большого сценария', async () => {
    await openScenario(Array.from({ length: 240 }, (_, i) => click('#step-' + i)))
    expect(await shell().locator('input[aria-label^="Селектор шага"]').count()).toBe(200)
  })
  it('маскирует секреты старой записи при переносе', async () => {
    await openScenario([typeStep('#password', 'old-sensitive-value', true)])
    expect(await shell().getByLabel('Секретное значение шага 1').inputValue()).toBe('')
    expect(await shell().locator('body').evaluate(() => Object.values(localStorage).join(''))).not.toContain('old-sensitive-value')
  })
  it('при выключенной записи клики не меняют сценарий', async () => {
    await openScenario([]); await content().locator('#first').click()
    await content().locator('body').evaluate(() => parent.postMessage({ type: 'voicechat.preview.record.v1', step: { kind: 'click', selector: '#forged', text: '', sensitive: false } }, location.origin))
    expect(await shell().getByLabel('Селектор шага 1').count()).toBe(0)
  })
  it('склеивает посимвольный ввод в один шаг', async () => {
    await openScenario([])
    // postMessage доставляется асинхронно: склейку ввода проверяем после включения
    // записи на странице, иначе CDP успевает набрать всё слово до смены режима.
    await content().locator('body').evaluate(() => {
      Reflect.set(window, '__readerRecordingReady', false)
      const ready = (event: MessageEvent) => {
        if (event.source !== parent || event.origin !== location.origin || event.data?.type !== 'voicechat.preview.record.v1' || event.data.enabled !== true) return
        Reflect.set(window, '__readerRecordingReady', true)
        removeEventListener('message', ready)
      }
      addEventListener('message', ready)
    })
    await shell().locator('summary').click(); await shell().getByRole('button', { name: 'Записать сценарий' }).click()
    await expect.poll(() => content().locator('body').evaluate(() => Reflect.get(window, '__readerRecordingReady'))).toBe(true)
    await content().locator('#name').pressSequentially('Анна')
    await expect.poll(() => shell().getByLabel('Значение шага 1').inputValue()).toBe('Анна')
    expect(await shell().getByLabel('Селектор шага 2').count()).toBe(0)
  })
  it('разделяет сценарии hash-страниц проекта', async () => {
    await openScenario([], { ['voicechat.reader.scenario.v2:' + site + '/page#/projects']: JSON.stringify([click('#projects')]), ['voicechat.reader.scenario.v2:' + site + '/page#/machines']: JSON.stringify([click('#machines')]) })
    for (const route of ['projects','machines']) {
      await content().locator('body').evaluate((_el, route) => history.pushState({}, '', '#/' + route), route)
      await expect.poll(() => shell().getByLabel('Адрес превью').inputValue()).toBe(site + '/page#/' + route)
      expect(await shell().getByLabel('Селектор шага 1').inputValue()).toBe('#' + route)
    }
  })
  it('ручная отметка секрета удаляет обычное сохранённое значение', async () => {
    await openScenario([typeStep('#name', 'manual-sensitive-value')]); await shell().getByLabel('Секрет шага 1', { exact: true }).check()
    expect(await shell().getByLabel('Значение шага 1', { exact: true }).count()).toBe(0)
    expect(await shell().locator('body').evaluate(() => Object.values(localStorage).join(''))).not.toContain('manual-sensitive-value')
  })
  it('меняет порядок и удаляет лишний шаг', async () => {
    await openScenario([click('#first'), click('#next')])
    await shell().getByLabel('Поднять шаг 2', { exact: true }).click()
    expect(await shell().getByLabel('Селектор шага 1').inputValue()).toBe('#next')
    await shell().getByLabel('Удалить шаг 1', { exact: true }).click()
    expect(await shell().getByLabel('Селектор шага 1').inputValue()).toBe('#first')
    expect(await shell().getByLabel('Селектор шага 2').count()).toBe(0)
  })
  it('скачивает синтаксически корректный многострочный Playwright-тест', async () => {
    await openScenario([typeStep('#name', 'первая\nвторая "кавычки" \\ путь')])
    const spec = await exported()
    expect(() => parse(spec, { ecmaVersion: 'latest', sourceType: 'module' })).not.toThrow()
    expect(spec).toContain('первая\\nвторая')
  })
  it('экспортированный тест отказывается от запуска без секрета до goto', async () => {
    await openScenario([click('#first'), typeStep('#password', '', true)])
    const spec = await exported(); let run: ((args: { page: { goto: () => void } }) => Promise<void>) | undefined, navigated = false
    const register = (_name: string, callback: typeof run) => { run = callback }
    new Function('test', 'process', spec.replace(/^import.*\n/, ''))(register, { env: {} })
    await expect(run!({ page: { goto() { navigated = true } } })).rejects.toThrow('SCENARIO_SECRET_1')
    expect(navigated).toBe(false)
  })
})

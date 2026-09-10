import fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import { build } from 'esbuild'
import { resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { registerPreviewProxy } from '../apps/server/src/routes/previewProxy.js'
import type { ReaderHostBridge, ReaderHostRegistration } from '../packages/web-reader-app/src/hostBridge'

type TestWindow = Window & { readerTest: { bridge: ReaderHostBridge; registrations: Array<ReaderHostRegistration | null>; sent: unknown[]; broken: boolean } }
let app: FastifyInstance, browser: Browser, page: Page, base: string
const site = 'http://host-cycle.machine.internal:5173'
const body = '<!doctype html><h1>Host QA</h1><button id="confirm" onclick="document.querySelector(\'output\').textContent=\'clicked\'">Подтвердить</button><output>untouched</output>'
const setup = async () => {
  await page.goto(base + '/host')
  await page.waitForFunction(() => (window as unknown as TestWindow).readerTest?.bridge.registrationId())
}
const readyPage = async () => {
  const result = await page.evaluate(url => (window as unknown as TestWindow).readerTest.bridge.run({ kind: 'open', url }), site + '/first')
  expect(result.ok).toBe(true)
}

describe('Reader: host-команды через настоящий shell в Chromium', () => {
  beforeAll(async () => {
    const compiled = await build({ stdin: { contents: `import {createReaderHostBridge} from './packages/web-reader-app/src/hostBridge';
const test=window.readerTest={registrations:[],sent:[],broken:false};let sequence=0;
const bridge=test.bridge=createReaderHostBridge({conversationId:'qa',newId:()=>String(++sequence),send:message=>{if(test.broken)throw Error('closed');test.sent.push(message);document.querySelector('iframe').contentWindow.postMessage(message,location.origin)},onRegistration:value=>test.registrations.push(value)});
addEventListener('message',event=>{if(event.origin===location.origin&&event.source===document.querySelector('iframe').contentWindow)bridge.receive(event.data)});`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser', alias: { '@shared': resolve('packages/shared/src') } })
    app = fastify(); app.addHook('onRequest', async req => { ;(req as unknown as { user: { name: string; role: string } }).user = { name: 'host-e2e', role: 'user' } })
    await app.register(fastifyStatic, { root: resolve('apps/web-recorder/dist'), prefix: '/web-recorder/' })
    app.get('/host.js', async (_req, reply) => reply.type('text/javascript').send(compiled.outputFiles[0].text))
    app.get('/host', async (_req, reply) => reply.type('text/html').send('<!doctype html><iframe title="Web Reader" src="/web-recorder/" style="width:900px;height:600px"></iframe><script src="/host.js"></script>'))
    registerPreviewProxy(app, { machines: { canUse: async () => true, bridge: { isOnline: () => true, http: async () => ({ status: 200, headers: { 'content-type': 'text/html' }, bodyBase64: Buffer.from(body).toString('base64') }) } } })
    base = await app.listen({ host: '127.0.0.1', port: 0 }); browser = await chromium.launch()
  })
  beforeEach(async () => { page = await browser.newPage(); page.setDefaultTimeout(5000); await setup() })
  afterEach(async () => { await page?.close() })
  afterAll(async () => { await browser?.close(); await app?.close() })
  it('модель меняет viewport до открытия страницы', async () => {
    expect(await page.evaluate(() => (window as unknown as TestWindow).readerTest.bridge.run({ kind: 'viewport', width: 375 }))).toMatchObject({ ok: true, result: { width: 375 } })
    expect(await page.frameLocator('iframe').getByLabel('Ширина вьюпорта').inputValue()).toBe('375')
  })
  it('два open отменяют старый адрес и click из его очереди', async () => {
    const result = await page.evaluate(async site => {
      const bridge = (window as unknown as TestWindow).readerTest.bridge
      const first = bridge.run({ kind: 'open', url: site + '/first' }), click = bridge.run({ kind: 'click', selector: '#confirm' }), second = bridge.run({ kind: 'open', url: site + '/second' })
      return Promise.all([first, click, second])
    }, site)
    expect(result.map(item => item.ok)).toEqual([false, false, true])
    expect(await page.frameLocator('iframe').frameLocator('iframe').locator('output').textContent()).toBe('untouched')
  })
  it('закрытие host отменяет отложенный open', async () => {
    expect(await page.evaluate(async site => {
      const test = (window as unknown as TestWindow).readerTest, pending = test.bridge.run({ kind: 'open', url: site + '/late' })
      test.bridge.dispose(); const count = test.sent.length; await Promise.resolve(); return { result: await pending, extra: test.sent.length - count }
    }, site)).toMatchObject({ result: { ok: false }, extra: 0 })
  })
  it('очистка страницы отклоняет команду без ожидания timeout', async () => {
    expect(await page.evaluate(async site => {
      const bridge = (window as unknown as TestWindow).readerTest.bridge; bridge.setUrl(site + '/first')
      const result = bridge.run({ kind: 'read' }); bridge.setUrl(null); return result
    }, site)).toMatchObject({ ok: false })
  })
  it('замена URL отменяет click по прежнему документу', async () => {
    expect(await page.evaluate(async site => {
      const bridge = (window as unknown as TestWindow).readerTest.bridge; bridge.setUrl(site + '/first')
      const result = bridge.run({ kind: 'click', selector: '#confirm' }); bridge.setUrl(site + '/second'); return result
    }, site)).toMatchObject({ ok: false })
    await page.frameLocator('iframe').frameLocator('iframe').locator('output').waitFor()
    expect(await page.frameLocator('iframe').frameLocator('iframe').locator('output').textContent()).toBe('untouched')
  })
  it('перезагрузка shell делает прежний handle неисполняемым', async () => {
    await readyPage()
    await page.frameLocator('iframe').locator('body').evaluate(() => location.reload())
    await page.waitForFunction(() => (window as unknown as TestWindow).readerTest.registrations.filter(Boolean).length === 2)
    expect(await page.evaluate(() => (window as unknown as TestWindow).readerTest.registrations[0]!.run({ kind: 'read' }))).toMatchObject({ ok: false })
  })
  it('ready другого разговора не заменяет текущую регистрацию', async () => {
    const result = await page.evaluate(() => {
      const bridge = (window as unknown as TestWindow).readerTest.bridge, before = bridge.registrationId()
      bridge.receive({ type: 'voicechat.web-recorder.v1', kind: 'ready', protocolVersion: 2, conversationId: 'other', registrationId: 'other-id', capabilities: [] })
      return { before, after: bridge.registrationId() }
    }); expect(result.after).toBe(result.before)
  })
  it('потеря транспорта возвращает модели понятный отказ', async () => {
    expect(await page.evaluate(site => {
      const test = (window as unknown as TestWindow).readerTest; test.broken = true; return test.bridge.run({ kind: 'open', url: site + '/first' })
    }, site)).toMatchObject({ ok: false, error: expect.stringContaining('передать') })
  })
  it('disposed от shell закрывает host-регистрацию', async () => {
    await page.frameLocator('iframe').locator('body').evaluate(() => {
      window.parent.postMessage({ type: 'voicechat.web-recorder.v1', conversationId: 'qa', registrationId: '1', kind: 'disposed' }, location.origin)
    })
    await page.waitForFunction(() => (window as unknown as TestWindow).readerTest.bridge.getStatus() === 'disposed')
  })
  it('host-режимы восстанавливаются после reload Reader', async () => {
    await readyPage(); await page.evaluate(() => { const bridge = (window as unknown as TestWindow).readerTest.bridge; bridge.setInspector(true); bridge.setRecording(true) })
    await page.frameLocator('iframe').locator('body').evaluate(() => location.reload())
    await page.waitForFunction(() => (window as unknown as TestWindow).readerTest.registrations.filter(Boolean).length === 2)
    await expect.poll(() => page.frameLocator('iframe').getByRole('button', { name: '⌖ Выбор элемента', includeHidden: true }).getAttribute('aria-pressed')).toBe('true')
    await page.frameLocator('iframe').getByRole('button', { name: 'Остановить запись', includeHidden: true }).waitFor({ state: 'attached' })
  })
})

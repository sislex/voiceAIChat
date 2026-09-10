import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import type { BrowserWaitOptions } from '@voicechat/shared'
import { runSelectorAction } from './selectorActions.js'
import { startReaderFormsFixture } from './test/readerForms.js'

let browser: Browser, page: Page
let site: Awaited<ReturnType<typeof startReaderFormsFixture>>
beforeAll(async () => { site = await startReaderFormsFixture(); browser = await chromium.launch() })
beforeEach(async () => { page = await browser.newPage(); await page.goto(`${site.origin}/waiting`) })
afterEach(async () => { await page?.close() })
afterAll(async () => { await browser?.close(); await site?.close() })
const wait = (options: BrowserWaitOptions) => runSelectorAction(page, { kind: 'wait', timeoutMs: 1000, ...options })
// Для невыполнимого условия достаточно короткого дедлайна; готовому локатору
// оставляем время на доставку команды при общей нагрузке тестового раннера.
const waitBriefly = (options: BrowserWaitOptions) => wait({ timeoutMs: 100, ...options })

it('selector вместе с text ждёт изменения внутри выбранного элемента', async () => {
  expect(await waitBriefly({ selector: '#status', text: 'Готово' })).toMatchObject({ ok: false })
  await page.evaluate('document.querySelector("#status").textContent="Готово"')
  expect(await wait({ selector: '#status', text: 'Готово' })).toMatchObject({ ok: true })
})

it('state различает attached, visible, hidden и detached', async () => {
  expect(await waitBriefly({ selector: '#spinner', state: 'hidden' })).toMatchObject({ ok: false })
  await page.evaluate('document.querySelector("#spinner").hidden=true')
  expect(await wait({ selector: '#spinner', state: 'hidden' })).toMatchObject({ ok: true })
  expect(await wait({ selector: '#spinner', state: 'attached' })).toMatchObject({ ok: true })
  expect(await waitBriefly({ selector: '#spinner', state: 'visible' })).toMatchObject({ ok: false })
  expect(await waitBriefly({ selector: '#spinner', state: 'detached' })).toMatchObject({ ok: false })
  await page.evaluate('document.querySelector("#spinner").remove()')
  expect(await wait({ selector: '#spinner', state: 'detached' })).toMatchObject({ ok: true })
})

it('enabled ждёт готовности отключённой кнопки', async () => {
  expect(await waitBriefly({ selector: '#send', enabled: true })).toMatchObject({ ok: false })
  await page.evaluate('document.querySelector("#send").disabled=false')
  expect(await wait({ selector: '#send', enabled: true })).toMatchObject({ ok: true })
})

it('editable ждёт снятия readonly', async () => {
  expect(await waitBriefly({ selector: '#field', editable: true })).toMatchObject({ ok: false })
  await page.evaluate('document.querySelector("#field").readOnly=false')
  expect(await wait({ selector: '#field', editable: true })).toMatchObject({ ok: true })
})

it('checked различает состояние флажка', async () => {
  expect(await waitBriefly({ selector: '#check', checked: true })).toMatchObject({ ok: false })
  await page.locator('#check').check()
  expect(await wait({ selector: '#check', checked: true })).toMatchObject({ ok: true })
})

it('value ждёт реального значения поля, включая пустую строку', async () => {
  expect(await waitBriefly({ selector: '#field', value: '' })).toMatchObject({ ok: false })
  await page.evaluate('document.querySelector("#field").value=""')
  expect(await wait({ selector: '#field', value: '' })).toMatchObject({ ok: true })
})

it('count ждёт весь набор и умеет ждать ноль элементов', async () => {
  expect(await waitBriefly({ selector: '.row', count: 2 })).toMatchObject({ ok: false })
  await page.evaluate('document.querySelector("#rows").insertAdjacentHTML("beforeend","<p class=row>Вторая строка</p>")')
  await page.evaluate('document.querySelector(".row").hidden=true')
  expect(await wait({ selector: '.row', count: 2 })).toMatchObject({ ok: true })
  await page.evaluate('document.querySelector("#rows").replaceChildren()')
  expect(await wait({ selector: '.row', count: 0 })).toMatchObject({ ok: true })
})

it('url ждёт hash-маршрут и поддерживает шаблон адреса', async () => {
  expect(await waitBriefly({ url: '**/waiting#ready' })).toMatchObject({ ok: false })
  await page.evaluate('history.replaceState(null,"","#ready")')
  expect(await wait({ url: '**/waiting#ready' })).toMatchObject({ ok: true })
  expect(await wait({ url: `${site.origin}/waiting#ready` })).toMatchObject({ ok: true })
})

it('loadState различает готовый DOM и ещё не завершённый ресурс', async () => {
  let release: (() => Promise<void>) | undefined
  await page.route('**/slow-reader-image', route => { release = () => route.fulfill({ status: 404, body: '' }) })
  await page.setContent(`<h1>DOM готов</h1><img src="${site.origin}/slow-reader-image">`, { waitUntil: 'domcontentloaded' })
  expect(await wait({ loadState: 'domcontentloaded' })).toMatchObject({ ok: true })
  expect(await waitBriefly({ loadState: 'load' })).toMatchObject({ ok: false })
  await release!()
  expect(await wait({ loadState: 'load', timeoutMs: 1000 })).toMatchObject({ ok: true })
})

it('predicate ждёт выражение приложения и сообщает синтаксическую ошибку', async () => {
  expect(await waitBriefly({ predicate: 'window.appReady === true' })).toMatchObject({ ok: false })
  await page.evaluate('window.appReady=true')
  expect(await wait({ predicate: 'window.appReady === true' })).toMatchObject({ ok: true })
  expect(await wait({ predicate: '() => window.appReady === true' })).toMatchObject({ ok: true })
  expect(await waitBriefly({ predicate: '(()' })).toMatchObject({ ok: false, error: expect.any(String) })
  expect(await waitBriefly({ predicate: 'async () => false' })).toMatchObject({ ok: false, error: expect.stringContaining('синхронное') })
})

it('асинхронная страница завершает ожидание только после выполнения условий', async () => {
  await page.locator('#begin').click()
  const result = await wait({ selector: '#status', text: 'Готово', url: '**/waiting#ready', predicate: 'window.appReady', timeoutMs: 3000 })
  expect(result).toMatchObject({ ok: true, waitedMs: expect.any(Number) })
  expect(await page.locator('#status').innerText()).toBe('Готово')
  expect(await page.locator('#send').isEnabled()).toBe(true)
})

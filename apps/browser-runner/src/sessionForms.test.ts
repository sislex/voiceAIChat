import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import { BROWSER_UPLOAD_LIMIT_BYTES, planModelAction, type BrowserCommand, type BrowserSelectorResult, type BrowserSessionMetadata, type PreviewAction } from '@voicechat/shared'
import { BrowserSessionManager } from './sessionManager.js'
import { previewOriginTarget } from './security.js'
import { buildBrowserRunner } from './server.js'
import { startReaderFormsFixture } from './test/readerForms.js'

let fixture: Awaited<ReturnType<typeof startReaderFormsFixture>>
let root = ''
let manager: BrowserSessionManager
let meta: BrowserSessionMetadata
const request = (command: BrowserCommand) => ({ requestId: randomUUID(), incarnation: meta.incarnation, actor: 'assistant' as const, command })
const command = (value: BrowserCommand) => manager.command(meta.id, request(value))
async function act(action: PreviewAction) {
  const plan = planModelAction(action)
  if (plan.kind !== 'command') throw new Error(plan.reason)
  return command(plan.command) as Promise<BrowserSelectorResult>
}
async function read(selector: string) { return (await act({ kind: 'read', selector })).text }
beforeAll(async () => { fixture = await startReaderFormsFixture(); root = await mkdtemp(join(tmpdir(), 'vc-reader-forms-')) })
beforeEach(async () => {
  manager = new BrowserSessionManager(root, new Map(), previewOriginTarget(fixture.origin))
  meta = await manager.start({ sessionId: 'forms', userKey: 'test', conversationKey: 'forms' })
  await command({ type: 'navigate', url: fixture.origin })
})
afterEach(async () => { await manager?.close() })
afterAll(async () => { await fixture?.close(); if (root) await rm(root, { recursive: true, force: true }) })

it('передаёт все четыре модификатора клика из контракта модели', async () => {
  expect(await act({ kind: 'click', selector: '#modifiers', modifiers: ['ctrl', 'shift', 'alt', 'meta'] })).toMatchObject({ ok: true })
  expect(await read('#modifiers-result')).toBe('{"ctrl":true,"shift":true,"alt":true,"meta":true}')
})

it('направляет клавишу указанному полю, даже если фокус был в другом', async () => {
  await act({ kind: 'type', selector: '#other', text: 'другое поле' })
  await act({ kind: 'press', selector: '#target', key: 'Enter' })
  expect(await read('#key-result')).toBe('target:Enter')
})

it('прокручивает указанный контейнер, а окно сохраняет позицию', async () => {
  expect(await act({ kind: 'scroll', selector: '#scroller', dy: 500 })).toMatchObject({ ok: true })
  expect(await read('#scroll-result')).toBe('inner:500')
  expect(await command({ type: 'inspect', action: { kind: 'evaluate', code: 'window.scrollY' } })).toMatchObject({ value: 0 })
})

it('доходит до настоящего конца страницы длиннее 10000 пикселей и возвращается наверх', async () => {
  expect(await act({ kind: 'scroll', to: 'bottom' })).toMatchObject({ ok: true })
  expect(await command({ type: 'inspect', action: { kind: 'evaluate', code: 'Math.abs(window.scrollY + innerHeight - document.documentElement.scrollHeight) <= 1' } })).toMatchObject({ value: true })
  await act({ kind: 'scroll', to: 'top' })
  expect(await command({ type: 'inspect', action: { kind: 'evaluate', code: 'window.scrollY' } })).toMatchObject({ value: 0 })
})

it('выбирает option по видимой подписи, если она отличается от value', async () => {
  expect(await act({ kind: 'set', selector: '#language', value: 'Русский' })).toMatchObject({ ok: true })
  expect(await read('#select-result')).toBe('ru')
}, 15_000)

it('устанавливает range и доставляет странице оба события изменения', async () => {
  expect(await act({ kind: 'set', selector: '#range', value: '75' })).toMatchObject({ ok: true })
  expect(await read('#range-result')).toBe('range:75 input change')
})

it('изменение ширины моделью сохраняет текущую высоту окна', async () => {
  await command({ type: 'resize', viewport: { width: 820, height: 1180 } })
  await act({ kind: 'viewport', width: 390 })
  expect(await command({ type: 'status' })).toMatchObject({ viewport: { width: 390, height: 1180 } })
  expect(await command({ type: 'inspect', action: { kind: 'evaluate', code: 'innerHeight' } })).toMatchObject({ value: 1180 })
})

it('перетаскивает объект по координатам из контракта модели', async () => {
  await act({ kind: 'drag', from: { x: 1200, y: 60 }, to: { x: 1000, y: 160 } })
  expect(await read('#drag-result')).toBe('перенесено')
})

it('чтение после перехода сообщает модели URL и заголовок реальной страницы', async () => {
  await act({ kind: 'click', selector: '#next' })
  expect(await act({ kind: 'read' })).toMatchObject({ page: { url: `${fixture.origin}/next`, title: 'Следующая страница' }, text: 'Переход завершён' })
})

it('загружает файл нулевой длины', async () => {
  expect(await act({ kind: 'upload', selector: '#file', name: 'empty.txt', base64: '' })).toMatchObject({ ok: true })
  expect(await read('#file-result')).toBe('file:empty.txt:0')
})

it('повреждённое кодирование не превращается молча в другой файл', async () => {
  expect(await act({ kind: 'upload', selector: '#file', name: 'broken.txt', base64: 'YWJj$' })).toMatchObject({ ok: false, error: expect.stringMatching(/base64/i) })
  expect(await read('#file-result')).toBe('нет файла')
})

it('передаёт предельные 8 МБ через HTTP раннера и выбирает файл в Chromium', async () => {
  const app = await buildBrowserRunner({ token: 'forms-test', profilesRoot: root, sessions: manager, idleMs: 0 })
  try {
    const response = await app.inject({ method: 'POST', url: `/v1/sessions/${meta.id}/commands`, headers: { authorization: 'Bearer forms-test' }, payload: request({ type: 'selector', action: { kind: 'upload', selector: '#file', name: 'large.bin', base64: Buffer.alloc(BROWSER_UPLOAD_LIMIT_BYTES).toString('base64') } }) })
    expect(response.statusCode, response.body.slice(0, 200)).toBe(200)
    expect(response.json()).toMatchObject({ ok: true })
    expect(await read('#file-result')).toBe(`file:large.bin:${BROWSER_UPLOAD_LIMIT_BYTES}`)
  } finally { await app.close() }
}, 30_000)

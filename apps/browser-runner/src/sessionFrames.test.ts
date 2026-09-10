import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { runScenarioStep, type BrowserCommand, type BrowserFramePath, type BrowserFramesResult, type BrowserInspectResult, type BrowserSelectorAction, type BrowserSelectorResult, type BrowserSessionMetadata } from '@voicechat/shared'
import { BrowserSessionManager } from './sessionManager.js'
import type { BrowserCapture } from './screenshots.js'
import { startReaderFramesFixture } from './test/readerFrames.js'

let site: Awaited<ReturnType<typeof startReaderFramesFixture>>, manager: BrowserSessionManager, meta: BrowserSessionMetadata, profiles = ''
const ROOT = 'http://frames.reader.test/', CHILD = 'http://child.reader.test'
async function command(command: BrowserCommand): Promise<unknown> {
  return manager.command(meta.id, { requestId: randomUUID(), incarnation: meta.incarnation, actor: 'assistant', command })
}
const act = async (action: BrowserSelectorAction, frame?: BrowserFramePath) => await command({ type: 'selector', action, ...(frame === undefined ? {} : { frame }) }) as BrowserSelectorResult

beforeAll(async () => {
  site = await startReaderFramesFixture(); profiles = await mkdtemp(join(tmpdir(), 'vc-reader-frames-'))
  manager = new BrowserSessionManager(profiles, new Map([['frames.reader.test', new URL(site.origin).host], ['child.reader.test', new URL(site.childOrigin).host]]))
  meta = await manager.start({ sessionId: 'frames', userKey: 'test', conversationKey: 'frames' })
})
beforeEach(async () => { await command({ type: 'navigate', url: ROOT }); await act({ kind: 'wait', loadState: 'load' }) })
afterAll(async () => { await manager?.close(); await site?.close(); if (profiles) await rm(profiles, { recursive: true, force: true }) })

it('frames сообщает цепочки селекторов и актуальный адрес после редиректа iframe', async () => {
  const result = await command({ type: 'frames' }) as BrowserFramesResult
  expect(result).toMatchObject({ ok: true, total: 2, page: { url: ROOT } })
  expect(result.frames).toContainEqual(expect.objectContaining({ path: ['#outer'], url: `${CHILD}/frame`, name: 'preview', visible: true }))
  expect(result.frames).toContainEqual(expect.objectContaining({ path: ['#outer', '#nested'], url: `${CHILD}/nested`, title: 'Вложенный документ' }))
})

it('DOM-действие frame выбирает внутреннее поле и сохраняет родительское', async () => {
  expect(await act({ kind: 'read', selector: '#field' }, '#outer')).toMatchObject({ text: 'child', frame: { path: ['#outer'], url: `${CHILD}/frame` } })
  expect(await act({ kind: 'type', selector: '#field', text: 'Изменено внутри' }, '#outer')).toMatchObject({ ok: true })
  expect(await act({ kind: 'read', selector: '#field' }, '#outer')).toMatchObject({ text: 'Изменено внутри' })
  expect(await act({ kind: 'read', selector: '#field' })).toMatchObject({ text: 'parent' })
})

it('цепочка frame читает и меняет вложенный документ другого origin', async () => {
  const frame = ['#outer', '#nested']
  expect(await act({ kind: 'read', selector: '#field' }, frame)).toMatchObject({ text: 'nested' })
  expect(await act({ kind: 'click', selector: '#nested-action' }, frame)).toMatchObject({ ok: true })
  expect(await act({ kind: 'read' }, frame)).toMatchObject({ text: expect.stringContaining('Глубокий клик') })
})

it('wait использует URL, ready state и predicate выбранного frame', async () => {
  expect(await act({ kind: 'wait', url: `${CHILD}/frame`, loadState: 'load', predicate: 'window.frameMarker === "child"', timeoutMs: 200 }, '#outer')).toMatchObject({ ok: true })
})

it('evaluate читает глобальные переменные выбранного frame', async () => {
  expect(await command({ type: 'inspect', frame: '#outer', action: { kind: 'evaluate', code: 'window.frameMarker' } })).toMatchObject({ ok: true, value: 'child', page: { url: ROOT }, frame: { url: `${CHILD}/frame` } })
})

it('styles берёт стили внутреннего элемента с совпадающим родительским id', async () => {
  expect(await command({ type: 'inspect', frame: '#outer', action: { kind: 'styles', selector: '#field', properties: ['color'] } })).toMatchObject({ ok: true, styles: { color: 'rgb(0, 128, 0)' } })
})

it('снимок frame содержит его область и контекст, большой body явно усекается', async () => {
  const shot = await command({ type: 'screenshot', frame: '#outer', scale: 'css' }) as BrowserCapture
  expect(shot.metadata.frame).toMatchObject({ path: ['#outer'], url: `${CHILD}/frame` })
  expect(shot.buffer.readUInt32BE(16)).toBeLessThan(700)
  expect(shot.buffer.readUInt32BE(20)).toBeLessThan(550)
  const body = await command({ type: 'screenshot', frame: '#outer', selector: 'body', scale: 'css' }) as BrowserCapture
  expect(body.metadata.clipped).toBe(true)
  expect(body.buffer.readUInt32BE(20)).toBeLessThanOrEqual(500)
})

it('навигация frame сохраняет верхнюю страницу и политику адресов', async () => {
  expect(await command({ type: 'navigate', frame: '#outer', url: `${CHILD}/next` })).toMatchObject({ ok: true, page: { url: ROOT }, frame: { url: `${CHILD}/next` } })
  expect(await command({ type: 'status' })).toMatchObject({ currentUrl: ROOT })
  expect(await act({ kind: 'read' }, '#outer')).toMatchObject({ text: 'Внутренний переход' })
  await expect(command({ type: 'navigate', frame: '#outer', url: 'http://127.0.0.1:1/' })).rejects.toThrow(/blocked/)
})

it('координатная запись возвращает кнопку и путь frame для воспроизведения', async () => {
  // Кнопка стенда стоит в фиксированном месте внутри iframe, рамка — 4 CSS px.
  const geometry = await command({ type: 'inspect', action: { kind: 'evaluate', code: '(() => { const b=document.getElementById("outer").getBoundingClientRect(); return {x:b.x+4+360+70,y:b.y+4+30+15}; })()' } }) as BrowserInspectResult
  const point = geometry.value as { x: number; y: number }
  const described = await act({ kind: 'describe', ...point })
  expect(described.element).toMatchObject({ selector: '#record-target', frame: ['#outer'], tag: 'button' })
  expect(await act({ kind: 'click', selector: described.element!.selector }, described.element!.frame)).toMatchObject({ ok: true })
  expect(await act({ kind: 'read', selector: '#status' }, '#outer')).toMatchObject({ text: 'Записанный клик' })
})

it('шаг сценария выполняет действие и читает ожидание в том же frame', async () => {
  const outcome = await runScenarioStep({ id: 'frame-type', title: 'Поле компонента', action: { kind: 'type', frame: '#outer', selector: '#field', text: 'Запись' }, expectText: 'Внутренний документ' }, command, { expectTimeoutMs: 0 })
  expect(outcome).toMatchObject({ ok: true })
  expect(await act({ kind: 'read', selector: '#field' }, '#outer')).toMatchObject({ text: 'Запись' })
  expect(await act({ kind: 'read', selector: '#field' })).toMatchObject({ text: 'parent' })
})

it('неверный, неоднозначный и не-frame scope отказывает без действия на родителе', async () => {
  await expect(command({ type: 'selector', frame: [], action: { kind: 'type', selector: '#field', text: 'Ошибка' } })).rejects.toThrow(/frame/)
  await expect(command({ type: 'selector', frame: '#field', action: { kind: 'type', selector: '#field', text: 'Ошибка' } })).rejects.toThrow(/iframe/)
  expect(await act({ kind: 'read', selector: '#field' })).toMatchObject({ text: 'parent' })
})


it('styles принимает возвращённый find селектор Shadow DOM внутри frame', async () => {
  await command({ type: 'inspect', frame: '#outer', action: { kind: 'evaluate', code: '(() => { const host=document.createElement("div"); host.id="style-host"; document.body.prepend(host); const root=host.attachShadow({mode:"open"});root.innerHTML="<span id=shadow-target style=color:rgb(12,34,56)>Стиль компонента</span>"; })()' } })
  const found = await act({ kind: 'find', text: 'Стиль компонента' }, '#outer')
  expect(await command({ type: 'inspect', frame: '#outer', action: { kind: 'styles', selector: found.matches![0].selector, properties: ['color'] } })).toMatchObject({ styles: { color: 'rgb(12, 34, 56)' } })
})

it('замена iframe в SPA разрешает прежний путь в новый документ', async () => {
  await act({ kind: 'type', selector: '#field', text: 'Прежний документ' }, '#outer')
  await command({ type: 'inspect', action: { kind: 'evaluate', code: '(() => { const frame=document.getElementById("outer"); frame.replaceWith(frame.cloneNode(true)); })()' } })
  expect(await act({ kind: 'wait', selector: '#field', value: 'child' }, '#outer')).toMatchObject({ ok: true })
  expect(await act({ kind: 'read', selector: '#field' }, '#outer')).toMatchObject({ text: 'child' })
})

it('неоднозначный iframe и неподдерживаемая команда не выполняют действие', async () => {
  await expect(command({ type: 'newTab', frame: '#outer' })).rejects.toThrow(/не поддерживает frame/)
  await expect(command({ type: 'inspect', frame: '#outer', action: { kind: 'console' } })).rejects.toThrow(/не поддерживает frame/)
  await command({ type: 'inspect', action: { kind: 'evaluate', code: '(() => { const frame=document.getElementById("outer"); document.body.append(frame.cloneNode(true)); })()' } })
  await expect(command({ type: 'selector', frame: '#outer', action: { kind: 'read' } })).rejects.toThrow(/strict mode/)
  expect(await command({ type: 'status' })).toMatchObject({ tabs: [expect.anything()] })
})

it('описание учитывает масштаб iframe, а каталог — скрытого родителя', async () => {
  const geometry = await command({ type: 'inspect', action: { kind: 'evaluate', code: '(() => { const frame=document.getElementById("outer");frame.style.transform="scale(.8)";const b=frame.getBoundingClientRect(),s=b.width/frame.offsetWidth;return {x:b.x+(4+360+70)*s,y:b.y+(4+30+15)*s}; })()' } }) as BrowserInspectResult
  expect((await act({ kind: 'describe', ...geometry.value as { x: number; y: number } })).element).toMatchObject({ selector: '#record-target', frame: ['#outer'] })
  await command({ type: 'inspect', action: { kind: 'evaluate', code: 'document.getElementById("outer").style.display="none"' } })
  const catalog = await command({ type: 'frames' }) as BrowserFramesResult
  expect(catalog.frames).toHaveLength(2)
  expect(catalog.frames.every(frame => !frame.visible)).toBe(true)
})

it('не выдаёт снимок верхней страницы вместо неподдерживаемого fullPage iframe', async () => {
  await expect(command({ type: 'screenshot', frame: '#outer', fullPage: true })).rejects.toThrow(/fullPage/)
  await expect(command({ type: 'screenshot', frame: '#outer', rect: { x: 0, y: 0, width: 10, height: 10 } })).rejects.toThrow(/rect/)
})


it('после target=_top сообщает новый родительский URL и исчезновение frame', async () => {
  expect(await act({ kind: 'click', selector: '#top' }, '#outer')).toMatchObject({ ok: true, page: { url: `${CHILD}/next` }, frame: { path: ['#outer'], detached: true } })
  expect(await command({ type: 'status' })).toMatchObject({ currentUrl: `${CHILD}/next` })
  expect(await act({ kind: 'read' })).toMatchObject({ text: 'Внутренний переход' })
})

import type { BrowserCommand, BrowserInspectResult } from '@voicechat/shared'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import { BrowserSessionManager } from './sessionManager.js'
import { startReaderInputFixture } from './test/readerInput.js'
let root = '',
  site: Awaited<ReturnType<typeof startReaderInputFixture>>,
  manager: BrowserSessionManager,
  meta: Awaited<ReturnType<BrowserSessionManager['start']>>
const send = (command: BrowserCommand) =>
  manager.command(meta.id, { requestId: randomUUID(), incarnation: meta.incarnation, actor: 'user', command })
const value = async (code: string) =>
  ((await send({ type: 'inspect', action: { kind: 'evaluate', code } })) as BrowserInspectResult).value
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'vc-reader-input-'))
  site = await startReaderInputFixture()
})
beforeEach(async () => {
  manager = new BrowserSessionManager(root, new Map([['input.reader.test', new URL(site.origin).host]]))
  meta = await manager.start({ sessionId: randomUUID(), userKey: 'test', conversationKey: randomUUID() })
  await send({ type: 'navigate', url: 'http://input.reader.test/' })
})
afterEach(async () => {
  await manager?.close()
})
afterAll(async () => {
  await site?.close()
  await rm(root, { recursive: true, force: true })
})
it('колесо использует точку нового события, а не прежний cursor', async () => {
  await send({ type: 'input', action: { type: 'wheel', x: 400, y: 250, deltaX: 80, deltaY: 180 } })
  await expect
    .poll(() =>
      value('({left:document.querySelector("#pane").scrollLeft,top:document.querySelector("#pane").scrollTop})')
    )
    .toEqual({ left: 80, top: 180 })
})
it('горизонтальная прокрутка не сдвигает вертикаль по умолчанию', async () => {
  const result = await send({ type: 'selector', action: { kind: 'scroll', selector: '#pane', dx: 250 } })
  expect(result).toMatchObject({ ok: true, scrolled: { left: 250, top: 0, maxLeft: 900, maxTop: 1000 } })
})
it('горизонтальная прокрутка работает внутри iframe', async () => {
  expect(
    await send({ type: 'selector', frame: '#frame', action: { kind: 'scroll', selector: '#pane', dx: 250, dy: 40 } })
  ).toMatchObject({ ok: true, scrolled: { left: 250, top: 40 } })
})
it('отрицательный dx и верх страницы сохраняют независимость осей', async () => {
  await send({ type: 'selector', action: { kind: 'scroll', selector: '#pane', dx: 250, dy: 180 } })
  expect(
    await send({ type: 'selector', action: { kind: 'scroll', selector: '#pane', dx: -90, to: 'top' } })
  ).toMatchObject({ scrolled: { left: 160, top: 0 } })
})
it('мышь нажимается и отпускается по переданным координатам', async () => {
  await send({ type: 'input', action: { type: 'mouseDown', x: 330, y: 40 } })
  await send({ type: 'input', action: { type: 'mouseUp', x: 340, y: 40 } })
  expect(
    await value('events.filter(e=>e.type==="mousedown"||e.type==="mouseup").map(e=>({type:e.type,x:e.x,y:e.y}))')
  ).toEqual([
    { type: 'mousedown', x: 330, y: 40 },
    { type: 'mouseup', x: 340, y: 40 }
  ])
})
it('модификатор клика не остаётся на следующем клике', async () => {
  await send({ type: 'input', action: { type: 'click', x: 330, y: 40, modifiers: ['Shift'] } })
  await send({ type: 'input', action: { type: 'click', x: 330, y: 40 } })
  expect(await value('events.filter(e=>e.type==="click").map(e=>e.shift)')).toEqual([true, false])
})
it('два события панели дают два click и один dblclick', async () => {
  for (const detail of [1, 2] as const) await send({ type: 'input', action: { type: 'click', x: 330, y: 40, detail } })
  expect(
    await value('events.filter(e=>e.type==="click"||e.type==="dblclick").map(e=>({type:e.type,detail:e.detail}))')
  ).toEqual([
    { type: 'click', detail: 1 },
    { type: 'click', detail: 2 },
    { type: 'dblclick', detail: 2 }
  ])
})
it('native clickCount2 остаётся полным двойным кликом', async () => {
  await send({ type: 'input', action: { type: 'click', x: 330, y: 40, clickCount: 2 } })
  expect(await value('events.filter(e=>e.type==="click").length')).toBe(2)
  expect(await value('events.filter(e=>e.type==="dblclick").length')).toBe(1)
})
it('последовательный ввод Unicode и primary select-all работают в настоящем поле', async () => {
  await send({ type: 'selector', action: { kind: 'click', selector: '#field' } })
  await send({ type: 'input', action: { type: 'press', key: 'ControlOrMeta+a' } })
  await Promise.all(['Я', '😀', 'Z'].map((text) => send({ type: 'input', action: { type: 'type', text } })))
  expect(await value('document.querySelector("#field").value')).toBe('Я😀Z')
})

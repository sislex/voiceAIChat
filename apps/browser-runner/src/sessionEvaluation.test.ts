import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, beforeEach, afterAll, afterEach, expect, it } from 'vitest'
import {
  previewResultJson,
  type BrowserCommand,
  type BrowserFramePath,
  type BrowserInspectResult,
  type BrowserSessionMetadata
} from '@voicechat/shared'
import { BrowserSessionManager } from './sessionManager.js'
import { startReaderFramesFixture } from './test/readerFrames.js'
let root = '',
  site: Awaited<ReturnType<typeof startReaderFramesFixture>>,
  manager: BrowserSessionManager,
  meta: BrowserSessionMetadata
const send = (command: BrowserCommand) =>
  manager.command(meta.id, { requestId: randomUUID(), incarnation: meta.incarnation, actor: 'assistant', command })
const evaluate = async (code: string, timeoutMs?: number, frame?: BrowserFramePath) =>
  (await send({
    type: 'inspect',
    action: { kind: 'evaluate', code, ...(timeoutMs !== undefined ? { timeoutMs } : {}) },
    ...(frame ? { frame } : {})
  })) as BrowserInspectResult
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'vc-reader-eval-'))
  site = await startReaderFramesFixture()
})
beforeEach(async () => {
  manager = new BrowserSessionManager(
    root,
    new Map([
      ['eval.reader.test', new URL(site.origin).host],
      ['child.reader.test', new URL(site.childOrigin).host],
      ['oop.reader.test', new URL(site.childOrigin).host.replace('127.0.0.1', 'localhost')]
    ])
  )
  meta = await manager.start({ sessionId: randomUUID(), userKey: 'test', conversationKey: randomUUID() })
  await send({ type: 'navigate', url: 'http://eval.reader.test/' })
})
afterEach(async () => {
  await manager?.close()
})
afterAll(async () => {
  await site?.close()
  await rm(root, { recursive: true, force: true })
})
it('вычисляет выражения, программу и await результата без потери JSON', async () => {
  expect(await evaluate('Promise.resolve({ tasks: 3, ready: true, items: [1,null,"text"] })')).toMatchObject({
    ok: true,
    valueFormat: 'json',
    value: { tasks: 3, ready: true, items: [1, null, 'text'] },
    elapsedMs: expect.any(Number)
  })
  expect((await evaluate('window.readerCount=3; window.readerCount+1')).value).toBe(4)
})
it.each(['new Promise(()=>{})', 'while(true){}'])('прерывает %s и оставляет вкладку управляемой', async (code) => {
  const start = Date.now(),
    result = await evaluate(code, 150)
  expect(result).toMatchObject({ ok: false, timedOut: true, error: expect.stringContaining('лимит времени') })
  expect(Date.now() - start).toBeLessThan(1500)
  expect((await evaluate('document.querySelector("h1").textContent')).value).toBe('Родительский документ')
  expect(((await send({ type: 'status' })) as BrowserSessionMetadata).activeTabId).toBe(meta.activeTabId)
})
it('многократные отмены освобождают очередь, следующая команда исполняется', async () => {
  for (let i = 0; i < 5; i++) expect((await evaluate('new Promise(()=>{})', 100)).timedOut).toBe(true)
  expect((await evaluate('2+3')).value).toBe(5)
})
it('параллельный evaluate не перемешивает побочные действия', async () => {
  const pending = evaluate('new Promise(()=>{})', 250)
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(await evaluate('window.unexpected=true')).toMatchObject({
    ok: false,
    error: expect.stringContaining('уже выполняется')
  })
  await pending
  expect((await evaluate('window.unexpected')).valueType).toBe('undefined')
})
it('ожидание prompt не расходует лимит и сохраняет ответ сайта', async () => {
  await expect(evaluate('document.querySelector("h1").textContent=prompt("Название","Черновик")', 1000)).rejects.toThrow(
    'Открыт диалог'
  )
  await new Promise((resolve) => setTimeout(resolve, 1200))
  const state = (await send({ type: 'status' })) as BrowserSessionMetadata
  expect(state.dialogs).toHaveLength(1)
  await send({ type: 'handleDialog', dialogId: state.dialogs![0].id, accept: true, promptText: 'Ответ после паузы' })
  await expect
    .poll(async () => (await evaluate('document.querySelector("h1").textContent')).value)
    .toBe('Ответ после паузы')
})
it('status отдаёт вкладки и кеш заголовка при занятом renderer', async () => {
  const pending = evaluate('while(true){}', 700)
  await new Promise((resolve) => setTimeout(resolve, 50))
  const start = Date.now(),
    state = (await send({ type: 'status' })) as BrowserSessionMetadata
  expect(Date.now() - start).toBeLessThan(500)
  expect(state).toMatchObject({ activeTabId: meta.activeTabId, title: 'Страница проекта с iframe' })
  await pending
})
it('ограничение и восстановление действуют внутри iframe', async () => {
  expect((await evaluate('while(true){}', 150, '#outer')).timedOut).toBe(true)
  expect((await evaluate('document.title', undefined, '#outer')).value).toBe('Документ компонента')
  expect((await evaluate('document.title')).value).toBe('Страница проекта с iframe')
})
it('невалидный timeout и пустой код не исполняют программу', async () => {
  for (const timeout of [-1, 0, 1.5, 15001]) expect((await evaluate('window.invalid=true', timeout)).ok).toBe(false)
  expect((await evaluate(' ')).ok).toBe(false)
  expect((await evaluate('x'.repeat(4001))).ok).toBe(false)
  expect((await evaluate('window.invalid')).valueType).toBe('undefined')
})
it.each([
  ['123n', { $type: 'bigint', value: '123' }],
  ['undefined', { $type: 'undefined' }],
  ['NaN', { $type: 'number', value: 'NaN' }],
  ['-0', { $type: 'number', value: '-0' }],
  ['new Date("2026-09-10T00:00:00Z")', { $type: 'Date', value: '2026-09-10T00:00:00.000Z' }],
  ['new Map([["name","Reader"]])', { $type: 'Map', size: 1, entries: [['name', 'Reader']] }],
  ['new Set(["a","b"])', { $type: 'Set', size: 2, values: ['a', 'b'] }],
  ['new Uint8Array([0,128,255])', { $type: 'Uint8Array', byteLength: 3, values: [0, 128, 255] }],
  ['/reader/gi', { $type: 'RegExp', source: 'reader', flags: 'gi' }]
])('специальное значение %s сохраняет тип и данные', async (code, value) => {
  expect(await evaluate(code as string)).toMatchObject({ ok: true, valueFormat: 'preview', value })
})
it('циклические и повторные ссылки сохраняют полезные поля', async () => {
  expect((await evaluate('(()=>{const x={name:"Reader"};x.self=x;return {first:x,second:x}})()')).value).toEqual({
    first: { name: 'Reader', self: { $ref: '/value/first' } },
    second: { $ref: '/value/first' }
  })
})
it('DOM-узел описывает элемент, password не выдаёт value', async () => {
  expect((await evaluate('document.querySelector("h1")')).value).toMatchObject({
    $type: 'Element',
    tag: 'h1',
    text: 'Родительский документ',
    connected: true
  })
  const result = await evaluate(
    '(()=>{const x=document.createElement("input");x.type="password";x.value="private-password";document.body.append(x);return x})()'
  )
  expect(JSON.stringify(result)).not.toContain('private-password')
})
it('getter не вызывается во время сериализации результата', async () => {
  expect((await evaluate('({get x(){window.getterCalled=true;throw new Error("called")}})')).value).toEqual({
    x: { $type: 'accessor' }
  })
  expect((await evaluate('window.getterCalled')).valueType).toBe('undefined')
})
it('Error как значение содержит сообщение и стек, исключение остаётся отказом', async () => {
  expect((await evaluate('new Error("Ошибка значения")')).value).toMatchObject({
    $type: 'Error',
    message: 'Ошибка значения',
    stack: expect.stringContaining('Ошибка значения')
  })
  expect(await evaluate('missingStore.tasks')).toMatchObject({
    ok: false,
    error: expect.stringContaining('ReferenceError')
  })
})
it('длинные строки и структуры не переполняют MCP', async () => {
  for (const code of [
    '"x".repeat(30000)',
    '"\\u0000".repeat(20000)',
    'Array.from({length:300},(_,i)=>({i,text:"x".repeat(1000)}))'
  ]) {
    const result = await evaluate(code)
    expect(result.ok).toBe(true)
    expect(result.truncated).toBe(true)
    expect(JSON.stringify(result).length).toBeLessThan(21000)
    expect(previewResultJson(result)).not.toBeNull()
  }
})

it('прерывает отдельный renderer iframe и сохраняет родительский документ', async () => {
  await evaluate('document.querySelector("#outer").src="http://oop.reader.test/frame"')
  await send({
    type: 'selector',
    frame: '#outer',
    action: { kind: 'wait', url: 'http://oop.reader.test/frame', timeoutMs: 2000 }
  })
  expect((await evaluate('while(true){}', 150, '#outer')).timedOut).toBe(true)
  expect((await evaluate('document.title', undefined, '#outer')).value).toBe('Документ компонента')
  expect((await evaluate('document.title')).value).toBe('Страница проекта с iframe')
})

it('ограничение действует и на зависшую сериализацию результата', async () => {
  expect((await evaluate('new Proxy({}, {ownKeys(){while(true){}}})',150)).timedOut).toBe(true)
  expect((await evaluate('1+2')).value).toBe(3)
})

it('ссылки различают ключи с точкой, slash и тильдой', async () => {
  const result = await evaluate('(()=>{const first={name:"literal"},second={name:"nested"};return {"a.b":first,a:{b:second},"a/b~c":first,refs:[first,second]}})()')
  const value = result.value as any
  expect(value.refs[0].$ref).toBe('/value/a.b')
  expect(value.refs[1].$ref).toBe('/value/a/b')
  const escaped = await evaluate('(()=>{const x={name:"special"};return {"a/b~c":x,ref:x}})()')
  expect((escaped.value as any).ref.$ref).toBe('/value/a~1b~0c')
})
it('Map-ссылка указывает в возвращённый entries, а не в несуществующий values', async () => {
  const result = await evaluate('(()=>{const x={name:"map"};return new Map([["first",x],["again",x]])})()')
  expect((result.value as any).entries[1][1].$ref).toBe('/value/entries/0/1')
})


it('ручное управление отменяет очередь, пока evaluate ещё выполняется, и сохраняет status', async () => {
  const pending = evaluate('new Promise(()=>{})', 400)
  await expect.poll(async () => ((await send({ type: 'status' })) as BrowserSessionMetadata).queuedCommands).toBe(1)
  const navigation = send({ type: 'navigate', url: 'http://eval.reader.test/cancelled' }).then(() => 'unexpected', error => String(error))
  await manager.command(meta.id, { requestId: randomUUID(), incarnation: meta.incarnation, actor: 'user', command: { type: 'control', owner: 'user' } })
  expect(((await send({ type: 'status' })) as BrowserSessionMetadata).control).toBe('user')
  expect((await pending).timedOut).toBe(true)
  expect(await navigation).toContain('command_cancelled')
  await expect(send({ type: 'navigate', url: 'http://eval.reader.test/forbidden' })).rejects.toThrow('human_control')
  expect(((await send({ type: 'status' })) as BrowserSessionMetadata).currentUrl).toBe('http://eval.reader.test/')
  await manager.command(meta.id, { requestId: randomUUID(), incarnation: meta.incarnation, actor: 'user', command: { type: 'control', owner: 'shared' } })
  expect((await evaluate('1+2')).value).toBe(3)
})

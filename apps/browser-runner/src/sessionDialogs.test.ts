import type {
  BrowserCommand,
  BrowserDialogInfo,
  BrowserDialogListResult,
  BrowserSelectorResult,
  BrowserSessionMetadata
} from '@voicechat/shared'
import type { StartSessionRequest } from './sessionManager.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import { BrowserSessionManager } from './sessionManager.js'
import { startReaderDialogsFixture } from './test/readerDialogs.js'
let root = '',
  site: Awaited<ReturnType<typeof startReaderDialogsFixture>>,
  manager: BrowserSessionManager,
  meta: BrowserSessionMetadata,
  request: StartSessionRequest
const send = (command: BrowserCommand) =>
  manager.command(meta.id, { requestId: randomUUID(), incarnation: meta.incarnation, actor: 'assistant', command })
const dialogs = async () => ((await send({ type: 'dialogs' })) as BrowserDialogListResult).dialogs
const click = async (id: string) => {
  try {
    await send({ type: 'selector', action: { kind: 'click', selector: '#' + id } })
  } catch (error) {
    expect(String(error)).toContain('Открыт диалог')
  }
}
const read = async () =>
  ((await send({ type: 'selector', action: { kind: 'read', selector: '#result' } })) as BrowserSelectorResult).text
const handle = async (dialog: BrowserDialogInfo, accept: boolean, promptText?: string) =>
  send({ type: 'handleDialog', dialogId: dialog.id, accept, ...(promptText !== undefined ? { promptText } : {}) })
beforeAll(async () => {
  site = await startReaderDialogsFixture()
  root = await mkdtemp(join(tmpdir(), 'vc-reader-dialog-tests-'))
})
beforeEach(async () => {
  manager = new BrowserSessionManager(root, new Map([['dialog.reader.test', new URL(site.origin).host]]))
  request = { sessionId: randomUUID(), userKey: 'test', conversationKey: randomUUID(), profileMode: 'persistent' }
  meta = await manager.start(request)
  await send({ type: 'navigate', url: 'http://dialog.reader.test/' })
})
afterEach(async () => {
  await manager?.close()
})
afterAll(async () => {
  await site?.close()
  await rm(root, { recursive: true, force: true })
})
it('alert виден до ответа и не исчезает незаметно', async () => {
  await click('alert')
  const [dialog] = await dialogs()
  expect(dialog).toMatchObject({ type: 'alert', message: 'Сообщение сайта', tabId: meta.activeTabId! })
  await handle(dialog, true)
  expect(await read()).toBe('alert completed')
})
it.each([true, false])('confirm принимает явный ответ %s', async (accept) => {
  await click('confirm')
  await handle((await dialogs())[0], accept)
  expect(await read()).toBe('confirm:' + accept)
})
it('prompt показывает начальный текст и принимает новое имя', async () => {
  await click('prompt')
  const [dialog] = await dialogs()
  expect(dialog.defaultValue).toBe('Черновик')
  await handle(dialog, true, 'Новое имя')
  expect(await read()).toBe('prompt:Новое имя')
})
it('prompt принимает начальное значение при пропущенном тексте и пустую строку явно', async () => {
  await click('prompt')
  await handle((await dialogs())[0], true)
  expect(await read()).toBe('prompt:Черновик')
  await click('prompt')
  await handle((await dialogs())[0], true, '')
  expect(await read()).toBe('prompt:')
})
it('действие и status не висят на заблокированном JavaScript', async () => {
  const start = Date.now()
  await click('confirm')
  expect(Date.now() - start).toBeLessThan(1000)
  const status = (await send({ type: 'status' })) as BrowserSessionMetadata
  expect(status.dialogs).toHaveLength(1)
  await expect(send({ type: 'selector', action: { kind: 'read' } })).rejects.toThrow('Открыт диалог')
})
it('другая вкладка остаётся доступной при открытом диалоге', async () => {
  await click('confirm')
  const first = (await dialogs())[0]
  const second = (await send({ type: 'newTab', url: 'http://dialog.reader.test/other' })) as BrowserSessionMetadata
  expect(second.activeTabId).not.toBe(first.tabId)
  expect(await read()).toBe('Ready')
  expect((await dialogs())[0].tabId).toBe(first.tabId)
  await handle(first, false)
  await send({ type: 'selectTab', tabId: first.tabId })
  expect(await read()).toBe('confirm:false')
})
it('stale id не закрывает следующий диалог', async () => {
  await click('confirm')
  const first = (await dialogs())[0]
  await handle(first, true)
  await click('prompt')
  const next = (await dialogs())[0]
  await expect(handle(first, false)).rejects.toThrow('stale_dialog')
  expect((await dialogs())[0].id).toBe(next.id)
})
it('ошибка promptText не меняет confirm', async () => {
  await click('confirm')
  const dialog = (await dialogs())[0]
  await expect(handle(dialog, true, 'text')).rejects.toThrow('promptText')
  expect((await dialogs())[0].id).toBe(dialog.id)
})
it('следующий диалог не стирается завершением ответа предыдущему', async () => {
  await click('chain')
  await handle((await dialogs())[0], true)
  const next = (await dialogs())[0]
  expect(next.type).toBe('prompt')
  await handle(next, true, 'Документ')
  expect(await read()).toBe('chain:Документ')
})
it('beforeunload позволяет остаться или перейти', async () => {
  await click('guard')
  await expect(send({ type: 'navigate', url: 'http://dialog.reader.test/next' })).rejects.toThrow('beforeunload')
  await handle((await dialogs())[0], false)
  expect(((await send({ type: 'status' })) as BrowserSessionMetadata).currentUrl).toBe('http://dialog.reader.test/')
  await expect(send({ type: 'navigate', url: 'http://dialog.reader.test/next' })).rejects.toThrow('beforeunload')
  await handle((await dialogs())[0], true)
  await send({ type: 'selector', action: { kind: 'wait', url: 'http://dialog.reader.test/next' } })
  expect(((await send({ type: 'status' })) as BrowserSessionMetadata).currentUrl).toBe('http://dialog.reader.test/next')
})
it('закрытие вкладки уважает beforeunload', async () => {
  await click('guard')
  try {
    await send({ type: 'closeTab', tabId: meta.activeTabId! })
  } catch {}
  const [dialog] = await dialogs()
  expect(dialog.type).toBe('beforeunload')
  await handle(dialog, false)
  expect(((await send({ type: 'status' })) as BrowserSessionMetadata).tabs).toHaveLength(1)
})
it('остановка освобождает Chromium при неотвеченном диалоге', async () => {
  await click('alert')
  expect(await manager.stop(meta.id)).toBe(true)
  expect(manager.count()).toBe(0)
})
it('диалог восстановленной страницы возвращается вместе с ready стартом', async () => {
  await expect(send({ type: 'navigate', url: 'http://dialog.reader.test/initial' })).rejects.toThrow('alert')
  await manager.stop(meta.id)
  const start = Date.now()
  meta = await manager.start(request)
  expect(Date.now() - start).toBeLessThan(2000)
  expect(meta.dialogs![0]).toMatchObject({ type: 'alert', message: 'Начальное сообщение' })
  await handle(meta.dialogs![0], true)
  expect(await read()).toBe('Ready')
})

it('отмена prompt возвращает null, а повторный ответ не меняет результат', async () => {
  await click('prompt')
  const item = (await dialogs())[0]
  await handle(item, false)
  expect(await read()).toBe('prompt:null')
  await expect(handle(item, true)).rejects.toThrow('stale_dialog')
  expect(await read()).toBe('prompt:null')
})

it('невалидная вкладка, frame и ответ не закрывают текущий диалог', async () => {
  await click('prompt')
  const item = (await dialogs())[0]
  await expect(send({ type: 'dialogs', tabId: 'missing' })).rejects.toThrow('stale_tab')
  await expect(send({ type: 'dialogs', frame: '#frame' })).rejects.toThrow('frame')
  await expect(handle(item, false, 'text')).rejects.toThrow('promptText')
  await expect(handle(item, true, 'x'.repeat(20001))).rejects.toThrow('promptText')
  expect((await dialogs())[0].id).toBe(item.id)
})

it('снимок сообщает о диалоге сразу, журналы при этом читаются', async () => {
  await click('alert')
  await expect(send({ type: 'screenshot' })).rejects.toThrow('Открыт диалог')
  expect(await send({ type: 'inspect', action: { kind: 'console' } })).toMatchObject({ ok: true })
  expect(await send({ type: 'inspect', action: { kind: 'network' } })).toMatchObject({ ok: true })
})

it('длинное исходное значение prompt показывается частично и сохраняется целиком без правки', async () => {
  await expect(send({ type: 'inspect', action: { kind: 'evaluate', code: 'document.querySelector("#result").textContent=prompt("x".repeat(5000),"Я".repeat(3000))' } })).rejects.toThrow('Открыт диалог')
  const item = (await dialogs())[0]
  expect(item).toMatchObject({ messageTruncated: true, defaultValueTruncated: true })
  expect(item.message).toHaveLength(4000)
  expect(item.defaultValue).toHaveLength(2000)
  await handle(item, true)
  expect(await read()).toBe('Я'.repeat(3000))
})


it('очередь позволяет выбрать существующую вкладку, пока в прежней открыт диалог', async () => {
  const firstTab = meta.activeTabId
  const other = (await send({ type: 'newTab', url: 'http://dialog.reader.test/other' })) as BrowserSessionMetadata
  if (!firstTab || !other.activeTabId) throw new Error('Стенд не создал обе вкладки')
  await send({ type: 'selectTab', tabId: firstTab })
  await click('confirm')
  const [dialog] = await dialogs()
  const selected = (await send({ type: 'selectTab', tabId: other.activeTabId })) as BrowserSessionMetadata
  expect(selected.activeTabId).toBe(other.activeTabId)
  expect(selected.dialogs).toHaveLength(1)
  expect(await read()).toBe('Ready')
  await handle(dialog, false)
})

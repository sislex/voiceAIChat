import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import { isBrowserSessionMetadata, type BrowserCommand, type BrowserSessionMetadata } from '@voicechat/shared'
import { BrowserSessionManager } from './sessionManager.js'
import { previewOriginTarget } from './security.js'

const site = createServer((req, res) => {
  res.setHeader('content-type', 'text/html')
  res.end(`<title>${req.url}</title><button onclick="window.open('/popup')">Войти</button>`)
})
let base = '', root = ''
let manager: BrowserSessionManager
let meta: BrowserSessionMetadata
async function command(command: BrowserCommand) {
  const result = await manager.command(meta.id, { requestId: randomUUID(), incarnation: meta.incarnation, actor: 'assistant', command })
  if (isBrowserSessionMetadata(result)) meta = result
  return result
}
async function popup() {
  const opener = meta.activeTabId!
  const old = new Set(meta.tabs.map(tab => tab.id))
  expect(await command({ type: 'selector', action: { kind: 'click', selector: 'button' } })).toMatchObject({ ok: true })
  await expect.poll(async () => { await command({ type: 'status' }); return meta.tabs.length }).toBe(old.size + 1)
  return { opener, child: meta.tabs.find(tab => !old.has(tab.id))! }
}
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'vc-reader-tabs-'))
  await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(site.address() as { port: number }).port}`
})
beforeEach(async () => {
  manager = new BrowserSessionManager(root, new Map(), previewOriginTarget(base))
  meta = await manager.start({ sessionId: 'tabs', userKey: 'test', conversationKey: 'tabs' })
  await command({ type: 'navigate', url: base })
})
afterEach(async () => { await manager?.close() })
afterAll(async () => {
  site.closeAllConnections()
  await new Promise<void>(resolve => site.close(() => resolve()))
  if (root) await rm(root, { recursive: true, force: true })
})

it('popup сообщает id открывшей его вкладки', async () => {
  const { opener, child } = await popup()
  expect(child.openerTabId).toBe(opener)
})

it('закрытие активного popup возвращает к его opener, даже если он не первый', async () => {
  await command({ type: 'newTab', url: `${base}/opener` })
  const { opener, child } = await popup()
  await command({ type: 'selectTab', tabId: child.id })
  await command({ type: 'closeTab', tabId: child.id })
  expect(meta.activeTabId).toBe(opener)
})

it('если opener уже закрыт, выбирает живую вкладку', async () => {
  const first = meta.activeTabId
  await command({ type: 'newTab', url: `${base}/opener` })
  const { opener, child } = await popup()
  await command({ type: 'selectTab', tabId: child.id })
  await command({ type: 'closeTab', tabId: opener })
  await command({ type: 'closeTab', tabId: child.id })
  expect(meta.activeTabId).toBe(first)
})

it('новая вкладка использует выбранный размер, а не исходный размер контекста', async () => {
  await command({ type: 'resize', viewport: { width: 390, height: 844 } })
  await command({ type: 'newTab', url: base })
  expect(await command({ type: 'inspect', action: { kind: 'evaluate', code: '({width:innerWidth,height:innerHeight})' } })).toMatchObject({ value: { width: 390, height: 844 } })
})

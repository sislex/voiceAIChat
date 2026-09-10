import { BrowserDialogs } from './dialogs.js'
import { BrowserDownloads } from './downloads.js'
import { describe, expect, it, vi } from 'vitest'
import { BrowserCommandQueue } from './commandQueue.js'
import { BrowserSessionManager } from './sessionManager.js'
vi.mock('./screenshots.js', async importOriginal => ({
  ...await importOriginal<typeof import('./screenshots.js')>(),
  capturePage: async (page: { screenshot(): Promise<Buffer> }) => ({ buffer: await page.screenshot(), mimeType: 'image/png' })
}))
const sessionParts = () => ({ dialogs: new BrowserDialogs(), downloads: new BrowserDownloads(url => url), openerIds: new Map(), profileMode: 'ephemeral' as const })

describe('поллинг метаданных не присваивает действие модели пользователю', () => {
  it('метаданные текущего проекта показывают логический URL, включая новый fragment', async () => {
    const manager = new BrowserSessionManager('/tmp/unused-reader-status', new Map(), '127.0.0.1:9000')
    const raw = 'http://127.0.0.1:9000/api/preview?url=' + encodeURIComponent('https://app.internal/#/old') + '#/machines'
    const page = { url: () => raw, title: async () => 'Project' }
    const session = { ...sessionParts(), queue: new BrowserCommandQueue(), id: 'c', conversationKey: 'c', incarnation: 'inc', activeTabId: 'tab', pages: new Map([['tab',page]]), viewport: { width: 800, height: 600, deviceScaleFactor: 1 }, lastUsedAt: 0 }
    ;(manager as unknown as { sessions: Map<string,Promise<unknown>> }).sessions.set('c',Promise.resolve(session))
    expect(await manager.command('c',{requestId:'status',incarnation:'inc',actor:'user',command:{type:'status'}})).toMatchObject({currentUrl:'https://app.internal/#/machines'})
  })
  it('status и screenshot сохраняют lastActor и возвращают логический адрес', async () => {
    const manager = new BrowserSessionManager('/tmp/unused-reader-status', new Map([['93.184.216.34:8080','127.0.0.1:9000']]))
    const page = { url: () => 'http://127.0.0.1:9000/page', title: async () => 'Ready', screenshot: vi.fn(async () => Buffer.from('frame')) }
    const session = { ...sessionParts(), queue: new BrowserCommandQueue(), id: 'c', conversationKey: 'c', incarnation: 'inc', activeTabId: 'tab', pages: new Map([['tab',page]]), viewport: { width: 800, height: 600, deviceScaleFactor: 1 }, lastActor: 'assistant', lastUsedAt: 0 }
    ;(manager as unknown as { sessions: Map<string,Promise<unknown>> }).sessions.set('c',Promise.resolve(session))
    const status = await manager.command('c',{requestId:'status',incarnation:'inc',actor:'user',command:{type:'status'}})
    expect(status).toMatchObject({ currentUrl:'http://93.184.216.34:8080/page',title:'Ready',lastActor:'assistant' })
    await manager.command('c',{requestId:'frame',incarnation:'inc',actor:'user',command:{type:'screenshot'}})
    expect(session.lastActor).toBe('assistant');expect(session.lastUsedAt).toBeGreaterThan(0);expect(page.screenshot).toHaveBeenCalled()
  })
})


it('модель не может снять ручное управление или отменить очередь человека', async () => {
  const manager = new BrowserSessionManager('/tmp/unused-reader-control')
  const queue = new BrowserCommandQueue()
  queue.control('user')
  ;(manager as unknown as { sessions: Map<string, Promise<unknown>> }).sessions.set('c', Promise.resolve({ queue, incarnation: 'inc' }))
  for (const command of [{ type: 'control', owner: 'shared' }, { type: 'cancel' }] as const) {
    await expect(manager.command('c', { requestId: 'r', incarnation: 'inc', actor: 'assistant', command })).rejects.toThrow('human_control')
  }
  expect(queue.owner).toBe('user')
})


it('повторный start ждёт закрытия предыдущего контекста', async () => {
  const manager = new BrowserSessionManager('/tmp/unused-reader-restart')
  let finish!: () => void
  const closing = new Promise<void>(resolve => { finish = resolve })
  const page = { url: () => 'https://example.org', title: async () => 'Page' }
  const old = { ...sessionParts(), id: 'c', userKey: 'u', conversationKey: 'c', incarnation: 'old', queue: new BrowserCommandQueue(), context: { close: () => closing }, profileDir: '/tmp/unused-reader-restart/old', pages: new Map([['tab', page]]), activeTabId: 'tab', viewport: { width: 800, height: 600, deviceScaleFactor: 1 } }
  const internal = manager as unknown as { sessions: Map<string, Promise<unknown>>; create: (request: unknown) => Promise<unknown> }
  internal.sessions.set('c', Promise.resolve(old))
  internal.create = vi.fn(async () => ({ ...old, incarnation: 'new', queue: new BrowserCommandQueue() }))
  const stop = manager.stop('c')
  const start = manager.start({ sessionId: 'c', userKey: 'u', conversationKey: 'c' })
  await Promise.resolve(); await Promise.resolve()
  const callsBeforeClose = vi.mocked(internal.create).mock.calls.length
  finish()
  await stop
  expect(await start).toMatchObject({ incarnation: 'new' })
  expect(callsBeforeClose).toBe(0)
  expect(internal.create).toHaveBeenCalledTimes(1)
})

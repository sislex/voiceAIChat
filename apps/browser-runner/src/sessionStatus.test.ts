import { describe, expect, it, vi } from 'vitest'
import { BrowserSessionManager } from './sessionManager.js'

describe('поллинг метаданных не присваивает действие модели пользователю', () => {
  it('метаданные текущего проекта показывают логический URL, включая новый fragment', async () => {
    const manager = new BrowserSessionManager('/tmp/unused-reader-status', new Map(), '127.0.0.1:9000')
    const raw = 'http://127.0.0.1:9000/api/preview?url=' + encodeURIComponent('https://app.internal/#/old') + '#/machines'
    const page = { url: () => raw, title: async () => 'Project' }
    const session = { id: 'c', conversationKey: 'c', incarnation: 'inc', activeTabId: 'tab', pages: new Map([['tab',page]]), viewport: { width: 800, height: 600, deviceScaleFactor: 1 }, lastUsedAt: 0 }
    ;(manager as unknown as { sessions: Map<string,Promise<unknown>> }).sessions.set('c',Promise.resolve(session))
    expect(await manager.command('c',{requestId:'status',incarnation:'inc',actor:'user',command:{type:'status'}})).toMatchObject({currentUrl:'https://app.internal/#/machines'})
  })
  it('status и screenshot сохраняют lastActor и возвращают логический адрес', async () => {
    const manager = new BrowserSessionManager('/tmp/unused-reader-status', new Map([['93.184.216.34:8080','127.0.0.1:9000']]))
    const page = { url: () => 'http://127.0.0.1:9000/page', title: async () => 'Ready', screenshot: vi.fn(async () => Buffer.from('frame')) }
    const session = { id: 'c', conversationKey: 'c', incarnation: 'inc', activeTabId: 'tab', pages: new Map([['tab',page]]), viewport: { width: 800, height: 600, deviceScaleFactor: 1 }, lastActor: 'assistant', lastUsedAt: 0 }
    ;(manager as unknown as { sessions: Map<string,Promise<unknown>> }).sessions.set('c',Promise.resolve(session))
    const status = await manager.command('c',{requestId:'status',incarnation:'inc',actor:'user',command:{type:'status'}})
    expect(status).toMatchObject({ currentUrl:'http://93.184.216.34:8080/page',title:'Ready',lastActor:'assistant' })
    await manager.command('c',{requestId:'frame',incarnation:'inc',actor:'user',command:{type:'screenshot'}})
    expect(session.lastActor).toBe('assistant');expect(session.lastUsedAt).toBeGreaterThan(0);expect(page.screenshot).toHaveBeenCalled()
  })
})

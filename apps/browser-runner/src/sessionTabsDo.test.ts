// Круг 14: вкладки так, как их называет человек. Модель искала вкладку по
// идентификатору из tabs, ждала новую опросом в цикле и закрывала лишние по
// одной, путаясь в списке, который менялся под руками.

import { describe, expect, it, vi } from 'vitest'
import { BrowserDialogs } from './dialogs.js'
import { BrowserDownloads } from './downloads.js'
import { BrowserCommandQueue } from './commandQueue.js'
import { SessionHistory } from './sessionHistory.js'
import { SessionSnapshots } from './snapshots.js'
import { NetworkRules } from './networkRules.js'
import { BrowserSessionManager } from './sessionManager.js'

function page(url: string, title: string) {
  return { url: () => url, title: async () => title, isClosed: () => false, close: vi.fn(async () => {}) }
}

function withTabs(pages: Array<[string, ReturnType<typeof page>]>, active = pages[0][0]) {
  const manager = new BrowserSessionManager('/tmp/unused-reader-tabs', new Map())
  const session = {
    dialogs: new BrowserDialogs(), downloads: new BrowserDownloads((url) => url), openerIds: new Map(),
    history: new SessionHistory(), queue: new BrowserCommandQueue(), snapshots: new SessionSnapshots(),
    networkRules: new NetworkRules(), startedAt: Date.now(), profileMode: 'ephemeral' as const,
    id: 'c', conversationKey: 'c', incarnation: 'inc', activeTabId: active,
    pages: new Map(pages), viewport: { width: 800, height: 600, deviceScaleFactor: 1 }, lastUsedAt: 0
  }
  ;(manager as unknown as { sessions: Map<string, Promise<unknown>> }).sessions.set('c', Promise.resolve(session))
  const send = (command: unknown) => manager.command('c', { requestId: 'r', incarnation: 'inc', actor: 'assistant', command } as never)
  return { session, send }
}

describe('вкладки по-человечески', () => {
  it('находит вкладку по части заголовка', async () => {
    const { session, send } = withTabs([['a', page('https://a.b/', 'Главная')], ['b', page('https://a.b/cart', 'Корзина')]])
    await send({ type: 'tabs-do', do: 'find', match: 'корзин' })
    expect(session.activeTabId).toBe('b')
  })

  it('находит вкладку по части адреса', async () => {
    const { session, send } = withTabs([['a', page('https://a.b/', 'Главная')], ['b', page('https://a.b/checkout', 'Оплата')]])
    await send({ type: 'tabs-do', do: 'find', match: '/checkout' })
    expect(session.activeTabId).toBe('b')
  })

  it('когда такой вкладки нет — отказ со ссылкой на tabs, а не молчание', async () => {
    const { send } = withTabs([['a', page('https://a.b/', 'Главная')]])
    await expect(send({ type: 'tabs-do', do: 'find', match: 'корзина' })).rejects.toThrow('tabs')
  })

  it('пустой запрос отвергается: он выбрал бы первую попавшуюся вкладку', async () => {
    const { send } = withTabs([['a', page('https://a.b/', 'Главная')]])
    await expect(send({ type: 'tabs-do', do: 'find', match: '   ' })).rejects.toThrow('текст')
  })

  it('ожидание новой вкладки переключается на неё, как только она появилась', async () => {
    const { session, send } = withTabs([['a', page('https://a.b/', 'Главная')]])
    const waiting = send({ type: 'tabs-do', do: 'wait-new', timeoutMs: 5_000 })
    setTimeout(() => session.pages.set('b', page('https://a.b/popup', 'Попап')), 200)
    await waiting
    expect(session.activeTabId).toBe('b')
  })

  it('если вкладка так и не открылась — понятный отказ', async () => {
    const { send } = withTabs([['a', page('https://a.b/', 'Главная')]])
    await expect(send({ type: 'tabs-do', do: 'wait-new', timeoutMs: 600 })).rejects.toThrow('не появилась')
  })

  it('«закрыть лишние» оставляет текущую', async () => {
    const first = page('https://a.b/', 'Главная')
    const second = page('https://a.b/cart', 'Корзина')
    const { send } = withTabs([['a', first], ['b', second]], 'b')
    await send({ type: 'tabs-do', do: 'close-others' })
    expect(first.close).toHaveBeenCalled()
    expect(second.close).not.toHaveBeenCalled()
  })
})

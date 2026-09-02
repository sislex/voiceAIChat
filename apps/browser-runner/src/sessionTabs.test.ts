// Вкладки сессии без настоящего Chromium: страницы и контекст подменены.
//
// Две беды круга 30: `selectTab` с неизвестным id записывался как есть, и
// сессия отвечала stale_tab на всё подряд; закрытие последней вкладки оставляло
// сессию без страниц — панель пряталa кнопку у последней, но модель и сама
// страница (`window.close()`) кнопок не видят.
//
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { BrowserSessionManager } from './sessionManager.js'

interface FakePage { on: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; url: () => string; title: () => Promise<string> }

function fakePage(url = 'about:blank'): FakePage {
  return { on: vi.fn(), close: vi.fn(async () => undefined), url: () => url, title: async () => '' }
}

function sessionWith(pages: Record<string, FakePage>, activeTabId: string): { manager: BrowserSessionManager; session: Record<string, unknown>; opened: FakePage[] } {
  const manager = new BrowserSessionManager('/tmp/vc-browser-profiles-test')
  const opened: FakePage[] = []
  const session = {
    id: 's', conversationKey: 'c', incarnation: 'inc', lastUsedAt: 0, activeTabId,
    pages: new Map(Object.entries(pages)), pageIds: new WeakMap(), console: [], network: [],
    viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
    context: { newPage: vi.fn(async () => { const page = fakePage(); opened.push(page); return page }) }
  }
  const map = (manager as unknown as { sessions: Map<string, Promise<unknown>> }).sessions
  map.set('s', Promise.resolve(session))
  return { manager, session, opened }
}

const request = (command: unknown) => ({ requestId: 'r', incarnation: 'inc', actor: 'user', command }) as never

describe('selectTab', () => {
  it('неизвестная вкладка отвергается, активная остаётся прежней', async () => {
    const { manager, session } = sessionWith({ a: fakePage('https://a/'), b: fakePage('https://b/') }, 'a')
    await expect(manager.command('s', request({ type: 'selectTab', tabId: 'нет-такой' }))).rejects.toThrow('stale_tab')
    expect(session.activeTabId).toBe('a')
  })
  it('известная вкладка становится активной', async () => {
    const { manager, session } = sessionWith({ a: fakePage('https://a/'), b: fakePage('https://b/') }, 'a')
    const meta = await manager.command('s', request({ type: 'selectTab', tabId: 'b' })) as { activeTabId: string; currentUrl: string }
    expect(session.activeTabId).toBe('b')
    expect(meta.currentUrl).toBe('https://b/')
  })
})

describe('closeTab', () => {
  it('последняя вкладка закрывается с пустой взамен — сессия не остаётся без страниц', async () => {
    const only = fakePage('https://a/')
    const { manager, session, opened } = sessionWith({ a: only }, 'a')
    await manager.command('s', request({ type: 'closeTab', tabId: 'a' }))
    expect(only.close).toHaveBeenCalled()
    expect(opened).toHaveLength(1)
    // Новая вкладка зарегистрирована и активна ещё до закрытия старой.
    const pages = session.pages as Map<string, FakePage>
    expect([...pages.values()]).toContain(opened[0])
    expect(pages.get(session.activeTabId as string)).toBe(opened[0])
  })
  it('не последняя вкладка закрывается без пустой взамен', async () => {
    const a = fakePage('https://a/')
    const { manager, opened } = sessionWith({ a, b: fakePage('https://b/') }, 'b')
    await manager.command('s', request({ type: 'closeTab', tabId: 'a' }))
    expect(a.close).toHaveBeenCalled()
    expect(opened).toHaveLength(0)
  })
  it('несуществующая вкладка — stale_tab, а не молчаливое «ок»', async () => {
    const { manager } = sessionWith({ a: fakePage() }, 'a')
    await expect(manager.command('s', request({ type: 'closeTab', tabId: 'x' }))).rejects.toThrow('stale_tab')
  })
})

describe('ошибки навигации', () => {
  it('сетевой код Playwright переводится словами до выхода из раннера', async () => {
    const page = { ...fakePage('https://a/'), goto: vi.fn(async () => { throw new Error('page.goto: net::ERR_NAME_NOT_RESOLVED at https://нет.example/\nCall log:\n  - navigating') }) }
    const { manager } = sessionWith({ a: page as never }, 'a')
    await expect(manager.command('s', request({ type: 'navigate', url: 'https://нет.example/' })))
      .rejects.toThrow('Страница не открылась: имя сайта не разрешается (проверьте адрес) — https://нет.example/')
  })
})

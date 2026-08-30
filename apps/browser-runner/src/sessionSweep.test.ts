// Сборка брошенных сессий. До круга 10 её не было вовсе: Chromium держался до
// явного `stop`, а его никто не звал, если пользователь просто закрыл вкладку
// или ран оборвался — процесс жил до перезапуска контейнера.
//
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { BrowserSessionManager, nextActiveTab } from './sessionManager.js'

/** Подставляем внутренности вместо запуска настоящего Chromium. */
function managerWith(sessions: Array<{ id: string; lastUsedAt: number }>): { manager: BrowserSessionManager; closed: string[] } {
  const manager = new BrowserSessionManager('/tmp/vc-browser-profiles-test')
  const closed: string[] = []
  const map = (manager as unknown as { sessions: Map<string, Promise<unknown>> }).sessions
  for (const item of sessions) {
    map.set(item.id, Promise.resolve({
      id: item.id, lastUsedAt: item.lastUsedAt, profileDir: `/tmp/vc-browser-profiles-test/${item.id}`,
      context: { close: vi.fn(async () => { closed.push(item.id) }) }
    }))
  }
  return { manager, closed }
}

describe('sweepIdle', () => {
  it('закрывает сессии, к которым давно не обращались', async () => {
    const now = 1_000_000
    const { manager, closed } = managerWith([
      { id: 'свежая', lastUsedAt: now - 60_000 },
      { id: 'брошенная', lastUsedAt: now - 40 * 60_000 }
    ])
    expect(await manager.sweepIdle(30 * 60_000, now)).toEqual(['брошенная'])
    expect(closed).toEqual(['брошенная'])
    expect(manager.count()).toBe(1)
  })

  it('ничего не закрывает, пока порог не достигнут', async () => {
    const now = 1_000_000
    const { manager, closed } = managerWith([{ id: 'живая', lastUsedAt: now - 29 * 60_000 }])
    expect(await manager.sweepIdle(30 * 60_000, now)).toEqual([])
    expect(closed).toEqual([])
  })
})

describe('отметка обращения', () => {
  it('ставится на любой команде, а не только на той, что вернёт метаданные', async () => {
    // Прогон сценария — это подряд селекторные команды: они возвращаются
    // раньше метаданных, и сессия выглядела брошенной, пока в ней работали.
    const manager = new BrowserSessionManager('/tmp/vc-browser-profiles-test')
    const map = (manager as unknown as { sessions: Map<string, Promise<unknown>> }).sessions
    const session = { id: 'живая', incarnation: 'inc', lastUsedAt: 0, activeTabId: 'tab', pages: new Map([['tab', {}]]) }
    map.set('живая', Promise.resolve(session))
    await manager.command('живая', {
      requestId: 'r1', incarnation: 'inc', actor: 'assistant',
      command: { type: 'selector', action: { kind: 'read' } }
    } as never).catch(() => undefined)
    expect(session.lastUsedAt).toBeGreaterThan(0)
  })
})

describe('nextActiveTab', () => {
  it('закрытая вкладка не остаётся активной — иначе каждая команда падает stale_tab', () => {
    expect(nextActiveTab(['b', 'c'], 'a', 'a')).toBe('b')
  })
  it('закрытие неактивной вкладки активную не трогает', () => {
    expect(nextActiveTab(['a', 'c'], 'a', 'b')).toBe('a')
  })
  it('последняя закрытая вкладка оставляет сессию без активной', () => {
    expect(nextActiveTab([], 'a', 'a')).toBe('')
  })
})

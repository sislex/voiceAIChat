// Круг 4: среда, в которой сидит человек. Тёмная тема, уменьшенная анимация,
// высокий контраст, отсутствие сети и геопозиция — под каждой из них страница
// ведёт себя иначе, и такие дефекты иначе находит только тот, у кого именно
// такая настройка. Контекст Playwright подменяется фейком: Chromium не нужен.

import { describe, expect, it, vi } from 'vitest'
import type { BrowserContext } from 'playwright'
import { applyEnvironment, applyEnvironmentToPage, currentEnvironment, runCookieCommand } from './environmentActions'

function holder(pages: Array<{ emulateMedia: ReturnType<typeof vi.fn> }> = [{ emulateMedia: vi.fn(async () => {}) }]) {
  const context = {
    pages: () => pages,
    setOffline: vi.fn(async () => {}),
    setGeolocation: vi.fn(async () => {}),
    grantPermissions: vi.fn(async () => {}),
    clearPermissions: vi.fn(async () => {})
  } as unknown as BrowserContext
  return { session: { context } as { context: BrowserContext; environment?: ReturnType<typeof currentEnvironment> }, context, pages }
}

describe('эмуляция среды', () => {
  it('тема, анимация и контраст доходят до каждой вкладки сессии', async () => {
    const { session, pages } = holder([{ emulateMedia: vi.fn(async () => {}) }, { emulateMedia: vi.fn(async () => {}) }])
    const state = await applyEnvironment(session, { colorScheme: 'dark', reducedMotion: 'reduce', forcedColors: 'active' })
    for (const page of pages) expect(page.emulateMedia).toHaveBeenCalledWith({ colorScheme: 'dark', reducedMotion: 'reduce', forcedColors: 'active' })
    expect(state).toMatchObject({ colorScheme: 'dark', reducedMotion: 'reduce', forcedColors: 'active' })
  })

  it('прежние настройки сохраняются: одно поле не сбрасывает остальные', async () => {
    const { session } = holder()
    await applyEnvironment(session, { colorScheme: 'dark' })
    const state = await applyEnvironment(session, { offline: true })
    expect(state).toMatchObject({ colorScheme: 'dark', offline: true })
  })

  it('координаты выдаются вместе с разрешением: без него страница получила бы отказ', async () => {
    const { session, context } = holder()
    const state = await applyEnvironment(session, { geolocation: { latitude: 55.75, longitude: 37.62 } })
    expect(context.grantPermissions).toHaveBeenCalledWith(['geolocation'])
    expect(context.setGeolocation).toHaveBeenCalledWith({ latitude: 55.75, longitude: 37.62 })
    expect(state.permissions).toContain('geolocation')
  })

  it('невозможные координаты отвергаются до обращения к браузеру', async () => {
    const { session, context } = holder()
    await expect(applyEnvironment(session, { geolocation: { latitude: 100, longitude: 0 } })).rejects.toThrow('диапазона')
    expect(context.setGeolocation).not.toHaveBeenCalled()
  })

  it('null убирает позицию, пустой список разрешений отзывает их', async () => {
    const { session, context } = holder()
    await applyEnvironment(session, { geolocation: { latitude: 1, longitude: 2 } })
    const cleared = await applyEnvironment(session, { geolocation: null, permissions: [] })
    expect(context.setGeolocation).toHaveBeenLastCalledWith(null)
    expect(context.clearPermissions).toHaveBeenCalled()
    expect(cleared.geolocation).toBeNull()
    expect(cleared.permissions).toEqual([])
  })

  it('вкладка, открытая позже, получает ту же среду', async () => {
    const { session } = holder()
    await applyEnvironment(session, { colorScheme: 'dark' })
    const later = { emulateMedia: vi.fn(async () => {}) }
    await applyEnvironmentToPage(session, later)
    expect(later.emulateMedia).toHaveBeenCalledWith(expect.objectContaining({ colorScheme: 'dark' }))
  })

  it('без эмуляции новая вкладка не трогается вовсе', async () => {
    const { session } = holder()
    const later = { emulateMedia: vi.fn(async () => {}) }
    await applyEnvironmentToPage(session, later)
    expect(later.emulateMedia).not.toHaveBeenCalled()
  })
})

describe('cookies сессии', () => {
  function cookieContext(initial: Array<{ name: string; value: string; domain: string; path: string }>) {
    let store = [...initial]
    return {
      cookies: vi.fn(async () => store),
      addCookies: vi.fn(async (items: typeof store) => { store = [...store, ...items] }),
      clearCookies: vi.fn(async () => { store = [] }),
      get store() { return store }
    } as unknown as BrowserContext & { store: typeof initial }
  }

  it('длинное значение не уезжает в ход целиком: это доступ к аккаунту', async () => {
    const context = cookieContext([{ name: 'session', value: 'a'.repeat(64), domain: 'a.b', path: '/' }])
    const result = await runCookieCommand(context, { action: 'list' })
    expect(result.cookies[0].value).toMatch(/симв\./)
    expect(result.cookies[0].value).not.toContain('aaaaaaaaaaaa')
  })

  it('удаление одной cookie возвращает остальные на место', async () => {
    const context = cookieContext([
      { name: 'session', value: 'x', domain: 'a.b', path: '/' },
      { name: 'theme', value: 'dark', domain: 'a.b', path: '/' }
    ])
    const result = await runCookieCommand(context, { action: 'clear', name: 'theme' })
    expect(result.cookies.map((cookie) => cookie.name)).toEqual(['session'])
  })

  it('добавление требует и значения, и адреса', async () => {
    const context = cookieContext([])
    await expect(runCookieCommand(context, { action: 'add', name: 'a' })).rejects.toThrow('name и value')
    await expect(runCookieCommand(context, { action: 'add', name: 'a', value: 'b' })).rejects.toThrow('url или domain')
  })

  it('list по имени отдаёт только её', async () => {
    const context = cookieContext([
      { name: 'session', value: 'x', domain: 'a.b', path: '/' },
      { name: 'theme', value: 'dark', domain: 'a.b', path: '/' }
    ])
    const result = await runCookieCommand(context, { action: 'list', name: 'theme' })
    expect(result.total).toBe(1)
    expect(result.cookies[0].name).toBe('theme')
  })
})

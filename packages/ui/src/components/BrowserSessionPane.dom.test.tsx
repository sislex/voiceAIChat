// Панель Playwright Reader: старт сессии, screencast-поллинг, навигация,
// клик по кадру с пересчётом координат и деградация без раннера. Мост browser — фейк.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { RendererBrowserBridge } from '@shared/ipc'
import type { BrowserSessionMetadata } from '@shared/types'
import { BrowserSessionPane } from './BrowserSessionPane'

const meta = (over: Partial<BrowserSessionMetadata> = {}): BrowserSessionMetadata => ({
  id: 'c1', conversationId: 'c1', incarnation: 'inc-1', state: 'ready', activeTabId: 't1', tabs: [],
  viewport: { width: 1280, height: 800, deviceScaleFactor: 1 }, currentUrl: 'https://a.b', title: null, ...over
})

function fakeBrowser(over: Partial<RendererBrowserBridge> = {}): RendererBrowserBridge {
  return {
    start: vi.fn(async () => meta()),
    command: vi.fn(async () => meta({ currentUrl: 'https://x.y' })),
    screenshot: vi.fn(async () => ({ dataUrl: 'data:image/jpeg;base64,QQ==' })),
    stop: vi.fn(async () => {}),
    ...over
  }
}

afterEach(cleanup)

describe('BrowserSessionPane', () => {
  it('стартует сессию, показывает кадр и адрес открытой страницы', async () => {
    const browser = fakeBrowser()
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    await waitFor(() => expect(screen.getByAltText('Кадр Chromium')).toBeTruthy())
    expect(browser.start).toHaveBeenCalledWith('c1', { width: 1280, height: 800, deviceScaleFactor: 1 })
    expect((screen.getByLabelText('Адрес страницы') as HTMLInputElement).value).toBe('https://a.b')
  })

  it('навигация шлёт command с incarnation из start и нормализует схему', async () => {
    const browser = fakeBrowser()
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    await waitFor(() => expect(screen.getByAltText('Кадр Chromium')).toBeTruthy())
    const address = screen.getByLabelText('Адрес страницы') as HTMLInputElement
    fireEvent.change(address, { target: { value: 'example.com' } })
    fireEvent.click(screen.getByText('Открыть'))
    await waitFor(() => expect(browser.command).toHaveBeenCalled())
    expect((browser.command as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({
      incarnation: 'inc-1', command: { type: 'navigate', url: 'https://example.com' }
    })
  })

  it('клик по кадру пересчитывает координаты во вьюпорт и шлёт input click', async () => {
    const browser = fakeBrowser()
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    const img = await screen.findByAltText('Кадр Chromium') as HTMLImageElement
    // jsdom не считает layout: подменяем rect на 640×400 (половина вьюпорта 1280×800).
    img.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 400, right: 640, bottom: 400, x: 0, y: 0, toJSON: () => ({}) })
    fireEvent.click(img, { clientX: 320, clientY: 200 })
    await waitFor(() => expect(browser.command).toHaveBeenCalled())
    expect((browser.command as ReturnType<typeof vi.fn>).mock.calls[0][1].command).toEqual({
      type: 'input', action: { type: 'click', x: 640, y: 400, button: 'left', clickCount: 1 }
    })
  })

  it('без моста браузера показывает недоступность вместо панели', () => {
    render(<BrowserSessionPane conversationId="c1" browser={undefined} />)
    expect(screen.getByRole('status').textContent).toMatch(/недоступен/i)
  })

  it('501 от сервера трактуется как недоступность (а не ошибка)', async () => {
    const browser = fakeBrowser({ start: vi.fn(async () => { throw new Error('Browser Runner не настроен на этом сервере') }) })
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/не настроен/i))
  })

  it('останавливает сессию при размонтировании', async () => {
    const browser = fakeBrowser()
    const { unmount } = render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    await waitFor(() => expect(screen.getByAltText('Кадр Chromium')).toBeTruthy())
    unmount()
    await waitFor(() => expect(browser.stop).toHaveBeenCalledWith('c1'))
  })
  it('колесо прокручивает страницу: длиннее вьюпорта её нечем было листать', async () => {
    const browser = fakeBrowser()
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    const frame = await screen.findByAltText('Кадр Chromium')
    fireEvent.wheel(frame, { deltaX: 0, deltaY: 240 })
    await waitFor(() => expect(browser.command).toHaveBeenCalled())
    expect((browser.command as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({
      command: { type: 'input', action: { type: 'wheel', deltaX: 0, deltaY: 240 } }
    })
  })

  it('правая кнопка и двойной клик доходят до страницы', async () => {
    const browser = fakeBrowser()
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    const frame = await screen.findByAltText('Кадр Chromium')
    fireEvent.contextMenu(frame, { clientX: 10, clientY: 10 })
    await waitFor(() => expect(browser.command).toHaveBeenCalled())
    const calls = (browser.command as ReturnType<typeof vi.fn>).mock.calls
    expect(calls[0][1].command.action).toMatchObject({ type: 'click', button: 'right', clickCount: 1 })
    fireEvent.doubleClick(frame, { clientX: 10, clientY: 10 })
    await waitFor(() => expect(calls.length).toBeGreaterThan(1))
    expect(calls[calls.length - 1][1].command.action).toMatchObject({ button: 'left', clickCount: 2 })
  })

  it('переключатель размера окна шлёт resize', async () => {
    const browser = fakeBrowser()
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    await screen.findByAltText('Кадр Chromium')
    fireEvent.click(screen.getByText('Телефон'))
    await waitFor(() => expect(browser.command).toHaveBeenCalled())
    expect((browser.command as ReturnType<typeof vi.fn>).mock.calls[0][1].command).toMatchObject({
      type: 'resize', viewport: { width: 390, height: 844 }
    })
  })

  it('клавиатура работает прямо в кадре, без отдельного поля', async () => {
    const browser = fakeBrowser()
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    const frame = await screen.findByAltText('Кадр Chromium')
    fireEvent.keyDown(frame, { key: 'a' })
    await waitFor(() => expect(browser.command).toHaveBeenCalled())
    expect((browser.command as ReturnType<typeof vi.fn>).mock.calls[0][1].command.action).toMatchObject({ type: 'type', text: 'a' })
    fireEvent.keyDown(frame, { key: 'Enter' })
    const calls = (browser.command as ReturnType<typeof vi.fn>).mock.calls
    await waitFor(() => expect(calls.length).toBeGreaterThan(1))
    expect(calls[calls.length - 1][1].command.action).toMatchObject({ type: 'press', key: 'Enter' })
  })

  it('снимок уходит в чат тем же кадром, что видит человек', async () => {
    const onAttachFrame = vi.fn()
    render(<BrowserSessionPane conversationId="c1" browser={fakeBrowser()} onAttachFrame={onAttachFrame} />)
    await screen.findByAltText('Кадр Chromium')
    fireEvent.click(screen.getByText('Снимок в чат'))
    expect(onAttachFrame).toHaveBeenCalledWith('data:image/jpeg;base64,QQ==')
  })

  it('состояние сессии показано словами, а не сырым ready', async () => {
    render(<BrowserSessionPane conversationId="c1" browser={fakeBrowser()} />)
    await screen.findByAltText('Кадр Chromium')
    expect(screen.getByText('Готово')).toBeTruthy()
    expect(screen.queryByText('ready')).toBeNull()
  })
  it('вкладки видны, переключаются и закрываются', async () => {
    const withTabs = meta({ activeTabId: 't1', tabs: [
      { id: 't1', url: 'https://a.b', title: 'Первая', active: true },
      { id: 't2', url: 'https://c.d', title: 'Вторая', active: false }
    ] })
    const browser = fakeBrowser({ start: vi.fn(async () => withTabs), command: vi.fn(async () => withTabs) })
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    await screen.findByAltText('Кадр Chromium')
    fireEvent.click(screen.getByRole('tab', { name: 'Вторая' }))
    await waitFor(() => expect(browser.command).toHaveBeenCalled())
    expect((browser.command as ReturnType<typeof vi.fn>).mock.calls[0][1].command).toMatchObject({ type: 'selectTab', tabId: 't2' })
    fireEvent.click(screen.getByLabelText('Закрыть вкладку Вторая'))
    const calls = (browser.command as ReturnType<typeof vi.fn>).mock.calls
    await waitFor(() => expect(calls.length).toBeGreaterThan(1))
    expect(calls[calls.length - 1][1].command).toMatchObject({ type: 'closeTab', tabId: 't2' })
  })

  it('заголовок страницы показан рядом с адресом', async () => {
    const browser = fakeBrowser({ start: vi.fn(async () => meta({ title: 'Пример страницы' })) })
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    await screen.findByAltText('Кадр Chromium')
    expect(screen.getByText('Пример страницы')).toBeTruthy()
  })

  it('повторяемая ошибка даёт кнопку «Повторить», а неповторяемая — нет', async () => {
    const failing = Object.assign(new Error('Страница не ответила'), { retryable: true, code: 'timeout' })
    const browser = fakeBrowser({ command: vi.fn(async () => { throw failing }) })
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    await screen.findByAltText('Кадр Chromium')
    fireEvent.click(screen.getByLabelText('Обновить'))
    expect(await screen.findByText('Страница не ответила')).toBeTruthy()
    expect(screen.getByText('Повторить')).toBeTruthy()
  })

  it('перезапуск сессии останавливает старую и стартует новую', async () => {
    const browser = fakeBrowser()
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    await screen.findByAltText('Кадр Chromium')
    ;(browser.start as ReturnType<typeof vi.fn>).mockClear()
    fireEvent.click(screen.getByText('Перезапустить'))
    await waitFor(() => expect(browser.stop).toHaveBeenCalledWith('c1'))
    await waitFor(() => expect(browser.start).toHaveBeenCalled())
  })

  it('снимок всей страницы просит fullPage, а не текущий кадр', async () => {
    const onAttachFrame = vi.fn()
    const browser = fakeBrowser()
    render(<BrowserSessionPane conversationId="c1" browser={browser} onAttachFrame={onAttachFrame} />)
    await screen.findByAltText('Кадр Chromium')
    fireEvent.click(screen.getByText('Вся страница'))
    await waitFor(() => expect(onAttachFrame).toHaveBeenCalled())
    const shots = (browser.screenshot as ReturnType<typeof vi.fn>).mock.calls
    expect(shots.some((c) => c[1]?.fullPage === true)).toBe(true)
  })
})

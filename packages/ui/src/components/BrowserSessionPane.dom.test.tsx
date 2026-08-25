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
})

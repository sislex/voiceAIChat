// Круг 1: панель должна работать и на компьютере, и на телефоне. Кадр — это
// картинка, поэтому масштаб, свайп и сочетания браузера у неё свои; проверяем
// их поведением, а не разметкой.

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
    command: vi.fn(async () => meta()),
    screenshot: vi.fn(async () => ({ dataUrl: 'data:image/jpeg;base64,QQ==' })),
    stop: vi.fn(async () => {}),
    ...over
  }
}

async function readyPane(browser = fakeBrowser()): Promise<{ browser: RendererBrowserBridge; frame: HTMLElement }> {
  render(<BrowserSessionPane conversationId="c1" browser={browser} />)
  const frame = await screen.findByAltText('Кадр Chromium')
  return { browser, frame }
}

afterEach(cleanup)

describe('масштаб и разворот кадра', () => {
  it('увеличение задаёт кадру ширину в пикселях вьюпорта, «вписан» возвращает раскладку CSS', async () => {
    const { frame } = await readyPane()
    fireEvent.click(screen.getByLabelText('Увеличить кадр'))
    await waitFor(() => expect(frame.style.width).toMatch(/px$/))
    fireEvent.click(screen.getByRole('button', { name: /%$/ }))
    await waitFor(() => expect(frame.style.width).toBe('100%'))
  })

  it('разворот помечает панель и снимается Escape — иначе на телефоне из него не выйти', async () => {
    await readyPane()
    const pane = screen.getByLabelText('Browser session')
    fireEvent.click(screen.getByLabelText('Развернуть кадр'))
    await waitFor(() => expect(pane.className).toContain('playwright-browser-pane--fullscreen'))
    fireEvent.keyDown(pane, { key: 'Escape' })
    await waitFor(() => expect(pane.className).not.toContain('playwright-browser-pane--fullscreen'))
  })
})

describe('жесты и клавиши как в настоящем браузере', () => {
  it('свайп по кадру прокручивает страницу и гасит следующий за ним клик', async () => {
    const { browser, frame } = await readyPane()
    fireEvent.touchStart(frame, { touches: [{ clientX: 100, clientY: 400 }] })
    fireEvent.touchMove(frame, { touches: [{ clientX: 100, clientY: 300 }] })
    await waitFor(() => expect(browser.command).toHaveBeenCalledWith('c1', expect.objectContaining({
      command: expect.objectContaining({ type: 'input', action: expect.objectContaining({ type: 'wheel' }) })
    })))
    ;(browser.command as ReturnType<typeof vi.fn>).mockClear()
    fireEvent.click(frame, { clientX: 100, clientY: 300 })
    expect(browser.command).not.toHaveBeenCalledWith('c1', expect.objectContaining({
      command: expect.objectContaining({ action: expect.objectContaining({ type: 'click' }) })
    }))
  })

  it('короткое касание остаётся кликом: палец никогда не стоит идеально ровно', async () => {
    const { browser, frame } = await readyPane()
    fireEvent.touchStart(frame, { touches: [{ clientX: 100, clientY: 400 }] })
    fireEvent.touchMove(frame, { touches: [{ clientX: 102, clientY: 401 }] })
    fireEvent.click(frame, { clientX: 102, clientY: 401 })
    await waitFor(() => expect(browser.command).toHaveBeenCalledWith('c1', expect.objectContaining({
      command: expect.objectContaining({ action: expect.objectContaining({ type: 'click' }) })
    })))
  })

  it('Alt+стрелка и Ctrl+R ходят по истории и перезагружают страницу', async () => {
    const { browser } = await readyPane()
    const pane = screen.getByLabelText('Browser session')
    fireEvent.keyDown(pane, { key: 'ArrowLeft', altKey: true })
    await waitFor(() => expect(browser.command).toHaveBeenCalledWith('c1', expect.objectContaining({ command: { type: 'back' } })))
    fireEvent.keyDown(pane, { key: 'r', ctrlKey: true })
    await waitFor(() => expect(browser.command).toHaveBeenCalledWith('c1', expect.objectContaining({ command: { type: 'reload' } })))
  })

  it('Ctrl+L ставит фокус в адрес, а не отправляет клавишу странице', async () => {
    await readyPane()
    fireEvent.keyDown(screen.getByLabelText('Browser session'), { key: 'l', ctrlKey: true })
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Адрес страницы')))
  })

  it('стрелки и Backspace доступны кнопками: экранная клавиатура их не даёт', async () => {
    const { browser } = await readyPane()
    fireEvent.click(screen.getByLabelText('ArrowDown'))
    await waitFor(() => expect(browser.command).toHaveBeenCalledWith('c1', expect.objectContaining({
      command: { type: 'input', action: { type: 'press', key: 'ArrowDown' } }
    })))
    fireEvent.click(screen.getByLabelText('Backspace'))
    await waitFor(() => expect(browser.command).toHaveBeenCalledWith('c1', expect.objectContaining({
      command: { type: 'input', action: { type: 'press', key: 'Backspace' } }
    })))
  })
})

describe('адрес под рукой', () => {
  it('копирование кладёт адрес открытой страницы в буфер и подтверждает словами', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await readyPane()
    fireEvent.click(screen.getByLabelText('Скопировать адрес'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://a.b'))
    await screen.findByText('Адрес скопирован')
  })

  it('без буфера обмена кнопка объясняет отказ, а не молчит', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    await readyPane()
    fireEvent.click(screen.getByLabelText('Скопировать адрес'))
    await screen.findByText(/Буфер обмена недоступен/)
  })
})

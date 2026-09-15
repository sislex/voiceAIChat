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

describe('формы и жесты телефона (круг 2)', () => {
  it('долгое нажатие открывает контекстное меню страницы правым кликом', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const browser = fakeBrowser()
      render(<BrowserSessionPane conversationId="c1" browser={browser} />)
      const frame = await screen.findByAltText('Кадр Chromium')
      fireEvent.touchStart(frame, { touches: [{ clientX: 50, clientY: 60 }] })
      await vi.advanceTimersByTimeAsync(700)
      await waitFor(() => expect(browser.command).toHaveBeenCalledWith('c1', expect.objectContaining({
        command: expect.objectContaining({ action: expect.objectContaining({ type: 'click', button: 'right' }) })
      })))
    } finally { vi.useRealTimers() }
  })

  it('два быстрых тапа дают двойной клик, а два щелчка мыши — нет', async () => {
    const { browser, frame } = await readyPane()
    fireEvent.touchStart(frame, { touches: [{ clientX: 10, clientY: 10 }] })
    fireEvent.click(frame, { clientX: 10, clientY: 10 })
    fireEvent.touchStart(frame, { touches: [{ clientX: 10, clientY: 10 }] })
    fireEvent.click(frame, { clientX: 10, clientY: 10 })
    await waitFor(() => expect(browser.command).toHaveBeenCalledWith('c1', expect.objectContaining({
      command: expect.objectContaining({ action: expect.objectContaining({ type: 'click', clickCount: 2 }) })
    })))
    ;(browser.command as ReturnType<typeof vi.fn>).mockClear()
    fireEvent.click(frame, { clientX: 20, clientY: 20 })
    fireEvent.click(frame, { clientX: 20, clientY: 20 })
    const calls = (browser.command as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, req]) => (req as { command: { action?: { clickCount?: number } } }).command.action?.clickCount === 2)
    expect(calls).toHaveLength(0)
  })

  it('панель полей формы показывает значения и причину, по которой браузер не пустит дальше', async () => {
    const browser = fakeBrowser({
      command: vi.fn(async (_id: string, req: { command: { type: string; action?: { kind?: string } } }) => {
        if (req.command.action?.kind === 'formState') {
          return { ok: true, form: { selector: 'form', total: 1, fields: [{ selector: '#email', tag: 'input', type: 'email', label: 'Почта', value: 'нет-собаки', invalid: 'Введите адрес' }] } }
        }
        if (req.command.action?.kind === 'validity') return { ok: true, validity: { valid: false, checked: 1, blocking: [{ selector: '#email', message: 'Введите адрес', reasons: ['typeMismatch'] }] } }
        return meta()
      }) as unknown as RendererBrowserBridge['command']
    })
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    await screen.findByAltText('Кадр Chromium')
    fireEvent.click(screen.getByRole('button', { name: 'Поля формы' }))
    await screen.findByText(/не проходят проверку: 1/)
    await screen.findByText('Почта')
    await screen.findByText(/Введите адрес/)
  })

  it('поле ввода очищается кнопкой: на телефоне стирать по символу — отдельное упражнение', async () => {
    await readyPane()
    const input = screen.getByLabelText('Ввод текста в страницу') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'привет' } })
    fireEvent.click(screen.getByLabelText('Очистить поле ввода'))
    await waitFor(() => expect(input.value).toBe(''))
  })

  it('масштаб переживает переоткрытие панели', async () => {
    const { frame } = await readyPane()
    fireEvent.click(screen.getByLabelText('Увеличить кадр'))
    await waitFor(() => expect(frame.style.width).toMatch(/px$/))
    cleanup()
    render(<BrowserSessionPane conversationId="c2" browser={fakeBrowser()} />)
    const again = await screen.findByAltText('Кадр Chromium')
    expect(again.style.width).toMatch(/px$/)
  })
})

describe('поиск по странице и положение на ней (круг 3)', () => {
  const searching = () => fakeBrowser({
    command: vi.fn(async (_id: string, req: { command: { type: string; action?: { kind?: string } } }) => {
      if (req.command.action?.kind === 'find') {
        return { ok: true, matches: [{ selector: '#a', text: 'Итого 100', visible: true }, { selector: '#b', text: 'Итого 200', visible: true }] }
      }
      if (req.command.action?.kind === 'metrics') {
        return { ok: true, metrics: { scroll: { top: 0, left: 0 }, page: { width: 1280, height: 4000 }, viewport: { width: 1280, height: 800 }, screensBelow: 4, atBottom: false } }
      }
      return meta()
    }) as unknown as RendererBrowserBridge['command']
  })

  it('Ctrl+F открывает поиск панели, а не браузера, и находит текст в странице Chromium', async () => {
    const browser = searching()
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    await screen.findByAltText('Кадр Chromium')
    fireEvent.keyDown(screen.getByLabelText('Browser session'), { key: 'f', ctrlKey: true })
    const input = await screen.findByLabelText('Найти на странице')
    fireEvent.change(input, { target: { value: 'Итого' } })
    fireEvent.click(screen.getByRole('button', { name: /^Найти$/ }))
    await screen.findByText('1 из 2')
    // Совпадение показывается человеку: прокрутка к нему и рамка вокруг.
    await waitFor(() => expect(browser.command).toHaveBeenCalledWith('c1', expect.objectContaining({
      command: expect.objectContaining({ action: expect.objectContaining({ kind: 'highlight', selector: '#a' }) })
    })))
  })

  it('переход по совпадениям идёт по кругу', async () => {
    const browser = searching()
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    await screen.findByAltText('Кадр Chromium')
    fireEvent.keyDown(screen.getByLabelText('Browser session'), { key: 'f', ctrlKey: true })
    fireEvent.change(await screen.findByLabelText('Найти на странице'), { target: { value: 'Итого' } })
    fireEvent.click(screen.getByRole('button', { name: /^Найти$/ }))
    await screen.findByText('1 из 2')
    fireEvent.click(screen.getByLabelText('Следующее совпадение'))
    await screen.findByText('2 из 2')
    fireEvent.click(screen.getByLabelText('Следующее совпадение'))
    await screen.findByText('1 из 2')
  })

  it('Escape закрывает сначала поиск, а разворот оставляет', async () => {
    await readyPane()
    const pane = screen.getByLabelText('Browser session')
    fireEvent.click(screen.getByLabelText('Развернуть кадр'))
    fireEvent.keyDown(pane, { key: 'f', ctrlKey: true })
    await screen.findByLabelText('Найти на странице')
    fireEvent.keyDown(pane, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByLabelText('Найти на странице')).toBeNull())
    expect(pane.className).toContain('playwright-browser-pane--fullscreen')
  })

  it('кнопки концов страницы прокручивают и показывают, сколько осталось ниже', async () => {
    const browser = searching()
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    await screen.findByAltText('Кадр Chromium')
    fireEvent.click(screen.getByLabelText('В конец страницы'))
    await waitFor(() => expect(browser.command).toHaveBeenCalledWith('c1', expect.objectContaining({
      command: expect.objectContaining({ action: expect.objectContaining({ kind: 'scroll', to: 'bottom' }) })
    })))
    await screen.findByText(/ниже ещё 4/)
  })
})

describe('среда браузера в панели (круг 4)', () => {
  const withEnvironment = () => fakeBrowser({
    command: vi.fn(async (_id: string, req: { command: { type: string; action?: string } }) => {
      if (req.command.type === 'environment') return { environment: { colorScheme: 'dark', reducedMotion: 'no-preference', forcedColors: 'none', offline: false, geolocation: null, permissions: [] } }
      if (req.command.type === 'cookies') return { cookies: [{ name: 'session', value: 'abcd…(64 симв.)', domain: 'a.b', path: '/' }], total: 1 }
      return meta()
    }) as unknown as RendererBrowserBridge['command']
  })

  it('тёмная тема включается и подписывается в панели инструментов', async () => {
    const browser = withEnvironment()
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    await screen.findByAltText('Кадр Chromium')
    fireEvent.click(screen.getByRole('button', { name: 'Среда' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Тёмная тема' }))
    await waitFor(() => expect(browser.command).toHaveBeenCalledWith('c1', expect.objectContaining({
      command: expect.objectContaining({ type: 'environment', colorScheme: 'dark' })
    })))
    // Эмуляция незаметна на кадре: без подписи тёмная тема выглядит как решение сайта.
    await screen.findByText('тёмная тема')
  })

  it('cookies показываются сокращёнными значениями', async () => {
    const browser = withEnvironment()
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    await screen.findByAltText('Кадр Chromium')
    fireEvent.click(screen.getByRole('button', { name: 'Среда' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cookies' }))
    await screen.findByText(/Cookies сессии: 1/)
    await screen.findByText(/abcd…\(64 симв\.\)/)
  })

  it('сброс возвращает всё разом, а не по одной настройке', async () => {
    const browser = withEnvironment()
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    await screen.findByAltText('Кадр Chromium')
    fireEvent.click(screen.getByRole('button', { name: 'Среда' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Сбросить' }))
    await waitFor(() => expect(browser.command).toHaveBeenCalledWith('c1', expect.objectContaining({
      command: expect.objectContaining({ type: 'environment', colorScheme: 'light', offline: false, geolocation: null })
    })))
  })
})

describe('лента событий сессии (круг 5)', () => {
  const withHistory = () => fakeBrowser({
    start: vi.fn(async () => meta({
      history: [
        { at: 1_700_000_000_000, actor: 'assistant', title: 'проверяю форму входа', kind: 'note', ok: true, note: 'проверяю форму входа' },
        { at: 1_700_000_001_000, actor: 'assistant', title: 'клик: #login', kind: 'click', selector: '#login', ok: true },
        { at: 1_700_000_002_000, actor: 'user', title: 'переход на https://a.b/', kind: 'navigate', ok: false, error: 'таймаут' }
      ]
    })) as unknown as RendererBrowserBridge['start']
  })

  it('показывает действия обеих сторон, заметку модели и причину отказа', async () => {
    render(<BrowserSessionPane conversationId="c1" browser={withHistory()} />)
    await screen.findByAltText('Кадр Chromium')
    fireEvent.click(screen.getByRole('button', { name: /Что происходит/ }))
    await screen.findByText(/проверяю форму входа/)
    await screen.findByText(/клик: #login/)
    await screen.findByText(/таймаут/)
  })

  it('фильтр оставляет только свои действия', async () => {
    render(<BrowserSessionPane conversationId="c1" browser={withHistory()} />)
    await screen.findByAltText('Кадр Chromium')
    fireEvent.click(screen.getByRole('button', { name: /Что происходит/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Я' }))
    await waitFor(() => expect(screen.queryByText(/клик: #login/)).toBeNull())
    expect(screen.getByText(/переход на/)).toBeTruthy()
  })

  it('элемент записи показывается на странице по кнопке', async () => {
    const browser = withHistory()
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    await screen.findByAltText('Кадр Chromium')
    fireEvent.click(screen.getByRole('button', { name: /Что происходит/ }))
    fireEvent.click(await screen.findByLabelText('Показать #login'))
    await waitFor(() => expect(browser.command).toHaveBeenCalledWith('c1', expect.objectContaining({
      command: expect.objectContaining({ action: expect.objectContaining({ kind: 'highlight', selector: '#login' }) })
    })))
  })

  it('очистка ленты уходит командой, а не прячет её в интерфейсе', async () => {
    const browser = withHistory()
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    await screen.findByAltText('Кадр Chromium')
    fireEvent.click(screen.getByRole('button', { name: /Что происходит/ }))
    fireEvent.click(await screen.findByLabelText('Очистить ленту'))
    await waitFor(() => expect(browser.command).toHaveBeenCalledWith('c1', expect.objectContaining({
      command: expect.objectContaining({ type: 'history', clear: true })
    })))
  })
})

describe('данные сайта в панели (круг 6)', () => {
  it('хранилище показывается по областям и ключ удаляется на месте', async () => {
    const browser = fakeBrowser({
      command: vi.fn(async (_id: string, req: { command: { type: string; action?: { kind?: string; do?: string } } }) => {
        if (req.command.action?.kind === 'storage') {
          return { ok: true, storage: { origin: 'https://a.b', local: [{ key: 'theme', value: 'dark', bytes: 4 }], localTotal: 1, session: [], sessionTotal: 0 } }
        }
        return meta()
      }) as unknown as RendererBrowserBridge['command']
    })
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    await screen.findByAltText('Кадр Chromium')
    fireEvent.click(screen.getByRole('button', { name: 'Среда' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Хранилище сайта' }))
    await screen.findByText(/постоянное 1/)
    await screen.findByText('theme')
    fireEvent.click(screen.getByLabelText('Удалить theme'))
    await waitFor(() => expect(browser.command).toHaveBeenCalledWith('c1', expect.objectContaining({
      command: expect.objectContaining({ action: expect.objectContaining({ kind: 'storage', do: 'remove', key: 'theme' }) })
    })))
  })
})

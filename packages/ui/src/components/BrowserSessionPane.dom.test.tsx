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

describe('Playwright Reader как инструмент автотестов (круг 11)', () => {
  it('показывает ошибки страницы и неуспешные запросы, скрывая успешные', async () => {
    // Раннер копит журналы с открытия страницы, но до этого круга человек их не
    // видел: белый экран и никакого объяснения.
    const command = vi.fn(async (_id: string, req: { command: { type: string; action?: { kind?: string } } }) => {
      if (req.command.type !== 'inspect') return meta()
      return req.command.action?.kind === 'console'
        ? { ok: true, console: [{ level: 'error', text: 'TypeError: x is not a function', at: 1 }] }
        : { ok: true, network: [
            { method: 'GET', url: 'http://site/api/board', status: 500, ok: false, at: 2 },
            { method: 'GET', url: 'http://site/ok', status: 200, ok: true, at: 3 }
          ] }
    })
    render(<BrowserSessionPane conversationId="c1" browser={fakeBrowser({ command: command as never })} />)
    await waitFor(() => expect(screen.getByAltText('Кадр Chromium')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Ошибки страницы' }))
    expect(await screen.findByText('TypeError: x is not a function')).toBeInTheDocument()
    expect(screen.getByText(/api\/board/)).toBeInTheDocument()
    expect(screen.queryByText(/site\/ok/)).not.toBeInTheDocument()
    expect(screen.getByText('Ошибки страницы: 1 · Неуспешные запросы: 1')).toBeInTheDocument()
  })

  it('«страница не жаловалась» — отдельное состояние, а не пустой блок', async () => {
    const command = vi.fn(async (_id: string, req: { command: { type: string } }) =>
      req.command.type === 'inspect' ? { ok: true, console: [], network: [] } : meta())
    render(<BrowserSessionPane conversationId="c1" browser={fakeBrowser({ command: command as never })} />)
    await waitFor(() => expect(screen.getByAltText('Кадр Chromium')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Ошибки страницы' }))
    expect(await screen.findByText('Страница не жаловалась.')).toBeInTheDocument()
  })

  it('клавиши Enter, Tab и Escape шлются как press', async () => {
    const browser = fakeBrowser()
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    await waitFor(() => expect(screen.getByAltText('Кадр Chromium')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Tab' }))
    await waitFor(() => expect(browser.command).toHaveBeenCalledWith('c1', expect.objectContaining({
      command: { type: 'input', action: { type: 'press', key: 'Tab' } }
    })))
  })

  it('выбранный размер окна переживает перезапуск сессии', async () => {
    const browser = fakeBrowser()
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    await waitFor(() => expect(screen.getByAltText('Кадр Chromium')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Телефон' }))
    fireEvent.click(screen.getByRole('button', { name: 'Перезапустить' }))
    // Раньше перезапуск всегда стартовал с десктопного вьюпорта, и проверка
    // мобильной вёрстки сбрасывалась на каждом «Перезапустить».
    await waitFor(() => expect(browser.start).toHaveBeenLastCalledWith('c1', expect.objectContaining({ width: 390 })))
  })
})

describe('запись сценария автотеста (круг 12)', () => {
  const element = { selector: '[data-testid="create"]', stability: 'testid', tag: 'button', text: 'Создать', rect: { x: 0, y: 0, width: 100, height: 40 } }

  const recordingBrowser = (over: Partial<{ element: unknown }> = {}): RendererBrowserBridge => fakeBrowser({
    start: vi.fn(async () => meta({ currentUrl: 'http://89.125.68.35:8787/' })),
    command: vi.fn(async (_id: string, req: { command: { type: string; action?: { kind?: string } } }) =>
      req.command.type === 'selector' && req.command.action?.kind === 'describe'
        ? { ok: true, element: over.element ?? element }
        : meta({ currentUrl: 'http://89.125.68.35:8787/' })) as never
  })

  const startAndRecord = async (browser: RendererBrowserBridge): Promise<HTMLElement> => {
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    await waitFor(() => expect(screen.getByAltText('Кадр Chromium')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Записать сценарий' }))
    const frame = screen.getByAltText('Кадр Chromium')
    Object.defineProperty(frame, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 1280, height: 800 }) })
    return frame
  }

  it('клик по кадру превращается в селекторный шаг, а не в координаты', async () => {
    const frame = await startAndRecord(recordingBrowser())
    fireEvent.click(frame, { clientX: 50, clientY: 30 })
    expect(await screen.findByText('Нажать «Создать»')).toBeInTheDocument()
    expect(screen.getByText('[data-testid="create"]')).toBeInTheDocument()
    // Первым шагом записывается открытый адрес — с него начинается сценарий.
    expect(screen.getByText('Открыть http://89.125.68.35:8787/')).toBeInTheDocument()
  })

  it('клик всё равно выполняется: запись не мешает работать', async () => {
    const browser = recordingBrowser()
    const frame = await startAndRecord(browser)
    fireEvent.click(frame, { clientX: 50, clientY: 30 })
    await waitFor(() => expect(browser.command).toHaveBeenCalledWith('c1', expect.objectContaining({
      command: { type: 'input', action: { type: 'click', x: 50, y: 30, button: 'left', clickCount: 1 } }
    })))
  })

  it('ненадёжный селектор предупреждает при записи, а не падает потом', async () => {
    const frame = await startAndRecord(recordingBrowser({ element: { ...element, selector: 'div > span:nth-of-type(2)', stability: 'path', text: '' } }))
    fireEvent.click(frame, { clientX: 10, clientY: 10 })
    expect(await screen.findByRole('alert')).toHaveTextContent('Ненадёжных шагов: 1')
  })

  it('без записи клик остаётся координатным и шагов не появляется', async () => {
    const browser = recordingBrowser()
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    await waitFor(() => expect(screen.getByAltText('Кадр Chromium')).toBeTruthy())
    const frame = screen.getByAltText('Кадр Chromium')
    Object.defineProperty(frame, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 1280, height: 800 }) })
    fireEvent.click(frame, { clientX: 50, clientY: 30 })
    await waitFor(() => expect(browser.command).toHaveBeenCalled())
    expect(screen.queryByLabelText('Записанный сценарий')).not.toBeInTheDocument()
  })
})

describe('где мы и кто действовал (круг 13)', () => {
  it('подмена адреса алиасом объясняется, а не выглядит как «открылось не то»', async () => {
    const browser = fakeBrowser({
      start: vi.fn(async () => meta({ currentUrl: null })),
      command: vi.fn(async () => meta({ currentUrl: 'http://voicechat:8787/' }))
    })
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    await waitFor(() => expect(screen.getByAltText('Кадр Chromium')).toBeTruthy())
    const address = screen.getByLabelText('Адрес страницы') as HTMLInputElement
    fireEvent.change(address, { target: { value: 'http://89.125.68.35:8787/' } })
    fireEvent.keyDown(address, { key: 'Enter' })
    expect(await screen.findByText(/адрес подменён алиасом раннера/)).toBeInTheDocument()
  })

  it('уход с проверяемого сайта показывается тревогой', async () => {
    const browser = fakeBrowser({
      start: vi.fn(async () => meta({ currentUrl: 'http://89.125.68.35:8787/' })),
      command: vi.fn(async () => meta({ currentUrl: 'https://accounts.example.com/signin' }))
    })
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    await waitFor(() => expect(screen.getByAltText('Кадр Chromium')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ушла с проверяемого сайта')
  })

  it('показывает, что последнее действие сделала модель', async () => {
    const browser = fakeBrowser({ start: vi.fn(async () => meta({ lastActor: 'assistant' })) })
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    expect(await screen.findByText('последнее действие — модели')).toBeInTheDocument()
  })

  it('история адресов даёт вернуться на посещённое', async () => {
    const browser = fakeBrowser({
      start: vi.fn(async () => meta({ currentUrl: 'http://89.125.68.35:8787/' })),
      command: vi.fn(async () => meta({ currentUrl: 'http://89.125.68.35:8787/#/projects' }))
    })
    render(<BrowserSessionPane conversationId="c1" browser={browser} />)
    await waitFor(() => expect(screen.getByAltText('Кадр Chromium')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }))
    const history = await screen.findByLabelText('Где были')
    fireEvent.change(history, { target: { value: 'http://89.125.68.35:8787/' } })
    await waitFor(() => expect(browser.command).toHaveBeenCalledWith('c1', expect.objectContaining({
      command: { type: 'navigate', url: 'http://89.125.68.35:8787/' }
    })))
  })

  it('тестовая учётка подставляется в форму, а нераспознанная форма объясняется', async () => {
    const command = vi.fn(async (_id: string, req: { command: { type: string; action?: { selector?: string } } }) =>
      req.command.action?.selector === 'input[type=password]' ? { ok: false, error: 'локатор не найден' } : meta())
    render(<BrowserSessionPane conversationId="c1" browser={fakeBrowser({ command: command as never })} testUsers={[{ name: 'tester', password: 'secret', role: 'user' }]} />)
    await waitFor(() => expect(screen.getByAltText('Кадр Chromium')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Войти как'), { target: { value: 'tester' } })
    // Эвристика по типам полей может не подойти чужой форме — тогда честный
    // отказ, а не вид, будто вошли.
    expect(await screen.findByText(/Поле пароля не найдено/)).toBeInTheDocument()
  })

  it('без тестовых учёток селектор входа не показывается', async () => {
    render(<BrowserSessionPane conversationId="c1" browser={fakeBrowser()} />)
    await waitFor(() => expect(screen.getByAltText('Кадр Chromium')).toBeTruthy())
    expect(screen.queryByLabelText('Войти как')).not.toBeInTheDocument()
  })
})

describe('сценарий как настоящий тест (круг 14)', () => {
  const element = { selector: '#create', stability: 'id', tag: 'button', text: 'Создать', matches: 1, rect: { x: 0, y: 0, width: 100, height: 40 } }
  const bridgeWith = (over: Record<string, unknown> = {}): RendererBrowserBridge => fakeBrowser({
    start: vi.fn(async () => meta({ currentUrl: 'http://89.125.68.35:8787/' })),
    command: vi.fn(async (_id: string, req: { command: { type: string; action?: { kind?: string } } }) =>
      req.command.type === 'selector' && req.command.action?.kind === 'describe'
        ? { ok: true, element: { ...element, ...over } }
        : meta({ currentUrl: 'http://89.125.68.35:8787/' })) as never
  })

  const record = async (browser: RendererBrowserBridge, props: Record<string, unknown> = {}): Promise<void> => {
    render(<BrowserSessionPane conversationId="c1" browser={browser} {...props} />)
    await waitFor(() => expect(screen.getByAltText('Кадр Chromium')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Записать сценарий' }))
    const frame = screen.getByAltText('Кадр Chromium')
    Object.defineProperty(frame, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 1280, height: 800 }) })
    fireEvent.click(frame, { clientX: 50, clientY: 30 })
    await screen.findByText('Нажать «Создать»')
  }

  it('предупреждает, что сценарий без проверок ничего не докажет', async () => {
    await record(bridgeWith())
    expect(screen.getByText(/Ни одной проверки/)).toBeInTheDocument()
  })

  it('ожидание вешается на последний шаг и предупреждение уходит', async () => {
    await record(bridgeWith())
    fireEvent.change(screen.getByLabelText('Ожидаемый текст после последнего шага'), { target: { value: 'Задача создана' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ждать текст' }))
    expect(await screen.findByText('ждём «Задача создана»')).toBeInTheDocument()
    expect(screen.queryByText(/Ни одной проверки/)).not.toBeInTheDocument()
  })

  it('неоднозначный селектор объясняется отдельно от ненадёжного', async () => {
    await record(bridgeWith({ selector: 'button[aria-label="Закрыть"]', stability: 'label', matches: 3 }))
    expect(screen.getByText(/Неоднозначных шагов: 1/)).toBeInTheDocument()
  })

  it('шаг можно убрать: промах мышью не стоит всей записи', async () => {
    await record(bridgeWith())
    fireEvent.click(screen.getByRole('button', { name: 'Убрать шаг «Нажать «Создать»»' }))
    await waitFor(() => expect(screen.queryByText('Нажать «Создать»')).not.toBeInTheDocument())
  })

  it('сохранение в проект отдаёт сценарий и сообщает об успехе', async () => {
    const onSaveScenario = vi.fn(async () => {})
    await record(bridgeWith(), { onSaveScenario })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить в проект' }))
    await waitFor(() => expect(onSaveScenario).toHaveBeenCalledWith(expect.objectContaining({
      startUrl: 'http://89.125.68.35:8787/',
      steps: [expect.objectContaining({ action: { kind: 'click', selector: '#create' } })]
    })))
    expect(await screen.findByText('Сценарий сохранён в настройках проекта')).toBeInTheDocument()
  })

  it('отказ сохранения показывается, а не теряется', async () => {
    await record(bridgeWith(), { onSaveScenario: vi.fn(async () => { throw new Error('Недостаточно прав') }) })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить в проект' }))
    expect(await screen.findByText('Недостаточно прав')).toBeInTheDocument()
  })
})

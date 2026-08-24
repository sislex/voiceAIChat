import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PREVIEW_INSPECTOR_MESSAGE_TYPE } from '@shared/previewInspector'
import { PREVIEW_ACTION_COMMAND_TYPE, PREVIEW_ACTION_RESULT_TYPE } from '@shared/previewActions'
import { PreviewPane, WebReaderHost, type PreviewActionRunner } from './App'
import { WEB_RECORDER_MESSAGE_TYPE } from '@shared/webRecorder'

const payload = {
  tag: 'div', id: 'hero', classes: [], dataAttributes: {}, selector: '#hero', ancestors: ['html','body','div#hero'],
  rect: { x: 0, y: 0, top: 0, right: 320, bottom: 120, left: 0, width: 320, height: 120 },
  pageUrl: 'https://example.test', viewport: { width: 800, height: 600 }, outerHTML: '<div id="hero"></div>', text: '',
  styles: { font:'',color:'',backgroundColor:'',margin:'',padding:'',border:'',width:'',height:'',position:'',display:'',flex:'',flexDirection:'',flexWrap:'',alignItems:'',justifyContent:'',gap:'',grid:'',gridTemplateColumns:'',gridTemplateRows:'',gridArea:'' }
}

describe('WebPreview session', () => {
  it('называет виджет «Web Reader»', () => {
    render(<PreviewPane conversationUrl={null} projectUrl={null} onSave={vi.fn()} />)
    expect(screen.getByRole('region', { name: 'Web Reader' })).toBeInTheDocument()
  })

  const withSessionBridge = (ensurePreview: () => Promise<boolean>): void => {
    ;(window as { session?: unknown }).session = {
      login: vi.fn(), me: vi.fn(), logout: vi.fn(), ensurePreview
    }
  }

  afterEach(() => { delete (window as { session?: unknown }).session })

  it('ждёт выпуска preview-cookie session-мостом и лишь потом грузит iframe', async () => {
    let release: (ok: boolean) => void = () => undefined
    const ensurePreview = vi.fn(() => new Promise<boolean>((resolve) => { release = resolve }))
    withSessionBridge(ensurePreview)
    render(<PreviewPane conversationUrl="https://www.onliner.by/" projectUrl={null} onSave={vi.fn()} />)
    expect(screen.queryByTitle('Предпросмотр сайта')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Подключение превью…')
    release(true)
    await waitFor(() => expect(screen.getByTitle('Предпросмотр сайта')).toBeInTheDocument())
    expect(ensurePreview).toHaveBeenCalled()
    const src = (screen.getByTitle('Предпросмотр сайта') as HTMLIFrameElement).getAttribute('src')
    expect(src).toBe('/api/preview?url=https%3A%2F%2Fwww.onliner.by%2F')
  })

  it('при отказе session-моста iframe не грузится, виден понятный статус', async () => {
    withSessionBridge(async () => false)
    render(<PreviewPane conversationUrl="https://www.onliner.by/" projectUrl={null} onSave={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('войдите в приложение заново'))
    expect(screen.queryByTitle('Предпросмотр сайта')).toBeNull()
  })

  it('«Обновить» после отказа повторяет выпуск preview-cookie', async () => {
    const answers = [false, true]
    const ensurePreview = vi.fn(async () => answers.shift() ?? true)
    withSessionBridge(ensurePreview)
    render(<PreviewPane conversationUrl="https://www.onliner.by/" projectUrl={null} onSave={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Обновить' }))
    await waitFor(() => expect(screen.getByTitle('Предпросмотр сайта')).toBeInTheDocument())
    expect(ensurePreview).toHaveBeenCalledTimes(2)
  })
})

describe('WebPreview inspector', () => {
  it('открывает same-origin proxy без Bearer-токена в URL', () => {
    localStorage.setItem('vc.session.token', 'main-bearer-secret')
    render(<PreviewPane conversationUrl="https://tehniks.by/" projectUrl={null} onSave={vi.fn()} />)
    const src = (screen.getByTitle('Предпросмотр сайта') as HTMLIFrameElement).getAttribute('src')
    expect(src).toBe('/api/preview?url=https%3A%2F%2Ftehniks.by%2F')
    expect(src).not.toContain('main-bearer-secret')
    localStorage.removeItem('vc.session.token')
  })

  it('управляет режимом кнопкой и Alt+I, Esc выключает', async () => {
    render(<PreviewPane conversationUrl="https://example.test" projectUrl={null} onSave={vi.fn()} />)
    const toggle = screen.getByRole('button', { name: /Выбор элемента/ })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.keyDown(window, { key: 'i', altKey: true })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('принимает только валидное сообщение от своего iframe', async () => {
    const onSelectElement = vi.fn()
    render(<PreviewPane conversationUrl="https://example.test" projectUrl={null} onSave={vi.fn()} onSelectElement={onSelectElement} />)
    const frame = screen.getByTitle('Предпросмотр сайта') as HTMLIFrameElement
    fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow, data: { type: PREVIEW_INSPECTOR_MESSAGE_TYPE, payload } }))
    await waitFor(() => expect(onSelectElement).toHaveBeenCalledWith(payload))
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.test', source: frame.contentWindow, data: { type: PREVIEW_INSPECTOR_MESSAGE_TYPE, payload: { ...payload, id: 'evil' } } }))
    window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, source: window, data: { type: PREVIEW_INSPECTOR_MESSAGE_TYPE, payload: { ...payload, id: 'other-frame' } } }))
    expect(onSelectElement).toHaveBeenCalledTimes(1)
  })

  it('DOM-действие модели уходит в iframe и резолвится ответом только от него', async () => {
    const register = vi.fn<(runner: PreviewActionRunner | null) => void>()
    render(<PreviewPane conversationUrl="https://shop.example" projectUrl={null} onSave={vi.fn()} onRegisterActionRunner={register} />)
    const runner = register.mock.calls.at(-1)?.[0]
    expect(runner).toBeTruthy()
    const frame = screen.getByTitle('Предпросмотр сайта') as HTMLIFrameElement
    const post = vi.spyOn(frame.contentWindow as Window, 'postMessage')
    const promise = runner!({ kind: 'read' })
    const command = post.mock.calls.at(-1)?.[0] as { type: string; requestId: string; action: unknown }
    expect(command).toMatchObject({ type: PREVIEW_ACTION_COMMAND_TYPE, action: { kind: 'read' } })
    const result = { page: { url: 'https://shop.example', title: 'Магазин' }, headings: [], links: [], buttons: [], inputs: [], text: '' }
    // Ответ с чужим origin игнорируется — ждём ответ собственного iframe.
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.test', source: frame.contentWindow, data: { type: PREVIEW_ACTION_RESULT_TYPE, requestId: command.requestId, ok: false, error: 'подделка' } }))
    fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow, data: { type: PREVIEW_ACTION_RESULT_TYPE, requestId: command.requestId, ok: true, result } }))
    await expect(promise).resolves.toEqual({ ok: true, result })
  })

  it('без загруженной страницы действие отвечает ошибкой, а не виснет', async () => {
    const register = vi.fn<(runner: PreviewActionRunner | null) => void>()
    render(<PreviewPane conversationUrl={null} projectUrl={null} onSave={vi.fn()} onRegisterActionRunner={register} />)
    const runner = register.mock.calls.at(-1)?.[0]
    const outcome = await runner!({ kind: 'click', text: 'Электроника' })
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toContain('нет загруженной страницы')
  })

  it('размонтирование панели закрывает ожидающие действия ошибкой', async () => {
    const register = vi.fn<(runner: PreviewActionRunner | null) => void>()
    const view = render(<PreviewPane conversationUrl="https://shop.example" projectUrl={null} onSave={vi.fn()} onRegisterActionRunner={register} />)
    const runner = register.mock.calls.at(-1)?.[0]
    const promise = runner!({ kind: 'read' })
    view.unmount()
    const outcome = await promise
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toContain('закрыта')
    expect(register.mock.calls.at(-1)?.[0]).toBeNull()
  })

  it('показывает обновление и открытие во внешней вкладке', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<PreviewPane conversationUrl="https://example.test/page" projectUrl={null} onSave={vi.fn()} />)
    const before = screen.getByTitle('Предпросмотр сайта')
    await userEvent.click(screen.getByRole('button', { name: 'Обновить' }))
    expect(screen.getByTitle('Предпросмотр сайта')).not.toBe(before)
    await userEvent.click(screen.getByRole('button', { name: 'Открыть в новой вкладке' }))
    expect(open).toHaveBeenCalledWith('https://example.test/page', '_blank', 'noopener,noreferrer')
  })

  it('записывает редактируемые шаги и не показывает чувствительное значение', async () => {
    render(<PreviewPane conversationUrl="https://shop.example" projectUrl={null} onSave={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Записать сценарий' }))
    const frame = screen.getByTitle('Предпросмотр сайта') as HTMLIFrameElement
    fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow, data: { type: 'voicechat.preview.record.v1', step: { kind: 'click', selector: '#buy', text: 'Купить' } } }))
    fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow, data: { type: 'voicechat.preview.record.v1', step: { kind: 'type', selector: '#password', text: '', sensitive: true } } }))
    expect(screen.getByLabelText('Селектор шага 1')).toHaveValue('#buy')
    expect(screen.getByLabelText('Значение шага 2')).toHaveValue('••••••')
    expect(screen.getByText('секрет не сохранён')).toBeInTheDocument()
  })
})

describe('WebReaderHost action lifecycle', () => {
  const hostMessage = (frame: HTMLIFrameElement, data: object): void => {
    fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, data: { type: WEB_RECORDER_MESSAGE_TYPE, ...data } }))
  }
  const withSessionBridge = (ensurePreview: () => Promise<boolean>): void => {
    ;(window as { session?: unknown }).session = {
      login: vi.fn(), me: vi.fn(), logout: vi.fn(), ensurePreview
    }
  }

  afterEach(() => { delete (window as { session?: unknown }).session })

  it('не передаёт целевой URL до успешного выпуска preview-cookie', async () => {
    let release: (ok: boolean) => void = () => undefined
    const ensurePreview = vi.fn(() => new Promise<boolean>((resolve) => { release = resolve }))
    withSessionBridge(ensurePreview)
    render(<WebReaderHost conversationUrl="https://shop.example" projectUrl={null} onSave={vi.fn()} />)
    const frame = screen.getByTitle('Web Reader') as HTMLIFrameElement
    const post = vi.spyOn(frame.contentWindow as Window, 'postMessage')
    hostMessage(frame, { kind: 'ready' })
    expect(screen.getByRole('status')).toHaveTextContent('Подключение Web Preview')
    expect(post.mock.calls.some(([message]) => (message as { url?: string }).url === 'https://shop.example')).toBe(false)
    release(true)
    await waitFor(() => expect(post.mock.calls.some(([message]) => (message as { url?: string }).url === 'https://shop.example')).toBe(true))
    expect(ensurePreview).toHaveBeenCalledTimes(1)
  })

  it('показывает отказ и повторно вызывает ensurePreview для projectUrl', async () => {
    const ensurePreview = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(true)
    withSessionBridge(ensurePreview)
    render(<WebReaderHost conversationUrl={null} projectUrl="https://project.example" onSave={vi.fn()} />)
    const frame = screen.getByTitle('Web Reader') as HTMLIFrameElement
    const post = vi.spyOn(frame.contentWindow as Window, 'postMessage')
    hostMessage(frame, { kind: 'ready' })
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Не удалось подготовить'))
    expect(post.mock.calls.some(([message]) => (message as { url?: string }).url === 'https://project.example')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(post.mock.calls.some(([message]) => (message as { url?: string }).url === 'https://project.example')).toBe(true))
    expect(ensurePreview).toHaveBeenCalledTimes(2)
  })

  it('после смены URL во время ожидания открывает только актуальный адрес', async () => {
    const releases: Array<(ok: boolean) => void> = []
    withSessionBridge(() => new Promise<boolean>((resolve) => { releases.push(resolve) }))
    const view = render(<WebReaderHost conversationUrl="https://old.example" projectUrl={null} onSave={vi.fn()} />)
    const frame = screen.getByTitle('Web Reader') as HTMLIFrameElement
    const post = vi.spyOn(frame.contentWindow as Window, 'postMessage')
    hostMessage(frame, { kind: 'ready' })
    view.rerender(<WebReaderHost conversationUrl="https://new.example" projectUrl={null} onSave={vi.fn()} />)
    releases[0](true)
    await Promise.resolve()
    expect(post.mock.calls.some(([message]) => (message as { url?: string }).url === 'https://old.example')).toBe(false)
    releases[1](true)
    await waitFor(() => expect(post.mock.calls.some(([message]) => (message as { url?: string }).url === 'https://new.example')).toBe(true))
  })

  it('без URL не вызывает ensurePreview и не передаёт целевую страницу', () => {
    const ensurePreview = vi.fn(async () => true)
    withSessionBridge(ensurePreview)
    render(<WebReaderHost conversationUrl={null} projectUrl={null} onSave={vi.fn()} />)
    const frame = screen.getByTitle('Web Reader') as HTMLIFrameElement
    const post = vi.spyOn(frame.contentWindow as Window, 'postMessage')
    hostMessage(frame, { kind: 'ready' })
    expect(ensurePreview).not.toHaveBeenCalled()
    expect(post.mock.calls.every(([message]) => (message as { url?: string | null }).url == null)).toBe(true)
  })

  it('open→read ждёт page ready и сопоставляет ответ', async () => {
    const register = vi.fn<(runner: PreviewActionRunner | null) => void>()
    const view = render(<WebReaderHost conversationUrl="https://shop.example" projectUrl={null} onSave={vi.fn()} onRegisterActionRunner={register} />)
    const frame = screen.getByTitle('Web Reader') as HTMLIFrameElement
    const post = vi.spyOn(frame.contentWindow as Window, 'postMessage')
    hostMessage(frame, { kind: 'ready' })
    const runner = register.mock.calls.at(-1)?.[0]!
    const open = runner({ kind: 'open', url: 'https://shop.example' })
    const read = runner({ kind: 'read' })
    expect(post.mock.calls.some(([message]) => (message as { kind?: string }).kind === 'run-action')).toBe(false)
    hostMessage(frame, { kind: 'page-status', status: 'ready', url: 'https://shop.example' })
    await expect(open).resolves.toEqual({ ok: true, result: { url: 'https://shop.example' } })
    const command = post.mock.calls.map(([message]) => message as { kind?: string; requestId?: string; action?: { kind: string } }).find((message) => message.kind === 'run-action' && message.action?.kind === 'read')!
    const result = { page: { url: 'https://shop.example', title: 'Shop' }, headings: [], links: [], buttons: [], inputs: [], text: 'Loaded' }
    hostMessage(frame, { kind: 'action-result', requestId: command.requestId, ok: true, result })
    await expect(read).resolves.toEqual({ ok: true, result })
    view.unmount()
  })

  it('повторный open того же URL перезагружает recorder и получает новый ready', async () => {
    const register = vi.fn<(runner: PreviewActionRunner | null) => void>()
    render(<WebReaderHost conversationUrl="https://shop.example" projectUrl={null} onSave={vi.fn()} onRegisterActionRunner={register} />)
    const frame = screen.getByTitle('Web Reader') as HTMLIFrameElement
    const post = vi.spyOn(frame.contentWindow as Window, 'postMessage')
    hostMessage(frame, { kind: 'ready' })
    hostMessage(frame, { kind: 'page-status', status: 'ready', url: 'https://shop.example' })

    post.mockClear()
    const open = register.mock.calls.at(-1)?.[0]!({ kind: 'open', url: 'https://shop.example' })
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ kind: 'set-url', url: null }), '*')
    await Promise.resolve()
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ kind: 'set-url', url: 'https://shop.example' }), '*')
    hostMessage(frame, { kind: 'page-status', status: 'ready', url: 'https://shop.example' })

    await expect(open).resolves.toEqual({ ok: true, result: { url: 'https://shop.example' } })
  })

  it('find→click и read после navigation снова ждёт ready', async () => {
    const register = vi.fn<(runner: PreviewActionRunner | null) => void>()
    render(<WebReaderHost conversationUrl="https://shop.example" projectUrl={null} onSave={vi.fn()} onRegisterActionRunner={register} />)
    const frame = screen.getByTitle('Web Reader') as HTMLIFrameElement
    const post = vi.spyOn(frame.contentWindow as Window, 'postMessage')
    hostMessage(frame, { kind: 'ready' })
    hostMessage(frame, { kind: 'page-status', status: 'ready', url: 'https://shop.example' })
    const runner = register.mock.calls.at(-1)?.[0]!
    const finish = async (promise: Promise<unknown>, kind: string): Promise<void> => {
      const command = post.mock.calls.map(([message]) => message as { kind?: string; requestId?: string; action?: { kind: string } }).filter((message) => message.kind === 'run-action' && message.action?.kind === kind).at(-1)!
      hostMessage(frame, { kind: 'action-result', requestId: command.requestId, ok: true, result: { page: { url: 'https://shop.example', title: '' }, elements: [], total: 0 } })
      await promise
    }
    await finish(runner({ kind: 'find', text: 'Cookies' }), 'find')
    await finish(runner({ kind: 'click', text: 'Accept' }), 'click')
    await finish(runner({ kind: 'type', selector: '#search', text: 'shoes', submit: true }), 'type')
    hostMessage(frame, { kind: 'page-status', status: 'loading', url: 'https://next.example' })
    const before = post.mock.calls.length
    const read = runner({ kind: 'read' })
    expect(post.mock.calls).toHaveLength(before)
    hostMessage(frame, { kind: 'page-status', status: 'ready', url: 'https://next.example' })
    expect(post.mock.calls.length).toBeGreaterThan(before)
    await finish(read, 'read')
  })

  it('без randomUUID отправляет параллельные команды с разными requestId', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    let byte = 0
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => { bytes.fill(++byte); return bytes } })
    try {
      const register = vi.fn<(runner: PreviewActionRunner | null) => void>()
      render(<WebReaderHost conversationUrl="http://shop.example" projectUrl={null} onSave={vi.fn()} onRegisterActionRunner={register} />)
      const frame = screen.getByTitle('Web Reader') as HTMLIFrameElement
      const post = vi.spyOn(frame.contentWindow as Window, 'postMessage')
      hostMessage(frame, { kind: 'ready' })
      hostMessage(frame, { kind: 'page-status', status: 'ready', url: 'http://shop.example' })
      const runner = register.mock.calls.at(-1)?.[0]!
      const first = runner({ kind: 'read' })
      const second = runner({ kind: 'find', text: 'Купить' })
      const commands = post.mock.calls
        .map(([message]) => message as { kind?: string; requestId?: string })
        .filter((message) => message.kind === 'run-action')
      expect(commands).toHaveLength(2)
      expect(commands.every((command) => command.requestId?.startsWith('wr-'))).toBe(true)
      expect(commands[0]!.requestId).not.toBe(commands[1]!.requestId)
      hostMessage(frame, { kind: 'action-result', requestId: commands[1]!.requestId, ok: true, result: { elements: [], total: 0 } })
      hostMessage(frame, { kind: 'action-result', requestId: commands[0]!.requestId, ok: true, result: { text: '' } })
      await expect(first).resolves.toMatchObject({ ok: true })
      await expect(second).resolves.toMatchObject({ ok: true })
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original)
      else delete (globalThis as { crypto?: Crypto }).crypto
    }
  })

  it('различает ошибку сайта и очищает ожидания при закрытии', async () => {
    const register = vi.fn<(runner: PreviewActionRunner | null) => void>()
    const view = render(<WebReaderHost conversationUrl="https://broken.example" projectUrl={null} onSave={vi.fn()} onRegisterActionRunner={register} />)
    const frame = screen.getByTitle('Web Reader') as HTMLIFrameElement
    hostMessage(frame, { kind: 'ready' })
    const runner = register.mock.calls.at(-1)?.[0]!
    const pending = runner({ kind: 'read' })
    hostMessage(frame, { kind: 'page-status', status: 'error', url: 'https://broken.example', error: 'DNS lookup failed' })
    await expect(pending).resolves.toMatchObject({ ok: false, error: expect.stringContaining('DNS') })
    const hanging = runner({ kind: 'open', url: 'https://slow.example' })
    view.unmount()
    await expect(hanging).resolves.toMatchObject({ ok: false, error: expect.stringContaining('закрыта') })
  })
})

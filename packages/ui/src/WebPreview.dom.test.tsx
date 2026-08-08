import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PREVIEW_INSPECTOR_MESSAGE_TYPE } from '@shared/previewInspector'
import { PREVIEW_ACTION_COMMAND_TYPE, PREVIEW_ACTION_RESULT_TYPE } from '@shared/previewActions'
import { PreviewPane, type PreviewActionRunner } from './App'

const payload = {
  tag: 'div', id: 'hero', classes: [], dataAttributes: {}, selector: '#hero', ancestors: ['html','body','div#hero'],
  rect: { x: 0, y: 0, top: 0, right: 320, bottom: 120, left: 0, width: 320, height: 120 },
  pageUrl: 'https://example.test', viewport: { width: 800, height: 600 }, outerHTML: '<div id="hero"></div>', text: '',
  styles: { font:'',color:'',backgroundColor:'',margin:'',padding:'',border:'',width:'',height:'',position:'',display:'',flex:'',flexDirection:'',flexWrap:'',alignItems:'',justifyContent:'',gap:'',grid:'',gridTemplateColumns:'',gridTemplateRows:'',gridArea:'' }
}

describe('WebPreview session', () => {
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
})

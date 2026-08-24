// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PREVIEW_ACTION_COMMAND_TYPE, PREVIEW_ACTION_RESULT_TYPE, PREVIEW_PAGE_READY_TYPE } from '@shared/previewActions'
import { PREVIEW_INSPECTOR_COMMAND_TYPE } from '@shared/previewInspector'
import { WEB_RECORDER_MESSAGE_TYPE, WEB_RECORDER_PROTOCOL_VERSION } from '@shared/webRecorder'
import { Recorder } from './Recorder'

const type = WEB_RECORDER_MESSAGE_TYPE
const ids = { conversationId: 'conv-1', registrationId: 'reg-1' }
const init = { type, ...ids, kind: 'init', protocolVersion: WEB_RECORDER_PROTOCOL_VERSION, previewUrl: 'https://shop.example/', capabilities: ['mcp-actions'] }

/** Сообщение host → Reader; в jsdom parent === window, поэтому source: window. */
function fromHost(data: object): void {
  fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: window, data }))
}
function fromPage(data: object): void {
  const frame = screen.getByTitle('Предпросмотр сайта') as HTMLIFrameElement
  fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow, data }))
}
/** Отправленные Reader-ом сообщения контракта (parent === window в jsdom). */
function sent(spy: ReturnType<typeof vi.spyOn>): Array<Record<string, unknown>> {
  return spy.mock.calls.map(([message]) => message as Record<string, unknown>).filter((message) => message.type === type)
}

const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (originalCryptoDescriptor) Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor)
  else delete (globalThis as { crypto?: Crypto }).crypto
})

describe('Recorder handshake', () => {
  it('шлёт ready с версией протокола после установки listener и принимает init', async () => {
    const post = vi.spyOn(window, 'postMessage')
    render(<Recorder />)
    const ready = sent(post).find((message) => message.kind === 'ready')!
    expect(ready).toMatchObject({ protocolVersion: WEB_RECORDER_PROTOCOL_VERSION, conversationId: null, registrationId: null, capabilities: expect.arrayContaining(['read', 'diagnostics']) })
    fromHost(init)
    await waitFor(() => expect(screen.queryByTitle('Предпросмотр сайта')).toBeTruthy())
    const status = sent(post).find((message) => message.kind === 'page-status')!
    expect(status).toMatchObject({ ...ids, status: 'loading', url: 'https://shop.example/' })
  })

  it('повторный init той же регистрации не перезагружает страницу', async () => {
    const post = vi.spyOn(window, 'postMessage')
    render(<Recorder />)
    fromHost(init)
    fromPage({ type: PREVIEW_PAGE_READY_TYPE })
    post.mockClear()
    fromHost(init)
    const statuses = sent(post).filter((message) => message.kind === 'page-status')
    expect(statuses).toEqual([expect.objectContaining({ status: 'ready', url: 'https://shop.example/' })])
  })

  it('игнорирует команды с чужими или устаревшими ID', () => {
    const post = vi.spyOn(window, 'postMessage')
    render(<Recorder />)
    fromHost(init)
    post.mockClear()
    fromHost({ type, conversationId: 'other-conv', registrationId: 'reg-1', kind: 'command', requestId: 'r1', action: { kind: 'read' } })
    fromHost({ type, conversationId: 'conv-1', registrationId: 'stale-reg', kind: 'command', requestId: 'r2', action: { kind: 'read' } })
    expect(sent(post).filter((message) => message.kind === 'result')).toHaveLength(0)
  })

  it('игнорирует сообщение host с чужим origin', () => {
    const post = vi.spyOn(window, 'postMessage')
    render(<Recorder />)
    fireEvent(window, new MessageEvent('message', { origin: 'https://evil.test', source: window, data: init }))
    expect(sent(post).filter((message) => message.kind === 'page-status')).toHaveLength(0)
  })
})

describe('Recorder commands', () => {
  it('command до готовности страницы получает строго определённую ошибку', () => {
    const post = vi.spyOn(window, 'postMessage')
    render(<Recorder />)
    fromHost(init)
    fromHost({ type, ...ids, kind: 'command', requestId: 'r1', action: { kind: 'read' } })
    expect(sent(post).find((message) => message.kind === 'result')).toMatchObject({ ...ids, requestId: 'r1', ok: false, error: 'Страница ещё загружается.' })
  })

  it('после page-ready пересылает command в iframe и возвращает result с ID', () => {
    const post = vi.spyOn(window, 'postMessage')
    render(<Recorder />)
    fromHost(init)
    const frame = screen.getByTitle('Предпросмотр сайта') as HTMLIFrameElement
    const inner = vi.spyOn(frame.contentWindow as Window, 'postMessage')
    fromPage({ type: PREVIEW_PAGE_READY_TYPE })
    expect(sent(post).some((message) => message.kind === 'page-status' && message.status === 'ready')).toBe(true)
    fromHost({ type, ...ids, kind: 'command', requestId: 'r1', action: { kind: 'read' } })
    expect(inner.mock.calls.some(([message]) => (message as { type?: string; requestId?: string }).type === PREVIEW_ACTION_COMMAND_TYPE && (message as { requestId?: string }).requestId === 'r1')).toBe(true)
    const result = { page: { url: 'https://shop.example/', title: 'Shop' }, headings: [], links: [], buttons: [], inputs: [], text: 'Loaded' }
    fromPage({ type: PREVIEW_ACTION_RESULT_TYPE, requestId: 'r1', ok: true, result })
    expect(sent(post).find((message) => message.kind === 'result' && message.requestId === 'r1')).toMatchObject({ ...ids, ok: true, result })
  })

  it('dispose отвечает disposed и перестаёт исполнять команды', () => {
    const post = vi.spyOn(window, 'postMessage')
    render(<Recorder />)
    fromHost(init)
    fromPage({ type: PREVIEW_PAGE_READY_TYPE })
    fromHost({ type, ...ids, kind: 'dispose' })
    expect(sent(post).some((message) => message.kind === 'disposed')).toBe(true)
    expect(screen.getByRole('status').textContent).toContain('отключена')
    post.mockClear()
    fromHost({ type, ...ids, kind: 'command', requestId: 'r-late', action: { kind: 'read' } })
    expect(sent(post)).toHaveLength(0)
  })
})

describe('Recorder inspector и запись', () => {
  it('inspector-state пересылается внутрь и включает тумблер', () => {
    render(<Recorder />)
    fromHost(init)
    const frame = screen.getByTitle('Предпросмотр сайта') as HTMLIFrameElement
    const inner = vi.spyOn(frame.contentWindow as Window, 'postMessage')
    fromHost({ type, ...ids, kind: 'inspector-state', enabled: true })
    expect(inner.mock.calls.some(([message]) => (message as { type?: string; enabled?: boolean }).type === PREVIEW_INSPECTOR_COMMAND_TYPE && (message as { enabled?: boolean }).enabled === true)).toBe(true)
    expect(screen.getByRole('button', { name: /Выбор элемента/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('записанный шаг уходит host-у, секретное значение не покидает страницу', () => {
    const post = vi.spyOn(window, 'postMessage')
    render(<Recorder />)
    fromHost(init)
    fromPage({ type: 'voicechat.preview.record.v1', step: { kind: 'click', selector: '#buy', text: 'Купить' } })
    fromPage({ type: 'voicechat.preview.record.v1', step: { kind: 'type', selector: '#password', text: 'hunter2', sensitive: true } })
    const steps = sent(post).filter((message) => message.kind === 'recording-step')
    expect(steps[0]).toMatchObject({ step: { kind: 'click', selector: '#buy', text: 'Купить', sensitive: false } })
    expect(steps[1]).toMatchObject({ step: { kind: 'type', selector: '#password', text: '', sensitive: true } })
    expect(JSON.stringify(steps)).not.toContain('hunter2')
    expect((screen.getByLabelText('Значение шага 2') as HTMLInputElement).value).toBe('••••••')
    expect(screen.getByText('секрет не сохранён')).toBeTruthy()
  })
})

describe('Recorder диагностика', () => {
  it('в режиме диагностики шаги дают diagnostics-progress, не попадают в запись, а стоп — diagnostics-complete', () => {
    const post = vi.spyOn(window, 'postMessage')
    render(<Recorder />)
    fromHost(init)
    fromPage({ type: PREVIEW_PAGE_READY_TYPE })
    fromHost({ type, ...ids, kind: 'diagnostics-start', active: true })
    fromHost({ type, ...ids, kind: 'command', requestId: 'diag-1', action: { kind: 'read', diagnostic: true } })
    fromPage({ type: 'voicechat.preview.record.v1', step: { kind: 'click', selector: '#diag', text: 'x' } })
    fromPage({ type: PREVIEW_ACTION_RESULT_TYPE, requestId: 'diag-1', ok: true, result: { text: 'ok' } })
    const progress = sent(post).find((message) => message.kind === 'diagnostics-progress')!
    expect(progress).toMatchObject({ ...ids, requestId: 'diag-1', action: 'read', ok: true, durationMs: expect.any(Number) })
    expect(sent(post).filter((message) => message.kind === 'recording-step')).toHaveLength(0)
    expect(screen.getByRole('region', { name: 'Диагностика Web Reader' }).textContent).toContain('read')
    fromHost({ type, ...ids, kind: 'diagnostics-start', active: false })
    expect(sent(post).find((message) => message.kind === 'diagnostics-complete')).toMatchObject({ ...ids, total: 1 })
  })
})

describe('Recorder edit-режим', () => {
  it('кнопка «Редактировать» включает edit-режим внутреннего iframe', () => {
    render(<Recorder />)
    fromHost(init)
    const frame = screen.getByTitle('Предпросмотр сайта') as HTMLIFrameElement
    const inner = vi.spyOn(frame.contentWindow as Window, 'postMessage')
    const toggle = screen.getByRole('button', { name: /Редактировать$/ })
    fireEvent.click(toggle)
    expect(inner.mock.calls.some(([message]) => (message as { type?: string; enabled?: boolean }).type === 'voicechat.preview.edit.v1' && (message as { enabled?: boolean }).enabled === true)).toBe(true)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
  })

  it('Escape внутри страницы выключает режим: iframe сообщает enabled:false', () => {
    render(<Recorder />)
    fromHost(init)
    fireEvent.click(screen.getByRole('button', { name: /Редактировать$/ }))
    fromPage({ type: 'voicechat.preview.edit.v1', enabled: false })
    expect(screen.getByRole('button', { name: /Редактировать$/ }).getAttribute('aria-pressed')).toBe('false')
  })
})

describe('Recorder submit-шаги', () => {
  it('Enter-сабмит авторизации показывается бейджем и уходит host-у с submit', () => {
    const post = vi.spyOn(window, 'postMessage')
    render(<Recorder />)
    fromHost(init)
    fromPage({ type: 'voicechat.preview.record.v1', step: { kind: 'type', selector: '#password', text: '', sensitive: true, submit: true } })
    expect(screen.getByText('⏎ submit')).toBeTruthy()
    const step = sent(post).find((message) => message.kind === 'recording-step')!
    expect(step).toMatchObject({ step: { kind: 'type', selector: '#password', text: '', sensitive: true, submit: true } })
  })

  it('воспроизведение submit-шага отправляет type-действие с submit', () => {
    render(<Recorder />)
    fromHost(init)
    fireEvent.change(screen.getByPlaceholderText('https://example.com'), { target: { value: 'http://example.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }))
    const frame = screen.getByTitle('Предпросмотр сайта') as HTMLIFrameElement
    const inner = vi.spyOn(frame.contentWindow as Window, 'postMessage')
    fromPage({ type: 'voicechat.preview.record.v1', step: { kind: 'type', selector: '#q', text: 'ноутбук', submit: true } })
    fireEvent.click(screen.getByRole('button', { name: 'Запустить' }))
    const action = inner.mock.calls.map(([message]) => message as { type?: string; action?: { kind?: string; submit?: boolean; sensitive?: unknown } }).find((message) => message.type === PREVIEW_ACTION_COMMAND_TYPE)!
    expect(action.action).toEqual({ kind: 'type', selector: '#q', text: 'ноутбук', submit: true })
  })
})

describe('Recorder scenario', () => {
  it('запускает каждый шаг с уникальным локальным requestId без randomUUID', () => {
    let byte = 0
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => { bytes.fill(++byte); return bytes } })
    render(<Recorder />)
    fireEvent.change(screen.getByPlaceholderText('https://example.com'), { target: { value: 'http://example.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }))
    const frame = screen.getByTitle('Предпросмотр сайта') as HTMLIFrameElement
    const postMessage = vi.spyOn(frame.contentWindow as Window, 'postMessage')
    for (const step of [
      { kind: 'click', selector: '#buy', text: '' },
      { kind: 'type', selector: '#search', text: 'shoes' }
    ]) {
      fromPage({ type: 'voicechat.preview.record.v1', step })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Запустить' }))
    const commands = postMessage.mock.calls
      .map(([message]) => message as { type?: string; requestId?: string })
      .filter((message) => message.type === PREVIEW_ACTION_COMMAND_TYPE)
    expect(commands).toHaveLength(2)
    expect(commands.every((command) => command.requestId?.startsWith('local-'))).toBe(true)
    expect(new Set(commands.map((command) => command.requestId))).toHaveLength(2)
  })
})

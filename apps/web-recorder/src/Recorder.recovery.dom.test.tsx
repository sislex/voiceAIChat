// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PREVIEW_PAGE_READY_TYPE } from '@shared/previewActions'
import { WEB_RECORDER_MESSAGE_TYPE as type, WEB_RECORDER_PROTOCOL_VERSION as protocolVersion } from '@shared/webRecorder'
import { Recorder } from './Recorder'
const ids = { conversationId: 'c', registrationId: 'r' }
const key = 'voicechat.reader.scenario.v2:https://page.test/'
function host(data: object) { fireEvent(window, new MessageEvent('message', { origin: location.origin, source: window, data })) }
function mount() {
  const view = render(<Recorder />); host({ type, kind: 'init', ...ids, protocolVersion, previewUrl: 'https://page.test/', capabilities: [] })
  const frame = screen.getByTitle('Предпросмотр сайта') as HTMLIFrameElement
  fireEvent(window, new MessageEvent('message', { origin: location.origin, source: frame.contentWindow, data: { type: PREVIEW_PAGE_READY_TYPE } }))
  return view
}
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const seed = () => localStorage.setItem(key, JSON.stringify([{ kind: 'click', selector: '#go', text: '', sensitive: false }]))
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear() })
it('collapses step editing while preserving the count and playback controls', () => {
  seed(); mount(); click('Скрыть шаги'); expect(screen.queryByRole('textbox', { name: 'Селектор шага 1' })).toBeNull(); expect(screen.getByText('Шагов: 1 / 200')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Запустить' })).toBeTruthy(); click('Показать шаги'); expect(screen.getByRole('textbox', { name: 'Селектор шага 1' })).toBeTruthy()
})
it('shows a storage failure and retries without losing the scenario', () => {
  seed(); const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') }); mount()
  expect(screen.getByRole('alert').textContent).toContain('Сценарий не сохранён'); write.mockRestore(); click('Повторить сохранение')
  expect(screen.queryByRole('alert')).toBeNull(); expect(JSON.parse(localStorage.getItem(key)!)[0].selector).toBe('#go')
})
it('prevents duplicate session reset requests', async () => {
  let finish!: (value: Response) => void; const fetch = vi.fn(() => new Promise<Response>(resolve => { finish = resolve })); vi.stubGlobal('fetch', fetch); mount(); click('⟲ Сессия')
  const busy = screen.getByRole('button', { name: 'Сбрасываем сессию…' }) as HTMLButtonElement; expect(busy.disabled).toBe(true); fireEvent.click(busy); expect(fetch).toHaveBeenCalledTimes(1)
  finish({ ok: true } as Response); await screen.findByRole('button', { name: '⟲ Сессия' })
})
it('aborts a reset after navigation and ignores its late success', async () => {
  let finish!: (value: Response) => void; const fetch = vi.fn(() => new Promise<Response>(resolve => { finish = resolve })); vi.stubGlobal('fetch', fetch); mount(); click('⟲ Сессия')
  host({ type, ...ids, kind: 'set-url', url: 'https://next.test/' }); const frame = screen.getByTitle('Предпросмотр сайта')
  expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(true)
  finish({ ok: true } as Response); await waitFor(() => expect(screen.getByTitle('Предпросмотр сайта')).toBe(frame))
})
it('clears reset timers and aborts the request on unmount', async () => {
  vi.useFakeTimers(); const fetch = vi.fn(() => new Promise<Response>(() => {})); vi.stubGlobal('fetch', fetch); const view = mount(); click('⟲ Сессия'); view.unmount(); await vi.advanceTimersByTimeAsync(0)
  expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0)
})
it('shows and dismisses reset errors', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline'))); mount(); click('⟲ Сессия'); await screen.findByRole('alert'); click('Скрыть ошибку Reader'); expect(screen.queryByRole('alert')).toBeNull()
})
it('bounds stalled reset requests and permits retry', async () => {
  vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(new Error('aborted'))))))
  mount(); click('⟲ Сессия'); await vi.advanceTimersByTimeAsync(15000)
  expect(screen.getByRole('alert').textContent).toContain('слишком много времени'); expect((screen.getByRole('button', { name: '⟲ Сессия' }) as HTMLButtonElement).disabled).toBe(false)
})
it('dismisses a finished playback result', async () => {
  seed(); mount(); click('Запустить'); click('Остановить сценарий'); await screen.findByRole('button', { name: 'Скрыть результат сценария' }); click('Скрыть результат сценария'); expect(document.querySelector('.webpreview-run-status')).toBeNull()
})
it('shows recording status after the tools menu closes', () => {
  mount(); click('Записать сценарий'); expect(screen.getByRole('status').textContent).toContain('Идёт запись сценария: 0 шаг.')
})

it('cancels resets when the live page navigates inside an SPA', async () => {
  let finish!: (value: Response) => void; const fetch = vi.fn(() => new Promise<Response>(resolve => { finish = resolve })); vi.stubGlobal('fetch', fetch); mount(); click('⟲ Сессия')
  const frame = screen.getByTitle('Предпросмотр сайта') as HTMLIFrameElement
  fireEvent(window, new MessageEvent('message', { origin: location.origin, source: frame.contentWindow, data: { type: PREVIEW_PAGE_READY_TYPE, url: 'https://page.test/#next' } }))
  expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(true)
  finish({ ok: true } as Response); await waitFor(() => expect(screen.getByTitle('Предпросмотр сайта')).toBe(frame))
})

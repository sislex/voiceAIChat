import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WEB_RECORDER_MESSAGE_TYPE as type, WEB_RECORDER_PROTOCOL_VERSION as protocolVersion } from '@shared/webRecorder'
import { WebReaderFrame } from './WebReaderFrame'
import type { ReaderHostRegistration } from './hostBridge'
const platform = { origin: window.location.origin, subscribeMessages: (fn: (event: MessageEvent) => void) => { window.addEventListener('message', fn); return () => window.removeEventListener('message', fn) } }
afterEach(() => cleanup())
function deferred<T>() { let resolve!: (value: T) => void, reject!: (e: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function harness(onSave = vi.fn(async (_url: string | null) => {}), ensurePreview?: () => Promise<boolean>) {
  let registration: ReaderHostRegistration | null = null
  const props = { conversationId: 'c', projectUrl: null, conversationUrl: 'https://initial.test/', platform, onSave, ensurePreview, onRegisterHost: (r: ReaderHostRegistration | null) => { registration = r } }
  const rendered = render(<WebReaderFrame {...props} />)
  const emit = (message: object) => fireEvent(window, new MessageEvent('message', { origin: platform.origin, source: (screen.getByTitle('Web Reader') as HTMLIFrameElement).contentWindow, data: { type, conversationId: 'c', registrationId: registration?.registrationId, ...message } }))
  emit({ kind: 'ready', protocolVersion, conversationId: null, registrationId: null, capabilities: [] })
  return { ...rendered, props, emit, registration: () => registration!, onSave }
}
it('shows a pending save until persistence completes', async () => {
  const pending = deferred<void>(), h = harness(vi.fn(() => pending.promise))
  h.emit({ kind: 'save-url', url: 'https://next.test/' })
  expect(screen.getByText('Сохраняем адрес страницы…')).toBeVisible()
  await act(async () => pending.resolve())
  expect(screen.queryByText('Сохраняем адрес страницы…')).not.toBeInTheDocument()
})
it('suppresses a failed older save when a newer address is queued', async () => {
  const old = deferred<void>(), h = harness(vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(undefined))
  h.emit({ kind: 'save-url', url: 'https://old.test/' }); h.emit({ kind: 'save-url', url: 'https://new.test/' })
  await act(async () => old.reject(new Error('old failure')))
  await waitFor(() => expect(h.onSave).toHaveBeenCalledWith('https://new.test/'))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
it('clears a failed save and retry after a newer successful save', async () => {
  const h = harness(vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined))
  h.emit({ kind: 'save-url', url: 'https://old.test/' })
  await screen.findByRole('button', { name: 'Повторить сохранение' })
  h.emit({ kind: 'save-url', url: 'https://new.test/' })
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(screen.queryByRole('button', { name: 'Повторить сохранение' })).not.toBeInTheDocument()
})
it('does not carry save failures into another conversation', async () => {
  const h = harness(vi.fn().mockRejectedValue(new Error('offline')))
  h.emit({ kind: 'save-url', url: 'https://old.test/' }); await screen.findByRole('alert')
  h.rerender(<WebReaderFrame {...h.props} conversationId="new" />)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
it('makes the iframe inert while preparation is pending', async () => {
  const pending = deferred<boolean>(); harness(undefined, () => pending.promise)
  expect(screen.getByTitle('Web Reader')).toHaveAttribute('inert')
  expect(screen.getByTitle('Web Reader')).toHaveAttribute('tabindex', '-1')
  await act(async () => pending.resolve(true))
  expect(screen.getByTitle('Web Reader')).not.toHaveAttribute('inert')
})
it('does not let an older model preparation replace a new host URL', async () => {
  const model = deferred<boolean>(), ensure = vi.fn().mockResolvedValueOnce(true).mockReturnValueOnce(model.promise).mockResolvedValue(true)
  const h = harness(undefined, ensure)
  await waitFor(() => expect(screen.queryByText('Подключение Web Preview…')).not.toBeInTheDocument())
  let result!: ReturnType<ReaderHostRegistration['run']>
  await act(async () => { result = h.registration().run({ kind: 'open', url: 'https://old-model.test/' }); await Promise.resolve() })
  h.rerender(<WebReaderFrame {...h.props} conversationUrl="https://new-host.test/" />)
  await act(async () => model.resolve(true))
  await expect(result).resolves.toMatchObject({ ok: false })
  expect(h.onSave).not.toHaveBeenCalledWith('https://old-model.test/')
})

// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WEB_RECORDER_MESSAGE_TYPE as type, WEB_RECORDER_PROTOCOL_VERSION as protocolVersion } from '@shared/webRecorder'
import { Recorder } from './Recorder'
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear() })
function mount() {
  const post = vi.spyOn(window, 'postMessage'); render(<Recorder />)
  fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: window, data: { type, kind: 'init', protocolVersion, conversationId: 'c', registrationId: 'r', capabilities: [], previewUrl: 'https://initial.test/path' } }))
  return { post, address: screen.getByRole('textbox', { name: 'Адрес превью' }) as HTMLInputElement }
}
it('associates URL errors with the field and clears them when editing', () => {
  const { address } = mount(); fireEvent.change(address, { target: { value: 'file:///tmp/test' } }); fireEvent.click(screen.getByRole('button', { name: 'Открыть' }))
  expect(address.getAttribute('aria-invalid')).toBe('true'); expect(document.getElementById(address.getAttribute('aria-describedby')!)?.textContent).toBe('Поддерживаются адреса http:// и https://.')
  fireEvent.change(address, { target: { value: 'example.test' } }); expect(address.getAttribute('aria-invalid')).toBe('false')
})
it('restores the live address with Escape', () => {
  const { address } = mount(); fireEvent.change(address, { target: { value: 'unfinished' } }); fireEvent.keyDown(address, { key: 'Escape' })
  expect(address.value).toBe('https://initial.test/path')
})
it.each(['ctrlKey', 'metaKey'])('selects the address with %s+L', modifier => {
  const { address } = mount(); fireEvent.keyDown(screen.getByRole('button', { name: 'Открыть' }), { key: 'l', [modifier]: true })
  expect(document.activeElement).toBe(address); expect(address.selectionStart).toBe(0); expect(address.selectionEnd).toBe(address.value.length)
})
it('clears the preview and sends a null URL to the host', () => {
  const { address, post } = mount(); fireEvent.click(screen.getByRole('button', { name: 'Очистить страницу' }))
  expect(screen.queryByTitle('Предпросмотр сайта')).toBeNull(); expect(address.value).toBe(''); expect(document.activeElement).toBe(address)
  expect(post.mock.calls.some(([message]) => message.kind === 'save-url' && message.url === null)).toBe(true)
})

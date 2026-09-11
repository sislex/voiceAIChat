// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PREVIEW_ACTION_RESULT_TYPE, PREVIEW_PAGE_READY_TYPE } from '@shared/previewActions'
import { WEB_RECORDER_MESSAGE_TYPE as type, WEB_RECORDER_PROTOCOL_VERSION as protocolVersion } from '@shared/webRecorder'
import { Recorder } from './Recorder'
const ids = { conversationId: 'c', registrationId: 'r' }
const init = { type, kind: 'init', ...ids, protocolVersion, previewUrl: 'https://page.test/', capabilities: [] }
function host(data: object) { fireEvent(window, new MessageEvent('message', { origin: location.origin, source: window, data })) }
function page(data: object) { const frame = screen.getByTitle('Предпросмотр сайта') as HTMLIFrameElement; fireEvent(window, new MessageEvent('message', { origin: location.origin, source: frame.contentWindow, data })) }
function mount() { const post = vi.spyOn(window, 'postMessage'); render(<Recorder />); host(init); page({ type: PREVIEW_PAGE_READY_TYPE }); return post }
const command = (id: string) => host({ type, ...ids, kind: 'command', requestId: id, action: { kind: 'read', diagnostic: true } })
const result = (id: string) => page({ type: PREVIEW_ACTION_RESULT_TYPE, requestId: id, ok: true })
const progress = (post: ReturnType<typeof mount>) => post.mock.calls.map(([message]) => message).filter(message => message.kind === 'diagnostics-progress')
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear() })
it('shows standalone diagnostic commands without a diagnostics session', () => {
  mount(); command('one'); result('one'); expect(screen.getByRole('region', { name: 'Диагностика Web Reader' }).textContent).toContain('Успешно: 1')
})
it('clears timing ownership when registration changes', () => {
  const post = mount(); command('old'); host({ ...init, registrationId: 'next' }); result('old'); expect(progress(post)).toEqual([])
})
it('clears pending timings when navigation replaces the page', () => {
  const post = mount(); command('old'); host({ type, ...ids, kind: 'set-url', url: 'https://next.test/' }); result('old'); expect(progress(post)).toEqual([])
})
it('caps outstanding timing records at 64', () => {
  const post = mount(); for (let i = 0; i < 65; i++) command(String(i)); result('0'); expect(progress(post)).toHaveLength(0)
  result('64'); expect(progress(post)).toHaveLength(1)
})
it('starts a new diagnostics run without inheriting old pending timings', () => {
  const post = mount(); host({ type, ...ids, kind: 'diagnostics-start', active: true }); command('old')
  host({ type, ...ids, kind: 'diagnostics-start', active: true }); result('old'); expect(progress(post)).toEqual([])
})

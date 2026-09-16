import { useState } from 'react'
import { expect, it, vi, afterEach } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from '../test/uiRender'
import { createFakeApi } from '@voicechat/ui-foundation/test/fakeApi'
import { CommandPalette } from './CommandPalette'
import { SEARCH_SOURCES, SEARCH_LABELS, type UniversalSearchResult } from '@shared/universalSearch'

const result = (title = 'needle', suffix = 'a'): UniversalSearchResult => ({
  groups: SEARCH_SOURCES.map(source => ({
    source, status: 'ok', hits: [{
      id: source + ':' + suffix.repeat(64), source, title: title + ' ' + source, snippet: '<script>literal only</script>',
      target: { source: 'projects', projectId: source }, href: '#/projects/' + source
    }]
  })), nextCursor: null
})
afterEach(() => { localStorage.clear(); vi.useRealTimers() })
const input = () => screen.getByRole('combobox')

// @testCase TC-UI
// @testCase TC-SECURITY
it('renders six accessible groups as text, selects with keyboard and restores focus', async () => {
  const api = createFakeApi()
  api['search:universal'] = vi.fn(async () => result())
  const navigate = vi.fn()
  function Host() {
    const [open, setOpen] = useState(false)
    return <><button onClick={() => setOpen(true)}>Open search</button><CommandPalette api={api} userId="alice" open={open} onClose={() => setOpen(false)} onNavigate={navigate} commands={[]} /></>
  }
  render(<Host />)
  const opener = screen.getByRole('button', { name: 'Open search' })
  opener.focus(); fireEvent.click(opener)
  expect(input()).toHaveFocus()
  fireEvent.change(input(), { target: { value: 'needle' } })
  await screen.findByRole('group', { name: SEARCH_LABELS.kb })
  for (const source of SEARCH_SOURCES) expect(screen.getByRole('group', { name: SEARCH_LABELS[source] })).toBeInTheDocument()
  expect(document.querySelector('.cmdk script')).toBeNull()
  fireEvent.keyDown(input(), { key: 'ArrowDown' })
  fireEvent.keyDown(input(), { key: 'Enter' })
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('#/projects/messages'))
  expect(opener).toHaveFocus()
  expect(localStorage.getItem('vc:search:recent:alice')).not.toContain('needle')
  expect(localStorage.getItem('vc:search:recent:alice')).not.toContain('script')
})

// @testCase TC-CONSISTENCY
// @testCase TC-UI
it('debounces, cancels and ignores stale responses after query changes, close and logout', async () => {
  const api = createFakeApi()
  const requests: Array<{ query: string; resolve: (value: UniversalSearchResult) => void }> = []
  api['search:universal'] = vi.fn(({ query }) => new Promise<UniversalSearchResult>(resolve => requests.push({ query, resolve })))
  api['search:cancel'] = vi.fn(async () => {})
  const view = render(<CommandPalette api={api} userId="alice" open onClose={() => {}} commands={[]} />)
  fireEvent.change(input(), { target: { value: 'old' } })
  fireEvent.change(input(), { target: { value: 'new' } })
  await waitFor(() => expect(requests.some(request => request.query === 'new')).toBe(true))
  expect(requests.some(request => request.query === 'old')).toBe(false)
  fireEvent.change(input(), { target: { value: 'latest' } })
  await waitFor(() => expect(requests.some(request => request.query === 'latest')).toBe(true))
  await act(async () => requests.find(request => request.query === 'latest')!.resolve(result('latest')))
  await act(async () => requests.find(request => request.query === 'new')!.resolve(result('stale')))
  expect(screen.queryByText('stale chats')).toBeNull()
  expect(screen.getByText('latest chats')).toBeInTheDocument()
  view.rerender(<CommandPalette api={api} userId="bob" open onClose={() => {}} commands={[]} />)
  expect(screen.queryByText('latest chats')).toBeNull()
  view.rerender(<CommandPalette api={api} userId="bob" open={false} onClose={() => {}} commands={[]} />)
  await act(async () => requests.forEach(request => request.resolve(result('closed'))))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(api['search:cancel']).toHaveBeenCalled()
})

// @testCase TC-CONSISTENCY
it('deduplicates repeated pages', async () => {
  const api = createFakeApi()
  const first = { ...result(), nextCursor: 'page-2' }
  api['search:universal'] = vi.fn(async request => request.cursor ? result() : first)
  render(<CommandPalette api={api} userId="alice" open onClose={() => {}} commands={[]} />)
  fireEvent.change(input(), { target: { value: 'needle' } })
  await screen.findByText('needle chats')
  fireEvent.click(screen.getByRole('button', { name: 'Загрузить ещё' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Загрузить ещё' })).toBeNull())
  expect(screen.getAllByRole('option')).toHaveLength(6)
})

// @testCase TC-UI
it('exposes empty, loading, partial, error and retry states', async () => {
  const api = createFakeApi()
  api['search:universal'] = vi.fn(async () => { throw new Error('private backend diagnostic') })
  render(<CommandPalette api={api} userId="alice" open onClose={() => {}} commands={[]} />)
  expect(screen.getByText('Поиск…')).toBeInTheDocument()
  await screen.findByRole('alert')
  expect(screen.queryByText('private backend diagnostic')).toBeNull()
  const partial = result()
  partial.groups[5] = { source: 'kb', status: 'unavailable', hits: [] }
  api['search:universal'] = vi.fn(async () => partial)
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
  await screen.findByText(/Частичная выдача/)
  api['search:universal'] = vi.fn(async () => ({ groups: SEARCH_SOURCES.map(source => ({ source, status: 'ok' as const, hits: [] })), nextCursor: null }))
  fireEvent.change(input(), { target: { value: 'no match' } })
  await screen.findByText('Ничего не найдено')
})

// @testCase TC-CONSISTENCY
it('restarts from the first page when the cursor expires', async () => {
  const api = createFakeApi()
  let initialCalls = 0
  api['search:universal'] = vi.fn(async request => {
    if (request.cursor) throw Object.assign(new Error('expired'), { status: 400 })
    initialCalls += 1
    return { ...result(), nextCursor: initialCalls === 1 ? 'expired' : null }
  })
  render(<CommandPalette api={api} userId="alice" open onClose={() => {}} commands={[]} />)
  await screen.findByText('needle chats')
  fireEvent.click(screen.getByRole('button', { name: 'Загрузить ещё' }))
  await waitFor(() => expect(initialCalls).toBe(2))
  await screen.findByText('needle chats')
  expect(screen.getAllByRole('option')).toHaveLength(6)
})

// @testCase TC-SECURITY
it('revalidates recent IDs and selection without navigating to revoked objects', async () => {
  const api = createFakeApi()
  const recent = result().groups[0]!.hits[0]!
  localStorage.setItem('vc:search:recent:alice', JSON.stringify([recent.id]))
  api['search:universal'] = vi.fn(async () => result())
  const navigate = vi.fn()
  render(<CommandPalette api={api} userId="alice" open onClose={() => {}} onNavigate={navigate} commands={[]} />)
  await screen.findByText('needle chats')
  expect(api['search:universal']).toHaveBeenCalledWith({ query: '', recent: [recent.id] })
  api['search:universal'] = vi.fn(async () => ({ groups: [], nextCursor: null }))
  fireEvent.click(screen.getByText('needle chats'))
  await screen.findByText(/Объект удалён или доступ отозван/)
  expect(navigate).not.toHaveBeenCalled()
  expect(screen.queryByText('needle chats')).toBeNull()
})

// @testCase TC-UI
it('tracks visual viewport height and offset for the software keyboard and cleans up listeners', () => {
  const viewport = new EventTarget()
  Object.assign(viewport, { height: 410, offsetTop: 18 })
  vi.stubGlobal('visualViewport', viewport)
  const view = render(<CommandPalette open onClose={() => {}} commands={[]} />)
  const dialog = screen.getByRole('dialog')
  expect(dialog.style.getPropertyValue('--cmdk-height')).toBe('410px')
  Object.assign(viewport, { height: 300, offsetTop: 24 })
  act(() => viewport.dispatchEvent(new Event('resize')))
  expect(dialog.style.getPropertyValue('--cmdk-height')).toBe('300px')
  expect(dialog.style.getPropertyValue('--cmdk-top')).toBe('24px')
  view.unmount()
  vi.unstubAllGlobals()
})


import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { useToast } from '@voicechat/ui-kit'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { render } from "@voicechat/ui-foundation/test/uiRender"
import { expectNoViolations } from '@voicechat/ui-foundation/test/a11y'
import { addNotification, readNotifications, resetPreferenceCache, userKey } from '../lib/shellPreferences'
import { NotificationCenter, NotificationHistory } from './NotificationCenter'
import { MobileNavigation } from './MobileNavigation'
import { ConnectionBanner, ConnectionStatus } from './ConnectionBanner'
import { ShellTour } from './ShellTour'
import { ShortcutSettings, shortcutsOverlap } from './ShortcutSettings'
import { useShellTheme } from '../lib/shellTheme'
import type { RendererRealtimeBridge } from '@shared/ipc'

beforeEach(() => { localStorage.clear(); resetPreferenceCache() })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

// @testCase TC3
it('retains the last 50 notifications, deduplicates events and isolates read state', () => {
  for (let i = 0; i < 51; i++) addNotification('alice', { id: String(i), text: `Event ${i}`, source: (['toast', 'run', 'release', 'invitation'] as const)[i % 4]!, kind: 'info', time: i, read: false })
  addNotification('alice', { id: '50', text: 'Repeated', source: 'run', kind: 'info', time: 51, read: false })
  expect(readNotifications('alice')).toHaveLength(50)
  expect(readNotifications('alice').some(item => item.id === '0')).toBe(false)
  const view = render(<NotificationCenter userId="alice" />)
  fireEvent.click(screen.getByRole('button', { name: 'Уведомления: 50 непрочитанных' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Прочитано' })[0]!)
  view.unmount()
  resetPreferenceCache()
  expect(readNotifications('alice')[0]!.read).toBe(true)
  expect(readNotifications('bob')).toEqual([])
  expect(JSON.parse(localStorage.getItem(userKey('alice', 'notifications'))!)).toHaveLength(50)
})

// @testCase TC3
it('keeps toast history after dismissal and recovers from damaged or unavailable storage', () => {
  localStorage.setItem(userKey('alice', 'notifications'), '{broken')
  expect(readNotifications('alice')).toEqual([])
  addNotification('alice', { id: 'toast-1', text: 'Previous session', source: 'toast', kind: 'info', time: 1, read: true })
  const listen = (event: Event): void => addNotification('alice', { ...(event as CustomEvent).detail, source: 'toast', read: false })
  window.addEventListener('vc:toast', listen)
  function Notice(): JSX.Element {
    const toast = useToast()
    return <button onClick={() => toast.info('Current session', { action: { label: 'Undo', onClick: () => {} } })}>Notify</button>
  }
  const view = render(<Notice />)
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Notify' }))
    const items = readNotifications('alice')
    expect(items.map(item => item.text)).toEqual(['Current session', 'Previous session'])
    expect(JSON.stringify(items)).not.toContain('onClick')
    expect(JSON.stringify(items)).not.toContain('Undo')
    view.unmount()
    resetPreferenceCache()
    expect(readNotifications('alice')).toHaveLength(2)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(() => addNotification('alice', { id: 'quota-event', text: 'Still usable', source: 'run', kind: 'info', time: 2, read: false })).not.toThrow()
    expect(readNotifications('alice')[0]!.text).toBe('Still usable')
  } finally { window.removeEventListener('vc:toast', listen) }
})

// @testCase TC4
it('applies system theme before paint and follows scheme changes only for system mode', () => {
  let changed: (() => void) | undefined
  const media = { matches: true, addEventListener: (_: string, cb: () => void) => { changed = cb }, removeEventListener: vi.fn() }
  vi.stubGlobal('matchMedia', vi.fn((query: string) => query.includes('prefers-color-scheme') ? media : { matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  function Theme({ mode }: { mode: 'system' | 'green' }) { const theme = useShellTheme(mode); return <span>{theme}</span> }
  const view = render(<Theme mode="system" />)
  expect(document.documentElement.dataset.theme).toBe('dark')
  act(() => { media.matches = false; changed?.() })
  expect(document.documentElement.dataset.theme).toBe('light')
  view.rerender(<Theme mode="green" />)
  act(() => { media.matches = true })
  expect(document.documentElement.dataset.theme).toBe('green')
  vi.unstubAllGlobals()
})

// @testCase TC6
it('keeps one disconnection episode and emits one recovery toast', () => {
  vi.useFakeTimers()
  let disconnected = () => {}, connected = () => {}
  const retry = vi.fn()
  const bridge = { onDisconnected: (cb: () => void) => { disconnected = cb; return () => {} }, onConnected: (cb: () => void) => { connected = cb; return () => {} }, retry } as unknown as RendererRealtimeBridge
  render(<ConnectionStatus bridge={bridge} />)
  act(() => disconnected())
  act(() => vi.advanceTimersByTime(3000))
  act(() => disconnected())
  expect(screen.getByText('0:03')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
  expect(retry).toHaveBeenCalledTimes(1)
  act(() => { connected(); connected() })
  expect(screen.queryByText('Соединение потеряно — переподключаемся…')).toBeNull()
  expect(screen.getAllByText('Соединение восстановлено')).toHaveLength(1)
})

// @testCase TC7
it('rejects overlapping shortcuts and persists all three assignments per user', () => {
  const view = render(<ShortcutSettings userId="alice" />)
  fireEvent.keyDown(screen.getByLabelText('Новая беседа'), { key: 'k', ctrlKey: true })
  expect(screen.getByRole('alert')).toHaveTextContent('Конфликт')
  for (const [label, key] of [['Палитра команд', 'p'], ['Новая беседа', 'j'], ['Отправка сообщения', 'Enter']]) {
    fireEvent.keyDown(screen.getByLabelText(label!), { key, ctrlKey: true })
  }
  expect(screen.queryByRole('alert')).toBeNull()
  expect(shortcutsOverlap('mod+k', 'ctrl+shift+k')).toBe(true)
  expect(JSON.parse(localStorage.getItem(userKey('alice', 'shortcuts'))!)).toEqual({ palette: 'mod+p', newChat: 'mod+j', send: 'mod+Enter' })
  view.rerender(<ShortcutSettings userId="bob" />)
  expect(screen.getByLabelText('Новая беседа')).not.toHaveValue('Ctrl+J')
})

// @testCase TC9
it('completes four tour steps and remembers skip separately for each user', () => {
  const navigate = vi.fn()
  const view = render(<ShellTour userId="alice" onNavigate={navigate} />)
  expect(screen.getByText('Шаг 1 из 4: Чат')).toBeInTheDocument()
  for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
  expect(screen.getByText('Шаг 4 из 4: Релизы')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Завершить' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  view.rerender(<ShellTour key="bob" userId="bob" onNavigate={navigate} />)
  fireEvent.click(screen.getByRole('button', { name: 'Пропустить' }))
  view.rerender(<ShellTour key="alice" userId="alice" onNavigate={navigate} />)
  expect(screen.queryByRole('dialog')).toBeNull()
})

// @testCase TC1
it('checks shell surfaces with axe and navigation actions', async () => {
  const navigate = vi.fn(), more = vi.fn()
  const view = render(<><NotificationHistory items={[]} onRead={() => {}} /><ConnectionBanner since={Date.now()} onRetry={() => {}} /><MobileNavigation preview active="machines" onNavigate={navigate} onMore={more} /></>)
  await expectNoViolations()
  const nav = screen.getByRole('navigation', { name: 'Основные разделы' })
  expect(within(nav).getByRole('button', { name: 'Машины' })).toHaveAttribute('aria-current', 'page')
  fireEvent.click(within(nav).getByRole('button', { name: 'Релизы' }))
  fireEvent.click(within(nav).getByRole('button', { name: 'Ещё' }))
  expect(navigate).toHaveBeenCalledWith('releases')
  expect(more).toHaveBeenCalledOnce()
  view.unmount()
})

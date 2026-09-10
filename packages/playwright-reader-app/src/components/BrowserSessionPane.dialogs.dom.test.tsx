import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { RendererBrowserBridge } from '@shared/ipc'
import type { BrowserSessionMetadata } from '@shared/types'
import type { BrowserDialogInfo } from '@shared/browserDialogs'
import { BrowserSessionPane } from './BrowserSessionPane'

const dialog = (type: BrowserDialogInfo['type'] = 'confirm'): BrowserDialogInfo => ({
  id: 'd1',
  tabId: 't1',
  type,
  message: 'Сохранить документ?',
  defaultValue: 'Черновик',
  openedAt: 1
})
const state = (dialogs: BrowserDialogInfo[] = []): BrowserSessionMetadata => ({
  id: 'c',
  conversationId: 'c',
  currentUrl: 'https://project.test/',
  title: 'Проект',
  incarnation: 'i',
  state: 'ready',
  activeTabId: 't1',
  tabs: [
    {
      id: 't1',
      url: 'https://project.test/',
      title: 'Проект',
      active: true,
      ...(dialogs.length ? { dialogId: dialogs[0].id } : {})
    }
  ],
  viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
  dialogs
})
const bridge = (initial = state()): RendererBrowserBridge => ({
  start: vi.fn(async () => initial),
  command: vi.fn(async () => state()),
  screenshot: vi.fn(async () => ({ dataUrl: 'data:image/jpeg;base64,initial' })),
  stop: vi.fn(async () => {})
})
const mount = async (browser: RendererBrowserBridge) => {
  vi.useFakeTimers()
  await act(async () => {
    render(<BrowserSessionPane conversationId="c" browser={browser} />)
  })
}
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it('стартовый диалог показывается без зависшего запроса кадра; ответ возобновляет кадры', async () => {
  const browser = bridge(state([dialog('alert')]))
  await mount(browser)
  expect(screen.getByRole('dialog')).toHaveTextContent('Сохранить документ?')
  expect(browser.screenshot).not.toHaveBeenCalled()
  expect(screen.getByText('Страница ожидает ответа')).toBeVisible()
  await act(async () => {
    fireEvent.click(within(screen.getByRole('dialog')).getByText('ОК'))
  })
  expect(browser.command).toHaveBeenCalledWith(
    'c',
    expect.objectContaining({ command: { type: 'handleDialog', dialogId: 'd1', accept: true } })
  )
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(browser.screenshot).toHaveBeenCalledTimes(1)
})

it('фоновый status находит диалог модели и продолжает опрашиваться без кадров', async () => {
  const browser = bridge()
  await mount(browser)
  vi.mocked(browser.command).mockResolvedValue(state([dialog()]))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4800)
  })
  expect(screen.getByRole('dialog')).toBeVisible()
  expect(browser.screenshot).toHaveBeenCalledTimes(1)
  expect(browser.command).toHaveBeenCalledTimes(4)
  expect(screen.queryByText(/Кадр не обновляется/)).toBeNull()
  expect(screen.getByRole('tab', { name: 'Проект — ожидает ответа' })).toBeVisible()
  fireEvent.click(screen.getByAltText('Кадр Chromium'))
  expect(vi.mocked(browser.command).mock.calls.every(([, request]) => request.command.type === 'status')).toBe(true)
})

it.each([undefined, '', 'Новое имя'])('prompt отправляет исходный, пустой или изменённый ответ: %s', async (text) => {
  const browser = bridge(state([dialog('prompt')]))
  await mount(browser)
  expect(screen.getByLabelText('Ответ сайту')).toHaveValue('Черновик')
  if (text !== undefined) fireEvent.change(screen.getByLabelText('Ответ сайту'), { target: { value: text } })
  await act(async () => {
    fireEvent.click(within(screen.getByRole('dialog')).getByText('ОК'))
  })
  expect(browser.command).toHaveBeenCalledWith(
    'c',
    expect.objectContaining({
      command: {
        type: 'handleDialog',
        dialogId: 'd1',
        accept: true,
        ...(text !== undefined ? { promptText: text } : {})
      }
    })
  )
})

it.each(['confirm', 'prompt', 'beforeunload'] as const)('отмена %s — явный false без текста prompt', async (type) => {
  const browser = bridge(state([dialog(type)]))
  await mount(browser)
  await act(async () => {
    fireEvent.click(within(screen.getByRole('dialog')).getByText(type === 'beforeunload' ? 'Остаться' : 'Отмена'))
  })
  expect(browser.command).toHaveBeenCalledWith(
    'c',
    expect.objectContaining({ command: { type: 'handleDialog', dialogId: 'd1', accept: false } })
  )
})

it('отказ ответа оставляет диалог и показывает причину', async () => {
  const browser = bridge(state([dialog()]))
  vi.mocked(browser.command).mockRejectedValue(new Error('Связь потеряна'))
  await mount(browser)
  await act(async () => {
    fireEvent.click(within(screen.getByRole('dialog')).getByText('ОК'))
  })
  expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('Связь потеряна')
  expect(within(screen.getByRole('dialog')).getByText('ОК')).not.toBeDisabled()
})

it('диалог другой вкладки не закрывает активный кадр', async () => {
  const initial = state([{ ...dialog(), tabId: 't2' }])
  initial.tabs = [
    { id: 't1', url: '', title: 'Проект', active: true },
    { id: 't2', url: '', title: 'Почта', active: false, dialogId: 'd1' }
  ]
  const browser = bridge(initial)
  await mount(browser)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(browser.screenshot).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('tab', { name: 'Почта — ожидает ответа' })).toBeVisible()
})

it('общий ready старого раннера не скрывает диалог после неподтверждённого ответа', async () => {
  const browser = bridge(state([dialog()]))
  const old = state(); delete old.dialogs
  vi.mocked(browser.command).mockResolvedValue(old)
  await mount(browser)
  await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByText('ОК')) })
  expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('не подтвердил ответ')
})

it('после ручного ответа поллинг находит следующий диалог', async () => {
  const browser = bridge(state([dialog('alert')]))
  await mount(browser)
  await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByText('ОК')) })
  vi.mocked(browser.command).mockResolvedValue(state([{ ...dialog('prompt'), id: 'd2' }]))
  await act(async () => { await vi.advanceTimersByTimeAsync(4800) })
  expect(screen.getByLabelText('Ответ сайту')).toBeVisible()
})

it('долгий ручной ответ не останавливает поллинг следующего диалога', async () => {
  const browser = bridge(state([dialog('alert')]))
  let finish!: (meta: BrowserSessionMetadata) => void
  vi.mocked(browser.command).mockImplementation(async (_id, request) => request.command.type === 'handleDialog' ? new Promise(resolve => { finish = resolve }) : state([dialog('alert')]))
  await mount(browser)
  await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByText('ОК')) })
  await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  await act(async () => { finish(state()) })
  vi.mocked(browser.command).mockResolvedValue(state([{ ...dialog('prompt'), id: 'd2' }]))
  await act(async () => { await vi.advanceTimersByTimeAsync(2400) })
  expect(screen.getByLabelText('Ответ сайту')).toBeVisible()
})

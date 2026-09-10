import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { BrowserSessionPane } from '@voicechat/playwright-reader-app/components/BrowserSessionPane'
import type { RendererBrowserBridge } from '@shared/ipc'
const meta = {
  id: 'c',
  conversationId: 'c',
  incarnation: 'i',
  state: 'ready' as const,
  activeTabId: 't',
  tabs: [],
  viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
  currentUrl: 'https://a.b',
  title: null
}
const setup = async (over: Partial<RendererBrowserBridge> = {}) => {
  const browser = {
    start: vi.fn(async () => meta),
    command: vi.fn(async () => meta),
    screenshot: vi.fn(async () => ({ dataUrl: 'data:image/jpeg;base64,QQ==' })),
    stop: vi.fn(async () => {}),
    ...over
  }
  render(<BrowserSessionPane conversationId="c" browser={browser} />)
  const frame = await screen.findByAltText('Кадр Chromium')
  frame.getBoundingClientRect = () => ({
    left: 10,
    top: 20,
    width: 640,
    height: 400,
    right: 650,
    bottom: 420,
    x: 10,
    y: 20,
    toJSON: () => ({})
  })
  return { browser, frame }
}
afterEach(cleanup)
it('колесо несёт позицию курсора и единицы line', async () => {
  const { browser, frame } = await setup()
  fireEvent.wheel(frame, { clientX: 210, clientY: 120, deltaX: 2, deltaY: 3, deltaMode: 1 })
  await waitFor(() =>
    expect(browser.command).toHaveBeenCalledWith(
      'c',
      expect.objectContaining({
        command: { type: 'input', action: { type: 'wheel', x: 400, y: 200, deltaX: 32, deltaY: 48 } }
      })
    )
  )
})
it('Shift-клик сохраняет модификатор', async () => {
  const { browser, frame } = await setup()
  fireEvent.click(frame, { clientX: 210, clientY: 120, shiftKey: true })
  await waitFor(() =>
    expect(browser.command).toHaveBeenCalledWith(
      'c',
      expect.objectContaining({
        command: expect.objectContaining({ type: 'input', action: expect.objectContaining({ modifiers: ['Shift'] }) })
      })
    )
  )
})
it('doubleclick DOM не создаёт четвёртый физический click', async () => {
  const { browser, frame } = await setup()
  fireEvent.click(frame, { detail: 1, clientX: 210, clientY: 120 })
  fireEvent.click(frame, { detail: 2, clientX: 210, clientY: 120 })
  fireEvent.doubleClick(frame, { detail: 2, clientX: 210, clientY: 120 })
  await waitFor(() => expect(browser.command).toHaveBeenCalledTimes(2))
  expect((browser.command as ReturnType<typeof vi.fn>).mock.calls[1][1].command.action).toMatchObject({ detail: 2 })
})
it('кадр передаёт primary select-all и Shift+Tab', async () => {
  const { browser, frame } = await setup()
  fireEvent.keyDown(frame, { key: 'a', ctrlKey: true })
  fireEvent.keyDown(frame, { key: 'Tab', shiftKey: true })
  await waitFor(() => expect(browser.command).toHaveBeenCalledTimes(2))
  const actions = (browser.command as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[1].command.action)
  expect(actions).toEqual([
    { type: 'press', key: 'ControlOrMeta+a' },
    { type: 'press', key: 'Shift+Tab' }
  ])
})
it('paste передаёт текст из реального события', async () => {
  const { browser, frame } = await setup()
  fireEvent.paste(frame, { clipboardData: { getData: () => 'Письмо\n😀' } })
  await waitFor(() =>
    expect(browser.command).toHaveBeenCalledWith(
      'c',
      expect.objectContaining({ command: { type: 'input', action: { type: 'type', text: 'Письмо\n😀' } } })
    )
  )
})
it('ошибка ввода оставляет черновик', async () => {
  const command = vi.fn(async () => {
    throw new Error('offline')
  })
  await setup({ command: command as never })
  const field = screen.getByPlaceholderText('Текст в активное поле')
  fireEvent.change(field, { target: { value: 'черновик' } })
  fireEvent.click(screen.getByRole('button', { name: 'Ввести' }))
  await screen.findByText('offline')
  expect(field).toHaveValue('черновик')
})
it('новое продолжение сохраняется после ответа старого ввода', async () => {
  let release!: (v: typeof meta) => void
  const command = vi.fn(() => new Promise<typeof meta>((r) => (release = r)))
  await setup({ command })
  const field = screen.getByPlaceholderText('Текст в активное поле')
  fireEvent.change(field, { target: { value: 'abc' } })
  fireEvent.click(screen.getByRole('button', { name: 'Ввести' }))
  await waitFor(() => expect(command).toHaveBeenCalledTimes(1))
  fireEvent.change(field, { target: { value: 'abcXYZ' } })
  await act(async () => release(meta))
  expect(field).toHaveValue('XYZ')
})
it('быстрый ввод ждёт предыдущую команду', async () => {
  let release!: (v: typeof meta) => void
  const command = vi
    .fn()
    .mockImplementationOnce(() => new Promise<typeof meta>((r) => (release = r)))
    .mockResolvedValue(meta)
  const { frame } = await setup({ command })
  fireEvent.keyDown(frame, { key: 'a' })
  fireEvent.keyDown(frame, { key: 'b' })
  await waitFor(() => expect(command).toHaveBeenCalledTimes(1))
  await act(async () => release(meta))
  await waitFor(() => expect(command).toHaveBeenCalledTimes(2))
  expect(command.mock.calls.map((call) => call[1].command.action.text)).toEqual(['a', 'b'])
})

// Фоновое наблюдение должно показывать работу модели, сохраняя незавершённый
// ввод человека. Таймеры управляемые: проверяем интервалы, а не скорость машины.
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { RendererBrowserBridge } from '@shared/ipc'
import type { BrowserSessionMetadata } from '@shared/types'
import { BrowserSessionPane } from './BrowserSessionPane'

const state = (over: Partial<BrowserSessionMetadata> = {}): BrowserSessionMetadata => ({
  id: 'c1', conversationId: 'c1', incarnation: 'inc1', state: 'ready', activeTabId: 'tab1',
  tabs: [{ id: 'tab1', url: 'https://project.test/', title: 'Проект', active: true }],
  viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
  currentUrl: 'https://project.test/', title: 'Проект', ...over
})
const frame = (name: string) => ({ dataUrl: `data:image/jpeg;base64,${name}` })
const bridge = (over: Partial<RendererBrowserBridge> = {}): RendererBrowserBridge => ({
  start: vi.fn(async () => state()), command: vi.fn(async () => state()),
  screenshot: vi.fn(async () => frame('initial')), stop: vi.fn(async () => {}), ...over
})
async function mount(browser: RendererBrowserBridge) {
  vi.useFakeTimers()
  let view!: ReturnType<typeof render>
  await act(async () => { view = render(<BrowserSessionPane conversationId="c1" browser={browser} />) })
  expect(screen.getByAltText('Кадр Chromium')).toBeVisible()
  return view
}
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
afterEach(() => { cleanup(); vi.useRealTimers() })

it('получает адрес, заголовок, вкладки и автора действий модели без ручной команды', async () => {
  const next = state({ currentUrl: 'https://project.test/#/make', title: 'Мастерская', lastActor: 'assistant',
    tabs: [{ id: 'tab1', url: 'https://project.test/#/make', title: 'Мастерская', active: true }, { id: 'tab2', url: 'https://project.test/help', title: 'Помощь', active: false }] })
  const browser = bridge({ command: vi.fn(async () => next) })
  await mount(browser)
  await tick(1200)
  expect(browser.command).toHaveBeenCalledWith('c1', expect.objectContaining({ command: { type: 'status' } }))
  expect(screen.getByLabelText('Адрес страницы')).toHaveValue(next.currentUrl)
  expect(screen.getByRole('tab', { name: 'Помощь' })).toBeVisible()
  expect(screen.getByText('последнее действие — модели')).toBeVisible()
})

it('пустая стартовая вкладка не вызывает ложную смену сайта и не попадает в историю', async () => {
  const browser = bridge({ start: vi.fn(async () => state({ currentUrl: 'about:blank' })) })
  await mount(browser)
  fireEvent.change(screen.getByLabelText('Адрес страницы'), { target: { value: 'https://project.test/' } })
  await act(async () => { fireEvent.click(screen.getByText('Открыть')) })
  expect(screen.queryByText(/ушла с проверяемого сайта/)).toBeNull()
  expect(screen.queryByRole('option', { name: 'about:blank' })).toBeNull()
})

it('не затирает черновик адреса кадром модели; Escape возвращает текущий адрес', async () => {
  await mount(bridge({ command: vi.fn(async () => state({ currentUrl: 'https://project.test/new' })) }))
  const address = screen.getByLabelText('Адрес страницы')
  fireEvent.change(address, { target: { value: 'https://draft.test/' } })
  await tick(1200)
  expect(address).toHaveValue('https://draft.test/')
  fireEvent.keyDown(address, { key: 'Escape' })
  expect(address).toHaveValue('https://project.test/new')
})

it('не запускает второй снимок пока первый ещё выполняется', async () => {
  let finish!: (value: { dataUrl: string }) => void
  const screenshot = vi.fn().mockResolvedValueOnce(frame('initial')).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await mount(bridge({ screenshot }))
  await tick(1200)
  await tick(6000)
  expect(screenshot).toHaveBeenCalledTimes(2)
  await act(async () => { finish(frame('next')) })
  expect(screen.getByAltText('Кадр Chromium')).toHaveAttribute('src', frame('next').dataUrl)
})

it('старый кадр не заменяет экран после новой команды', async () => {
  let finish!: (value: { dataUrl: string }) => void
  const screenshot = vi.fn().mockResolvedValueOnce(frame('initial')).mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue(frame('fresh'))
  await mount(bridge({ screenshot }))
  await tick(1200)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Обновить' })) })
  await act(async () => { finish(frame('stale')) })
  expect(screen.getByAltText('Кадр Chromium')).not.toHaveAttribute('src', frame('stale').dataUrl)
  await tick(1200)
  expect(screen.getByAltText('Кадр Chromium')).toHaveAttribute('src', frame('fresh').dataUrl)
})

it('возвращается с интервала 400 мс к 1200 мс через четыре секунды после действия', async () => {
  const browser = bridge()
  await mount(browser)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Обновить' })) })
  const polls = () => vi.mocked(browser.command).mock.calls.filter(([, request]) => request.command.type === 'status').length
  await tick(4000)
  expect(polls()).toBe(10)
  await tick(1199)
  expect(polls()).toBe(10)
  await tick(1)
  expect(polls()).toBe(11)
})

it('показывает серию сбоев кадров и убирает предупреждение после восстановления', async () => {
  const screenshot = vi.fn().mockResolvedValueOnce(frame('initial')).mockRejectedValue(new Error('сеть недоступна'))
  await mount(bridge({ screenshot }))
  await tick(3600)
  expect(screen.getByText(/Кадр не обновляется/)).toBeVisible()
  screenshot.mockResolvedValue(frame('recovered'))
  await tick(1200)
  expect(screen.queryByText(/Кадр не обновляется/)).toBeNull()
  expect(screen.getByAltText('Кадр Chromium')).toHaveAttribute('src', frame('recovered').dataUrl)
})

it('смена разговора сбрасывает запись, черновики, историю и выбранный размер', async () => {
  const browser = bridge({ start: vi.fn(async id => state({ conversationId: id, currentUrl: `https://${id}.test/` })) })
  const view = await mount(browser)
  fireEvent.click(screen.getByText('Записать сценарий'))
  fireEvent.change(screen.getByLabelText('Адрес страницы'), { target: { value: 'https://draft.test/' } })
  await act(async () => { fireEvent.click(screen.getByText('Телефон')) })
  await act(async () => { view.rerender(<BrowserSessionPane conversationId="c2" browser={browser} />) })
  expect(screen.getByLabelText('Адрес страницы')).toHaveValue('https://c2.test/')
  expect(screen.getByText('Записать сценарий')).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByText('Десктоп')).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByRole('option', { name: 'https://c1.test/' })).toBeNull()
  expect(browser.stop).toHaveBeenCalledWith('c1')
})

it('отказ остановки не выдаётся за успешный перезапуск; повтор доступен', async () => {
  const stop = vi.fn().mockRejectedValueOnce(new Error('Не удалось остановить сессию')).mockResolvedValue(undefined)
  const browser = bridge({ stop })
  await mount(browser)
  await act(async () => { fireEvent.click(screen.getByText('Перезапустить')) })
  expect(browser.start).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('alert')).toHaveTextContent('Не удалось остановить сессию')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Повторить запуск' })) })
  expect(browser.start).toHaveBeenCalledTimes(2)
  expect(screen.getByAltText('Кадр Chromium')).toBeVisible()
})

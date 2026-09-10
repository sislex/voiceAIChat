import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { RendererBrowserBridge } from '@shared/ipc'
import type { BrowserSessionMetadata } from '@shared/types'
import { BrowserSessionPane } from './BrowserSessionPane'
const meta = (tab = 't'): BrowserSessionMetadata => ({
  id: 'c',
  conversationId: 'c',
  incarnation: 'i',
  state: 'ready',
  activeTabId: tab,
  tabs: [{ id: tab, url: 'https://site.test/', title: 'Site', active: true }],
  viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
  currentUrl: 'https://site.test/',
  title: 'Site'
})
const bridge = (): RendererBrowserBridge => ({
  start: vi.fn(async () => meta()),
  command: vi.fn(async () => meta()),
  screenshot: vi.fn(async () => ({ dataUrl: 'data:image/jpeg;base64,x' })),
  stop: vi.fn(async () => {})
})
const mount = async (browser: RendererBrowserBridge) => {
  vi.useFakeTimers()
  await act(async () => {
    render(<BrowserSessionPane conversationId="c" browser={browser} />)
  })
}
const open = async () => {
  await act(async () => {
    fireEvent.click(screen.getByText('Ошибки страницы'))
  })
}
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
it.each(['error', 'ready', 'throw'])('сбой чтения %s не выдаётся за отсутствие ошибок', async (mode) => {
  const browser = bridge()
  vi.mocked(browser.command).mockImplementation(async () => {
    if (mode === 'throw') throw new Error('Логи временно недоступны')
    return mode === 'ready' ? meta() : { ok: false, error: 'Логи временно недоступны' }
  })
  await mount(browser)
  await open()
  expect(screen.queryByText('Страница не жаловалась.')).toBeNull()
  expect(screen.getByRole('alert').textContent).toContain('Диагностика недоступна')
})
it('повторное чтение восстанавливает честный пустой журнал и задаёт вкладку', async () => {
  const browser = bridge()
  vi.mocked(browser.command).mockResolvedValue({ ok: false, error: 'Offline' })
  await mount(browser)
  await open()
  vi.mocked(browser.command).mockImplementation(async (_, request) =>
    request.command.type === 'inspect' ? { ok: true, console: [], network: [] } : meta()
  )
  await act(async () => {
    fireEvent.click(screen.getByLabelText('Обновить диагностику'))
  })
  expect(screen.getByText('Страница не жаловалась.')).toBeTruthy()
  expect(browser.command).toHaveBeenCalledWith(
    'c',
    expect.objectContaining({
      command: { type: 'inspect', action: { kind: 'network', failedOnly: true, limit: 50, tabId: 't' } }
    })
  )
})
it('показывает сетевой сбой и источник исключения, но не pending', async () => {
  const browser = bridge()
  vi.mocked(browser.command).mockResolvedValue({
    ok: true,
    console: [
      { level: 'error', text: 'Error marker', at: 1, source: { url: 'https://site.test/app.js', line: 8, column: 2 } }
    ],
    network: [
      {
        method: 'GET',
        url: 'https://site.test/broken',
        status: 0,
        ok: false,
        at: 1,
        state: 'failed',
        error: 'ERR_FAILED'
      },
      { method: 'GET', url: 'https://site.test/pending', status: 0, ok: false, at: 1, state: 'pending' }
    ],
    truncated: true
  })
  await mount(browser)
  await open()
  expect(screen.getByText(/ERR_FAILED/)).toBeTruthy()
  expect(screen.getByText(/app.js:8/)).toBeTruthy()
  expect(screen.queryByText(/site.test\/pending/)).toBeNull()
  expect(screen.getByText(/Показана часть журнала/)).toBeTruthy()
})
it('поздний ответ старой вкладки не появляется после переключения модели', async () => {
  const browser = bridge()
  let resolve!: (value: any) => void
  const pending = new Promise<any>((done) => {
    resolve = done
  })
  vi.mocked(browser.command).mockImplementation(async (_, request) =>
    request.command.type === 'inspect' ? pending : meta('other')
  )
  await mount(browser)
  await open()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500)
  })
  await act(async () => {
    resolve({ ok: true, console: [], network: [] })
  })
  expect(screen.queryByRole('region', { name: 'Диагностика страницы' })).toBeNull()
})
it('скрытая панель не открывается поздним ответом', async () => {
  const browser = bridge()
  let resolve!: (value: any) => void
  const pending = new Promise<any>((done) => {
    resolve = done
  })
  vi.mocked(browser.command).mockImplementation(() => pending)
  await mount(browser)
  await open()
  await act(async () => {
    fireEvent.click(screen.getByLabelText('Скрыть диагностику'))
  })
  await act(async () => {
    resolve({ ok: true, console: [], network: [] })
  })
  expect(screen.queryByRole('region', { name: 'Диагностика страницы' })).toBeNull()
})

it('длинные сообщения свёрнуты, свежая ошибка видна раньше старой', async () => {
  const browser = bridge()
  vi.mocked(browser.command).mockResolvedValue({
    ok: true,
    console: [
      { level: 'error', text: 'Old' + 'x'.repeat(1000), at: 1 },
      { level: 'error', text: 'Latest error', at: 2 }
    ],
    network: []
  })
  await mount(browser)
  await open()
  const rows = screen.getByRole('region', { name: 'Диагностика страницы' }).querySelectorAll('li')
  expect(rows[0].textContent).toBe('Latest error')
  expect(rows[1].querySelector('details')?.open).toBe(false)
  expect(rows[1].querySelector('summary')!.textContent!.length).toBeLessThan(250)
  expect(rows[1].querySelector('pre')!.textContent).toBe('Old' + 'x'.repeat(1000))
})

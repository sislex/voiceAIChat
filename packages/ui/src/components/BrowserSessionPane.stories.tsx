import type { Meta, StoryObj } from '@storybook/react'
import { BrowserSessionPane } from './BrowserSessionPane'
import type { RendererBrowserBridge } from '@shared/ipc'
import type { BrowserSessionMetadata } from '@shared/types'

// Состояния панели достижимы только ответом моста, поэтому витрина держит их
// фейками: запуск, готовая сессия, недоступный Chromium и ошибка команды.
const meta = (over: Partial<BrowserSessionMetadata> = {}): BrowserSessionMetadata => ({
  id: 'c1', conversationId: 'c1', incarnation: 'inc-1', state: 'ready', activeTabId: 't1', tabs: [],
  viewport: { width: 1280, height: 800, deviceScaleFactor: 1 }, currentUrl: 'https://example.com', title: null, ...over
})

/**
 * Однотонный кадр: витрина не ходит в сеть и не поднимает Chromium.
 * Кодируем через encodeURIComponent, а не btoa — тот не принимает кириллицу.
 */
const FRAME = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><rect width="1280" height="800" fill="#e9e7dd"/>' +
  '<text x="60" y="120" font-family="sans-serif" font-size="48" fill="#4a4a44">Страница в Chromium</text></svg>'
)

const bridge = (over: Partial<RendererBrowserBridge> = {}): RendererBrowserBridge => ({
  start: async () => meta(),
  command: async () => meta(),
  screenshot: async () => ({ dataUrl: FRAME }),
  stop: async () => {},
  ...over
})

const config: Meta<typeof BrowserSessionPane> = {
  title: 'Reader/BrowserSessionPane',
  component: BrowserSessionPane,
  parameters: { layout: 'fullscreen' },
  args: { conversationId: 'c1', browser: bridge(), onAttachFrame: () => {} },
  decorators: [(Story) => <div style={{ height: '90vh', display: 'flex' }}><Story /></div>]
}
export default config
type Story = StoryObj<typeof BrowserSessionPane>

export const Ready: Story = {}

/** Старт длится, пока мост не ответил: кадра ещё нет. */
export const Starting: Story = {
  args: { browser: bridge({ start: () => new Promise(() => {}) }) }
}

/** Раннер не настроен — это недоступность, а не сбой: объясняем, а не пугаем. */
export const ChromiumUnavailable: Story = {
  args: { browser: bridge({ start: async () => { throw new Error('Браузерный раннер не настроен') } }) }
}

export const CommandFailed: Story = {
  args: { browser: bridge({ command: async () => { throw new Error('Страница не ответила за 30 секунд') } }) }
}

/** Мост не подключён вовсе: панель обязана объяснить это словами. */
export const NoBridge: Story = { args: { browser: undefined } }

export const MobileViewport: Story = { parameters: { viewport: { defaultViewport: 'mobile2' } } }

/** Вкладок больше одной: состояние достижимо только ответом моста. */
export const ManyTabs: Story = {
  args: {
    browser: bridge({
      start: async () => meta({
        title: 'Пример страницы',
        activeTabId: 't1',
        tabs: [
          { id: 't1', url: 'https://example.com', title: 'Пример страницы', active: true },
          { id: 't2', url: 'https://example.com/docs', title: 'Документация', active: false },
          { id: 't3', url: 'https://example.com/very/long/path', title: 'Очень длинный заголовок вкладки', active: false }
        ]
      })
    })
  }
}

/** Повторяемая ошибка: у BrowserError есть retryable, и он даёт кнопку. */
export const RetryableError: Story = {
  args: {
    browser: bridge({
      command: async () => { throw Object.assign(new Error('Страница не ответила за 30 секунд'), { retryable: true, code: 'timeout' }) }
    })
  },
  play: async ({ canvasElement }) => {
    const reload = canvasElement.querySelector('[aria-label="Обновить"]') as HTMLButtonElement | null
    reload?.click()
  }
}

/**
 * Диагностика страницы: ошибки консоли и неуспешные запросы. Состояние
 * достижимо только ответом раннера, поэтому живёт в витрине — до круга 11
 * показать эти журналы было негде вовсе.
 */
export const PageDiagnostics: Story = {
  args: {
    browser: bridge({
      command: (async (_id: string, req: { command: { type: string; action?: { kind?: string } } }) => {
        if (req.command.type !== 'inspect') return meta()
        return req.command.action?.kind === 'console'
          ? { ok: true, console: [
              { level: 'error', text: 'TypeError: Cannot read properties of undefined (reading «columns»)', at: 1 },
              { level: 'error', text: 'Refused to connect to ws://89.125.68.35:8787/ws', at: 2 }
            ] }
          : { ok: true, network: [
              { method: 'GET', url: 'http://89.125.68.35:8787/api/projects/p1/board', status: 500, ok: false, at: 3 },
              { method: 'GET', url: 'http://89.125.68.35:8787/assets/app.js', status: 200, ok: true, at: 4 }
            ] }
      }) as never
    })
  },
  play: async ({ canvasElement }) => {
    const button = [...canvasElement.querySelectorAll('button')].find((el) => el.textContent === 'Ошибки страницы')
    button?.click()
  }
}

/** Страница без единой жалобы — отдельное состояние, а не пустой блок. */
export const PageDiagnosticsClean: Story = {
  args: { browser: bridge({ command: (async (_id: string, req: { command: { type: string } }) => (req.command.type === 'inspect' ? { ok: true, console: [], network: [] } : meta())) as never }) },
  play: async ({ canvasElement }) => {
    const button = [...canvasElement.querySelectorAll('button')].find((el) => el.textContent === 'Ошибки страницы')
    button?.click()
  }
}

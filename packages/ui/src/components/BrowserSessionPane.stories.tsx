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

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

/**
 * Запись сценария автотеста: человек проходит путь руками, а на выходе —
 * воспроизводимые селекторные шаги. Состояние достижимо только кликами по
 * кадру, поэтому набирается play-функцией.
 */
export const ScenarioRecording: Story = {
  args: {
    browser: bridge({
      start: async () => meta({ currentUrl: 'http://89.125.68.35:8787/#/projects/p1' }),
      command: (async (_id: string, req: { command: { type: string; action?: { kind?: string; x?: number } } }) => {
        if (req.command.type !== 'selector' || req.command.action?.kind !== 'describe') return meta({ currentUrl: 'http://89.125.68.35:8787/#/projects/p1' })
        // Второй клик попадает по узлу без опознавательных знаков — так видно
        // предупреждение о ненадёжном селекторе.
        return (req.command.action.x ?? 0) > 300
          ? { ok: true, element: { selector: 'div > span:nth-of-type(2)', stability: 'path', tag: 'span', text: 'Задача №4', rect: { x: 320, y: 200, width: 180, height: 24 } } }
          : { ok: true, element: { selector: '[data-testid="create-task"]', stability: 'testid', tag: 'button', text: 'Создать задачу', rect: { x: 40, y: 60, width: 160, height: 36 } } }
      }) as never
    })
  },
  play: async ({ canvasElement }) => {
    const buttons = [...canvasElement.querySelectorAll('button')]
    buttons.find((el) => el.textContent === 'Записать сценарий')?.click()
    await new Promise((done) => setTimeout(done, 60))
    const frame = canvasElement.querySelector('img')
    if (!frame) return
    Object.defineProperty(frame, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 1280, height: 800 }) })
    for (const x of [80, 400]) {
      frame.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: 70 }))
      await new Promise((done) => setTimeout(done, 80))
    }
  }
}

/**
 * Где мы находимся: адрес подменён алиасом раннера, страница ушла с
 * проверяемого сайта, есть история и тестовые учётки проекта. Состояния
 * приходят ответом моста, поэтому живут в витрине.
 */
/**
 * Уход с проверяемого сайта на стенде с алиасом (круг 26). Раньше подмену
 * вычисляли по расхождению хостов, поэтому любой чужой адрес объявлялся
 * «подменой алиасом», и предупреждение не показывалось никогда.
 */
export const StrayedFromAliasedStand: Story = {
  args: {
    browser: bridge({
      start: async () => meta({ currentUrl: 'http://89.125.68.35:8787/', aliasedHost: 'voicechat:8787', title: 'Голос·Чат' }),
      command: async () => meta({ currentUrl: 'https://accounts.google.com/', title: 'Вход' })
    })
  },
  play: async ({ canvasElement }) => {
    const address = canvasElement.querySelector('input[type=url]') as HTMLInputElement | null
    if (!address) return
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(address, 'https://accounts.google.com/')
    address.dispatchEvent(new Event('input', { bubbles: true }))
    address.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  }
}

export const WhereAmI: Story = {
  args: {
    testUsers: [{ name: 'tester', password: 'secret', role: 'user' }, { name: 'admin', password: 'secret', role: 'admin' }],
    browser: bridge({
      // Адрес наружу — тот, который назвал человек; подмену раннер сообщает
      // полем aliasedHost (круг 26): внутреннее имя в сценарий попадать не должно.
      start: async () => meta({ currentUrl: 'http://89.125.68.35:8787/', aliasedHost: 'voicechat:8787', lastActor: 'assistant', title: 'Голос·Чат' }),
      command: async () => meta({ currentUrl: 'http://89.125.68.35:8787/#/projects', aliasedHost: 'voicechat:8787', lastActor: 'user', title: 'Голос·Чат' })
    })
  },
  play: async ({ canvasElement }) => {
    const address = canvasElement.querySelector('input[type=url]') as HTMLInputElement | null
    if (!address) return
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(address, 'http://89.125.68.35:8787/')
    address.dispatchEvent(new Event('input', { bubbles: true }))
    address.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  }
}

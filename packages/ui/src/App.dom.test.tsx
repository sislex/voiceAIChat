import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { expectLabelledIconButtons, expectNoViolations } from './test/a11y'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { createFakeApi, type FakeApi } from './test/fakeApi'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { PreviewAction } from '@shared/previewActions'
import { WEB_RECORDER_MESSAGE_TYPE } from '@shared/webRecorder'

// Большие задержки пайплайна: асинхронные этапы не срабатывают за время теста,
// а таймеры гасятся при размонтировании (dispose). Проверяем синхронные переходы
// UI; полный тайминг пайплайна покрыт в store/voiceStore.test.ts.
const SLOW = { frame: 100_000, transcribe: 100_000, think: 100_000, speak: 100_000 }

/** Фейк api с двумя разговорами; «Поездка в Лиссабон» — самый свежий (активный). */
async function seededApi(): Promise<FakeApi> {
  const api = createFakeApi([])
  // По умолчанию считаем пользователя «вернувшимся» — иначе мастер онбординга
  // перекрывает интерфейс во всех тестах. Онбординг проверяется отдельно.
  await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
  await api['conversations:create']({ title: 'Идеи для подарка' })
  const lisbon = await api['conversations:create']({ title: 'Поездка в Лиссабон' })
  await api['messages:add']({
    conversationId: lisbon.id,
    role: 'u1',
    text: 'Какая сегодня погода обычно бывает в Лиссабоне в июле?',
    time: '14:02'
  })
  await api['messages:add']({
    conversationId: lisbon.id,
    role: 'ai',
    text: 'В июле в Лиссабоне обычно солнечно и тепло.',
    time: '14:02'
  })
  return api
}

async function renderApp(): Promise<FakeApi> {
  const api = await seededApi()
  render(<App api={api} delays={SLOW} />)
  // Ждём завершения init (загрузка разговоров из api). Таймаут с запасом —
  // при параллельном прогоне с интеграционными тестами CPU занят.
  await screen.findByText('Поездка в Лиссабон', {}, { timeout: 10_000 })
  return api
}

function setChatViewport(mobile: boolean): () => void {
  const original = window.matchMedia
  window.matchMedia = ((query: string) => ({
    matches: query === '(max-width: 768px)' ? mobile : false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true
  })) as typeof window.matchMedia
  return () => { window.matchMedia = original }
}

/** Открыть настройки и перейти в раздел меню (Агент — по умолчанию). */
describe('App — версия релиза', () => {
  it('сохраняет номер версии и показывает коммит с задачей в подсказке', async () => {
    await renderApp()

    const version = await screen.findByLabelText(/Версия 0\.1\.0/)
    expect(version).toHaveTextContent('v0.1.0')
    expect(version).toHaveAttribute('title', expect.stringContaining('Коммит: 7492fde'))
    expect(version).toHaveAttribute('title', expect.stringContaining('Задача: chat-149'))
  })

  it('скрывает версию, когда release-метаданные не переданы', async () => {
    const api = await seededApi()
    api['app:ping'] = async () => ({
      ok: true,
      version: null,
      releasedAt: '2026-08-03T00:00:00.000Z',
      commit: null,
      task: null
    })
    render(<App api={api} delays={SLOW} />)

    await screen.findByText('Поездка в Лиссабон')
    expect(screen.queryByLabelText(/Версия/)).not.toBeInTheDocument()
  })

  it('не добавляет задачу в подсказку, когда она не определена', async () => {
    const api = await seededApi()
    api['app:ping'] = async () => ({
      ok: true,
      version: '0.1.0',
      releasedAt: '2026-08-03T00:00:00.000Z',
      commit: 'a1858af',
      task: null
    })
    render(<App api={api} delays={SLOW} />)

    const version = await screen.findByLabelText(/Версия 0\.1\.0/)
    expect(version).toHaveAttribute('title', expect.stringContaining('Коммит: a1858af'))
    expect(version.getAttribute('title')).not.toContain('Задача:')
  })
})

async function openSettings(section?: string): Promise<void> {
  await userEvent.click(screen.getByText('Настройки'))
  if (section) await userEvent.click(screen.getByRole('button', { name: section }))
}

describe('App — онбординг первого запуска', () => {
  it('показывается при onboarded=false и скрывается после «Начать»', async () => {
    const api = createFakeApi([])
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: false })
    render(<App api={api} delays={SLOW} />)

    const dialog = await screen.findByRole('dialog', { name: 'Добро пожаловать' })
    expect(dialog).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Начать/ }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Добро пожаловать' })).not.toBeInTheDocument()
    )
    expect(api._state.settings.onboarded).toBe(true)
  })

  it('не показывается для вернувшегося пользователя', async () => {
    await renderApp() // seededApi ставит onboarded=true
    expect(screen.queryByRole('dialog', { name: 'Добро пожаловать' })).not.toBeInTheDocument()
  })
})

describe('App — действия модели в веб-превью (мост window.preview)', () => {
  interface BridgeAction { conversationId: string; requestId: string; action: PreviewAction }
  interface BridgeResult { requestId: string; ok: boolean; result?: unknown; error?: string }

  /** Ставит фейковый мост и возвращает способ отправить действие + ответы. */
  function installPreviewBridge(): { emit: (m: BridgeAction) => void; results: BridgeResult[] } {
    let onAction: ((m: BridgeAction) => void) | undefined
    const results: BridgeResult[] = []
    ;(window as { preview?: unknown }).preview = {
      onAction: (cb: (m: BridgeAction) => void) => { onAction = cb; return () => { onAction = undefined } },
      result: (m: BridgeResult) => results.push(m)
    }
    return { emit: (m) => onAction?.(m), results }
  }

  afterEach(() => { delete (window as { preview?: unknown }).preview; window.location.hash = '' })

  it('браузерное действие из обычного чата отклоняется: рекордер доступен только на отдельной странице', async () => {
    const bridge = installPreviewBridge()
    const api = await renderApp()
    const active = api._state.conversations.find((c) => c.title === 'Поездка в Лиссабон')!
    bridge.emit({ conversationId: active.id, requestId: 'r1', action: { kind: 'open', url: 'https://shop.example/' } })
    await waitFor(() => expect(bridge.results).toHaveLength(1))
    expect(bridge.results[0].ok).toBe(false)
    expect(api._state.conversations.find((c) => c.id === active.id)?.previewUrl ?? null).toBeNull()
    expect(screen.queryByTitle('Web Reader')).not.toBeInTheDocument()
  })

  it('действие для неактивного чата отклоняется: превью ограничено активной страницей', async () => {
    const bridge = installPreviewBridge()
    const api = await renderApp()
    const inactive = api._state.conversations.find((c) => c.title === 'Идеи для подарка')!
    bridge.emit({ conversationId: inactive.id, requestId: 'r2', action: { kind: 'open', url: 'https://shop.example/' } })
    await waitFor(() => expect(bridge.results).toHaveLength(1))
    expect(bridge.results[0].ok).toBe(false)
    expect(bridge.results[0].error).toContain('не открыт')
    expect(api._state.conversations.find((c) => c.id === inactive.id)?.previewUrl ?? null).toBeNull()
  })

  it('DOM-действие без загруженной страницы превью отвечает ошибкой', async () => {
    const bridge = installPreviewBridge()
    const api = await renderApp()
    const active = api._state.conversations.find((c) => c.title === 'Поездка в Лиссабон')!
    bridge.emit({ conversationId: active.id, requestId: 'r3', action: { kind: 'read' } })
    await waitFor(() => expect(bridge.results).toHaveLength(1))
    expect(bridge.results[0].ok).toBe(false)
  })

  it('Playwright Reader привязывает open/read к чату и восстанавливает панель после refresh', async () => {
    const api = createFakeApi([])
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    const chat = await api['conversations:create']({ title: 'Reader A', assistantKind: 'playwright-reader' })
    window.location.hash = `#/playwright-reader/${chat.id}`
    let bridge = installPreviewBridge()
    const view = render(<App api={api} delays={SLOW} />)
    let frame = await screen.findByTitle('Web Reader') as HTMLIFrameElement
    fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, data: { type: WEB_RECORDER_MESSAGE_TYPE, kind: 'ready' } }))
    bridge.emit({ conversationId: chat.id, requestId: 'pw-open', action: { kind: 'open', url: 'https://shop.example/' } })
    await waitFor(() => expect(api._state.conversations.find((item) => item.id === chat.id)?.previewUrl).toBe('https://shop.example/'))
    fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, data: { type: WEB_RECORDER_MESSAGE_TYPE, kind: 'page-status', status: 'ready', url: 'https://shop.example/' } }))
    await waitFor(() => expect(bridge.results).toContainEqual({ requestId: 'pw-open', ok: true, result: { url: 'https://shop.example/' } }))

    view.unmount()
    bridge = installPreviewBridge()
    render(<App api={api} delays={SLOW} />)
    frame = await screen.findByTitle('Web Reader') as HTMLIFrameElement
    const post = vi.spyOn(frame.contentWindow as Window, 'postMessage')
    fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, data: { type: WEB_RECORDER_MESSAGE_TYPE, kind: 'ready' } }))
    fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, data: { type: WEB_RECORDER_MESSAGE_TYPE, kind: 'page-status', status: 'ready', url: 'https://shop.example/' } }))
    bridge.emit({ conversationId: chat.id, requestId: 'pw-read', action: { kind: 'read' } })
    await waitFor(() => expect(post.mock.calls.some(([message]) => (message as { kind?: string; action?: { kind: string } }).kind === 'run-action' && (message as { action?: { kind: string } }).action?.kind === 'read')).toBe(true))
    const command = post.mock.calls.map(([message]) => message as { kind?: string; requestId?: string; action?: { kind: string } }).find((message) => message.kind === 'run-action' && message.action?.kind === 'read')!
    const result = { page: { url: 'https://shop.example/', title: 'Shop' }, headings: [], links: [], buttons: [], inputs: [], text: 'Loaded' }
    fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, data: { type: WEB_RECORDER_MESSAGE_TYPE, kind: 'action-result', requestId: command.requestId, ok: true, result } }))
    await waitFor(() => expect(bridge.results).toContainEqual({ requestId: 'pw-read', ok: true, result }))
  })

  it('при переключении Playwright Reader отклоняет команды панели другого чата', async () => {
    const bridge = installPreviewBridge()
    const api = createFakeApi([])
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    const first = await api['conversations:create']({ title: 'Reader A', assistantKind: 'playwright-reader' })
    const second = await api['conversations:create']({ title: 'Reader B', assistantKind: 'playwright-reader' })
    window.location.hash = `#/playwright-reader/${first.id}`
    render(<App api={api} delays={SLOW} />)
    await screen.findByTitle('Web Reader')
    await userEvent.selectOptions(screen.getByLabelText('Разговор Playwright Reader'), second.id)
    await waitFor(() => expect(window.location.hash).toBe(`#/playwright-reader/${second.id}`))
    await waitFor(() => expect(screen.getByLabelText('Разговор Playwright Reader')).toHaveValue(second.id))
    bridge.emit({ conversationId: first.id, requestId: 'old-chat', action: { kind: 'read' } })
    await waitFor(() => expect(bridge.results).toHaveLength(1))
    expect(bridge.results[0]).toMatchObject({ requestId: 'old-chat', ok: false, error: expect.stringContaining('не открыт') })
  })
})

describe('App — интеграция UI со стором и IPC', () => {
  it('на десктопе сразу показывает поле, а на мобильном разворачивает его с фокусом', async () => {
    await renderApp()
    expect(screen.getByLabelText('Поле ввода сообщения')).toBeInTheDocument()
    expect(screen.getByLabelText('Поле ввода сообщения')).not.toHaveFocus()
  })

  it('на viewport 768px и уже открывает свёрнутый композер', async () => {
    const restore = setChatViewport(true)
    try {
      await renderApp()
      expect(screen.queryByLabelText('Поле ввода сообщения')).not.toBeInTheDocument()
      await userEvent.click(screen.getByTestId('composer-expand'))
      expect(screen.getByLabelText('Поле ввода сообщения')).toHaveFocus()
    } finally {
      restore()
    }
  })

  it('показывает версию релиза на любой странице и дату в подсказке', async () => {
    await renderApp()
    const version = await screen.findByText('v0.1.0')
    expect(version).toHaveAttribute('title')
    expect(version.getAttribute('title')).not.toBe('')
    expect(version).toHaveAccessibleName(/Версия 0\.1\.0; выпущена/)
  })

  it('рендерит сайдбар с логотипом и разговорами из БД', async () => {
    await renderApp()
    expect(screen.getByText('Голос·Чат')).toBeInTheDocument()
    // Активный разговор виден и в сайдбаре, и в шапке → минимум два вхождения.
    expect(screen.getAllByText('Поездка в Лиссабон').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Идеи для подарка')).toBeInTheDocument()
  })

  it('в idle показывает бейдж «Готов» и сообщения активного разговора', async () => {
    await renderApp()
    expect(screen.getByText('Готов')).toBeInTheDocument()
    expect(
      screen.getByText(/какая сегодня погода обычно бывает в Лиссабоне/i)
    ).toBeInTheDocument()
  })

  it('блокирует голосовой ввод для всех пользователей', async () => {
    await renderApp()
    expect(screen.queryByLabelText('Говорить')).not.toBeInTheDocument()
    expect(screen.queryByText('Голосовой ввод временно недоступен')).not.toBeInTheDocument()
    expect(screen.queryByTestId('live-block')).not.toBeInTheDocument()
  })

  it('отправка текста Enter создаёт сообщение и переводит в «Claude думает»', async () => {
    await renderApp()
    const input = screen.getByLabelText('Поле ввода сообщения')
    await userEvent.type(input, 'Привет!{Enter}')
    expect(await screen.findByText('Claude думает', {}, { timeout: 10_000 })).toBeInTheDocument()
    expect(screen.getByText('Привет!')).toBeInTheDocument()
  })

  it('открытие и закрытие модалки настроек по кнопке ✕', async () => {
    await renderApp()
    await userEvent.click(screen.getByText('Настройки'))
    expect(screen.getByRole('dialog', { name: 'Настройки' })).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Закрыть'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('клик по оверлею закрывает модалку, клик по карточке — нет', async () => {
    await renderApp()
    await userEvent.click(screen.getByText('Настройки'))
    await userEvent.click(screen.getByRole('dialog', { name: 'Настройки' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('overlay'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('меню модели содержит актуальные модели Claude', async () => {
    await renderApp()
    await openSettings() // раздел «Агент» — по умолчанию
    const select = screen.getByLabelText('Модель Claude')
    const labels = [...select.querySelectorAll('option')].map((o) => o.textContent)
    expect(labels).toEqual([
      'Default (recommended)',
      'Opus (1M context)',
      'Fable',
      'Sonnet',
      'Haiku'
    ])
  })

  it('подпись движка запечена в сообщение: смена движка не переписывает старые ответы', async () => {
    const api = createFakeApi([])
    // Текущий движок — Codex, но у старых ответов свои запечённые подписи.
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true, llmProvider: 'codex' })
    const conv = await api['conversations:create']({ title: 'Смешанный чат' })
    await api['messages:add']({ conversationId: conv.id, role: 'u1', text: 'вопрос', time: '10:00' })
    await api['messages:add']({
      conversationId: conv.id,
      role: 'ai',
      text: 'ответ codex',
      time: '10:01',
      engine: 'codex'
    })
    await api['messages:add']({
      conversationId: conv.id,
      role: 'ai',
      text: 'ответ claude',
      time: '10:02',
      engine: 'claude'
    })
    await api['messages:add']({
      conversationId: conv.id,
      role: 'ai',
      text: 'старый ответ',
      time: '10:03'
    }) // без engine → «Claude» (легаси)

    render(<App api={api} delays={SLOW} />)
    await screen.findByText('ответ codex', {}, { timeout: 10_000 })

    // Считаем подписи только в ленте чата (в сайдбаре есть кнопки Codex/Claude Code).
    const chat = within(screen.getByTestId('scroll'))
    // Ровно один ответ помечен «Codex», два — «Claude» (claude + легаси),
    // хотя текущий движок в настройках — Codex.
    expect(chat.getAllByText('Codex')).toHaveLength(1)
    expect(chat.getAllByText('Claude')).toHaveLength(2)
  })

  it('тумблер тёмной темы меняет data-theme и сохраняется', async () => {
    const api = await renderApp()
    expect(document.querySelector('.app')?.getAttribute('data-theme')).toBe('light')
    await openSettings('Интерфейс')
    await userEvent.click(screen.getByRole('switch', { name: 'Тёмная тема' }))
    expect(api._state.settings.theme).toBe('dark')
    expect(document.querySelector('.app')?.getAttribute('data-theme')).toBe('dark')
  })

  it('настройки голосового ввода неактивны', async () => {
    const api = await renderApp()
    await openSettings('Распознавание')
    const sw = screen.getByRole('switch', { name: 'Диаризация спикеров' })
    expect(sw).toBeDisabled()
    await userEvent.click(sw)
    expect(sw).toHaveAttribute('aria-checked', 'true')
    expect(api._state.settings.diarization).toBe(true)
  })

  it('тумблер «Режим консоли» включает панель консоли и сохраняется', async () => {
    const api = await renderApp()
    expect(screen.queryByTestId('console-panel')).toBeNull()

    await openSettings('Интерфейс')
    const sw = screen.getByRole('switch', { name: 'Режим консоли' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(sw)

    expect(sw).toHaveAttribute('aria-checked', 'true')
    expect(api._state.settings.showConsole).toBe(true)
    await userEvent.click(screen.getByLabelText('Закрыть'))
    expect(screen.getByTestId('console-panel')).toBeInTheDocument()
  })

  it('поиск в сайдбаре фильтрует список разговоров', async () => {
    await renderApp() // «Идеи для подарка» + «Поездка в Лиссабон»
    await userEvent.type(screen.getByLabelText('Поиск по разговорам'), 'лисс')
    // Список в сайдбаре: заголовки разговоров — элементы .ctitle.
    await waitFor(() => {
      const titles = [...document.querySelectorAll('.ctitle')].map((n) => n.textContent)
      expect(titles).toEqual(['Поездка в Лиссабон'])
    })
  })

  it('переименование разговора: заголовок в шапке → ввод → Enter обновляет название и зовёт api', async () => {
    const api = await renderApp()
    // Кнопки «✎» в сайдбаре больше нет: переименование живёт только в шапке
    // открытого чата (Sidebar.dom.test.tsx проверяет её отсутствие).
    await userEvent.click(screen.getByRole('heading', { name: 'Поездка в Лиссабон' }))
    const input = screen.getByLabelText('Новое название разговора')
    await userEvent.clear(input)
    await userEvent.type(input, 'Отпуск в Лиссабоне{Enter}')

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Отпуск в Лиссабоне' })).toBeInTheDocument())
    expect(api._state.conversations.some((c) => c.title === 'Отпуск в Лиссабоне')).toBe(true)
  })

  it('удаление разговора: подтверждение убирает его из списка и зовёт api', async () => {
    const api = await renderApp()
    expect(screen.getByText('Идеи для подарка')).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('Удалить разговор «Идеи для подарка»'))
    await userEvent.click(screen.getByText('Удалить'))

    await waitFor(() => expect(screen.queryByText('Идеи для подарка')).not.toBeInTheDocument())
    expect(api._state.conversations.some((c) => c.title === 'Идеи для подарка')).toBe(false)
  })

  it('настройки сохраняются между «перезапусками» (общий api → БД)', async () => {
    const api = await seededApi()
    const first = render(<App api={api} delays={SLOW} />)
    await screen.findByText('Поездка в Лиссабон', {}, { timeout: 10_000 })

    await openSettings() // «Агент» — модель здесь
    await userEvent.selectOptions(screen.getByLabelText('Модель Claude'), 'sonnet')
    await userEvent.click(screen.getByRole('button', { name: 'Распознавание' }))
    await userEvent.click(screen.getByRole('button', { name: 'Озвучка' }))
    // Голос выбирается по реальному названию из активного движка (см. fakeApi).
    await userEvent.selectOptions(screen.getByLabelText('Голос озвучки'), 'ru_RU-dmitri-medium')
    expect(api._state.settings).toMatchObject({
      diarization: true,
      model: 'sonnet',
      voice: 'ru_RU-dmitri-medium'
    })

    // «Перезапуск»: новый App с тем же api (как чтение из БД при старте).
    first.unmount()
    render(<App api={api} delays={SLOW} />)
    await screen.findByText('Поездка в Лиссабон', {}, { timeout: 10_000 })
    await openSettings() // «Агент»
    expect(screen.getByLabelText<HTMLSelectElement>('Модель Claude').value).toBe('sonnet')
    await userEvent.click(screen.getByRole('button', { name: 'Распознавание' }))
    expect(screen.getByRole('switch', { name: 'Диаризация спикеров' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Озвучка' }))
    expect(screen.getByLabelText<HTMLSelectElement>('Голос озвучки').value).toBe('ru_RU-dmitri-medium')
  })

  it('меню голоса показывает реальные названия из движка', async () => {
    await renderApp()
    await openSettings('Озвучка')
    const select = screen.getByLabelText('Голос озвучки')
    expect(select).toHaveTextContent('Irina — русский (medium)')
    expect(select).toHaveTextContent('Dmitri — русский (medium)')
  })

  it('секция «Скачать голоса» показывает каталог и триггерит скачивание', async () => {
    await renderApp()
    await openSettings('Озвучка')
    const catalog = screen.getByTestId('voice-catalog')
    expect(catalog).toHaveTextContent('Скачать голоса')
    // Установленный помечен, неустановленный — с кнопкой «Скачать».
    expect(catalog).toHaveTextContent('✓ установлен')
    const dl = screen.getByLabelText('Скачать голос Ruslan — русский (medium)')
    await userEvent.click(dl)
    // После клика показывается прогресс (0%), т.к. в jsdom нет window.tts — прогресс
    // ставит стор. В jsdom window.tts отсутствует → downloadVoice — no-op, кнопка остаётся.
    expect(catalog).toBeInTheDocument()
  })
})

describe('App — мобильное меню', () => {
  const desktopMatchMedia = window.matchMedia
  beforeEach(() => {
    window.matchMedia = ((query: string) => ({
      matches: query === '(max-width: 768px)',
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false
    })) as typeof window.matchMedia
  })
  afterEach(() => { window.matchMedia = desktopMatchMedia })

  it('клик по пункту меню (Настройки) закрывает выдвинутый сайдбар', async () => {
    await renderApp()
    await userEvent.click(screen.getByLabelText('Открыть боковую панель')) // ☰ — выдвинуть
    expect(document.querySelector('.side--open')).not.toBeNull()
    await userEvent.click(screen.getByText('Настройки'))
    expect(document.querySelector('.side--open')).toBeNull()
  })

  it('смена маршрута закрывает сайдбар — иначе он висит поверх открытой страницы', async () => {
    await renderApp()
    try {
      await userEvent.click(screen.getByLabelText('Открыть боковую панель'))
      expect(document.querySelector('.side--open')).not.toBeNull()
      // Переход не через пункт меню (так работает «Открыть задачу» из шапки
      // связанного чата): раньше панель оставалась поверх карточки задачи.
      window.location.hash = '#/kb'
      await waitFor(() => expect(document.querySelector('.side--open')).toBeNull())
    } finally {
      window.location.hash = ''
    }
  })
})

describe('App — доступность', () => {
  it('без нарушений axe: сайдбар, чат и композер', async () => {
    await renderApp()
    // Единственное место, где включено правило region: у целого приложения весь
    // контент обязан лежать в ориентирах (сайдбар — complementary, чат — main),
    // иначе скринридеру не по чему прыгать. В тестах отдельных экранов правило
    // отключено — там рендерится фрагмент, у которого ориентиров нет по природе.
    await expectNoViolations(document.body, { rules: { region: { enabled: true } } })
    expectLabelledIconButtons()
  })

  it('ориентиры на месте: сайдбар и чат объявлены как области', async () => {
    await renderApp()
    expect(screen.getByRole('complementary')).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('без нарушений axe: открытые настройки', async () => {
    await renderApp()
    await openSettings()
    await expectNoViolations()
    expectLabelledIconButtons()
  })
})

describe('App — запуск задачи из чата', () => {
  it.each([
    ['широком desktop', 1440, false],
    ['средней ширине', 900, false],
    ['мобильной ширине', 390, true]
  ] as const)('сохраняет вертикальный порядок и адаптирует окно на %s', async (_label, width, phone) => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = ((query: string) => {
      const maxWidth = /max-width:\s*(\d+)px/.exec(query)?.[1]
      return {
        matches: maxWidth ? width <= Number(maxWidth) : false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => true
      }
    }) as typeof window.matchMedia

    try {
      const api = createFakeApi([])
      await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
      const project = await api['projects:create']({ name: 'Адаптивная форма' })
      const board = await api['board:get']({ id: project.id })
      const source = await api['tasks:create']({ projectId: project.id, columnId: board.columns[0]!.id, title: 'Исходная' })
      const chat = await api['tasks:openChat']({ projectId: project.id, taskId: source.id })
      await api['messages:add']({
        conversationId: chat.id,
        role: 'ai',
        text: 'Предложение.',
        time: '12:01',
        meta: { taskLaunch: { title: 'Длинная задача', description: 'Описание\\n'.repeat(20), acceptanceCriteria: 'Критерий\\n'.repeat(20) } }
      })
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/chat/${chat.id}`)
      render(<App api={api} delays={SLOW} />)
      await screen.findByTestId('task-chat-header')
      const dialog = await screen.findByRole('dialog', { name: 'Создание задачи' })
      expect(dialog).toHaveClass('jmodal-frame')
      expect(dialog).toHaveClass(phone ? 'vc-dialog--phone' : 'vc-dialog--lg')
      expect(within(dialog).getByLabelText('Заголовок задачи')).toHaveValue('Длинная задача')
      expect(within(dialog).getByTestId('task-desc-view')).toHaveTextContent('Описание')
      expect(within(dialog).getByTestId('task-criteria-view')).toHaveTextContent('Критерий')
      expect(within(dialog).getByRole('button', { name: 'Создать в TODO' })).toBeInTheDocument()
      expect(screen.queryByText('Как начать разработку?')).not.toBeInTheDocument()
    } finally {
      window.matchMedia = originalMatchMedia
    }
  })

  it('сразу открывает стандартную карточку с заполненными полями', async () => {
    const api = createFakeApi([])
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    const project = await api['projects:create']({ name: 'Проект запуска' })
    const board = await api['board:get']({ id: project.id })
    const source = await api['tasks:create']({ projectId: project.id, columnId: board.columns[0]!.id, title: 'Исходная' })
    const chat = await api['tasks:openChat']({ projectId: project.id, taskId: source.id })
    await api['messages:add']({ conversationId: chat.id, role: 'u1', text: 'Исправь запуск', time: '12:00' })
    await api['messages:add']({
      conversationId: chat.id,
      role: 'ai',
      text: 'Выберите способ работы.',
      time: '12:01',
      meta: { taskLaunch: { title: 'Исправить запуск', description: 'Описание задачи', acceptanceCriteria: 'TODO создан' } }
    })

    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/chat/${chat.id}`)
    render(<App api={api} delays={SLOW} />)
    await screen.findByTestId('task-chat-header')
    const dialog = await screen.findByRole('dialog', { name: 'Создание задачи' })
    expect(within(dialog).getByLabelText('Заголовок задачи')).toHaveValue('Исправить запуск')
    expect(within(dialog).getByTestId('task-desc-view')).toHaveTextContent('Описание задачи')
    expect(within(dialog).getByTestId('task-criteria-view')).toHaveTextContent('TODO создан')
    expect(within(dialog).getByRole('button', { name: 'Создать в TODO' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Создать в InProgress' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Работать в текущем чате' })).toBeInTheDocument()
  })

  it('показывает участников проекта и создаёт задачу с выбранным исполнителем', async () => {
    const api = createFakeApi([])
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    const project = await api['projects:create']({ name: 'Проект назначения' })
    await api['projects:addMember']({ id: project.id, username: 'bob' })
    const board = await api['board:get']({ id: project.id })
    const source = await api['tasks:create']({ projectId: project.id, columnId: board.columns[0]!.id, title: 'Исходная' })
    const chat = await api['tasks:openChat']({ projectId: project.id, taskId: source.id })
    await api['messages:add']({
      conversationId: chat.id,
      role: 'ai',
      text: 'Предложение.',
      time: '12:01',
      meta: { taskLaunch: { title: 'Назначаемая задача', description: 'Описание', acceptanceCriteria: 'Готово' } }
    })

    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/chat/${chat.id}`)
    render(<App api={api} delays={SLOW} />)
    const dialog = await screen.findByRole('dialog', { name: 'Создание задачи' })
    const assignee = within(dialog).getByRole('combobox', { name: 'Исполнитель' })
    expect(assignee).toHaveValue('')
    expect(within(assignee).getByRole('option', { name: 'Не назначен' })).toBeInTheDocument()
    expect(within(assignee).getByRole('option', { name: 'bob' })).toBeInTheDocument()
    await userEvent.selectOptions(assignee, 'bob')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать в TODO' }))

    await waitFor(async () => {
      expect((await api['board:get']({ id: project.id })).tasks.find((task) => task.title === 'Назначаемая задача')?.assignee).toBe('bob')
    })
  })

  it('создаёт задачу без исполнителя, если выбор оставлен пустым', async () => {
    const api = createFakeApi([])
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    const project = await api['projects:create']({ name: 'Проект без назначения' })
    const board = await api['board:get']({ id: project.id })
    const source = await api['tasks:create']({ projectId: project.id, columnId: board.columns[0]!.id, title: 'Исходная' })
    const chat = await api['tasks:openChat']({ projectId: project.id, taskId: source.id })
    await api['messages:add']({
      conversationId: chat.id,
      role: 'ai',
      text: 'Предложение.',
      time: '12:01',
      meta: { taskLaunch: { title: 'Свободная задача', description: 'Описание', acceptanceCriteria: 'Готово' } }
    })

    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/chat/${chat.id}`)
    render(<App api={api} delays={SLOW} />)
    const dialog = await screen.findByRole('dialog', { name: 'Создание задачи' })
    expect(within(dialog).getByRole('combobox', { name: 'Исполнитель' })).toHaveValue('')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать в TODO' }))

    await waitFor(async () => {
      expect((await api['board:get']({ id: project.id })).tasks.find((task) => task.title === 'Свободная задача')?.assignee).toBeNull()
    })
  })

  it('сохраняет поля и исполнителя в открытой форме после ошибки создания', async () => {
    const api = createFakeApi([])
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    const project = await api['projects:create']({ name: 'Проект ошибки' })
    await api['projects:addMember']({ id: project.id, username: 'bob' })
    const board = await api['board:get']({ id: project.id })
    const source = await api['tasks:create']({ projectId: project.id, columnId: board.columns[0]!.id, title: 'Исходная' })
    const chat = await api['tasks:openChat']({ projectId: project.id, taskId: source.id })
    await api['messages:add']({
      conversationId: chat.id,
      role: 'ai',
      text: 'Предложение.',
      time: '12:01',
      meta: { taskLaunch: { title: 'Черновик после ошибки', description: 'Описание', acceptanceCriteria: 'Готово' } }
    })
    const createTask = api['tasks:create']
    api['tasks:create'] = async (input) => {
      if (input.title === 'Черновик после ошибки') throw new Error('Исполнитель больше недоступен')
      return createTask(input)
    }

    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/chat/${chat.id}`)
    render(<App api={api} delays={SLOW} />)
    const dialog = await screen.findByRole('dialog', { name: 'Создание задачи' })
    const assignee = within(dialog).getByRole('combobox', { name: 'Исполнитель' })
    await userEvent.selectOptions(assignee, 'bob')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать в TODO' }))

    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Создать в TODO' })).toBeEnabled())
    expect(screen.getByRole('dialog', { name: 'Создание задачи' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Заголовок задачи')).toHaveValue('Черновик после ошибки')
    expect(assignee).toHaveValue('bob')
  })

  it('каждая из нескольких карточек создаёт свою задачу и восстанавливается из истории', async () => {
    const api = createFakeApi([])
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    const project = await api['projects:create']({ name: 'Проект запуска' })
    const board = await api['board:get']({ id: project.id })
    const source = await api['tasks:create']({ projectId: project.id, columnId: board.columns[0]!.id, title: 'Исходная' })
    const chat = await api['tasks:openChat']({ projectId: project.id, taskId: source.id })
    const firstDescription = '## Первое описание\n\n- только первый пункт'
    const firstCriteria = '1. Первый критерий\n2. Сохранить **Markdown**'
    const secondDescription = '## Второе описание\n\n\`\`\`ts\nconst second = true\n\`\`\`'
    const secondCriteria = '- Второй критерий\n- Строка с "кавычками"'
    await api['messages:add']({
      conversationId: chat.id,
      role: 'ai',
      text: 'Выберите задачи.',
      time: '12:01',
      meta: { taskLaunches: [
        { id: 'one', title: 'Первая задача', description: firstDescription, acceptanceCriteria: firstCriteria },
        { id: 'two', title: 'Вторая задача', description: secondDescription, acceptanceCriteria: secondCriteria }
      ] }
    })

    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/chat/${chat.id}`)
    const view = render(<App api={api} delays={SLOW} />)
    await screen.findByTestId('task-chat-header')
    let dialog = await screen.findByRole('dialog', { name: 'Создание задачи' })
    expect(within(dialog).getByLabelText('Заголовок задачи')).toHaveValue('Первая задача')
    expect(within(dialog).getByTestId('task-desc-view')).toHaveTextContent('Первое описание')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать в TODO' }))

    dialog = await screen.findByRole('dialog', { name: 'Создание задачи' })
    expect(within(dialog).getByLabelText('Заголовок задачи')).toHaveValue('Вторая задача')
    expect(within(dialog).getByTestId('task-desc-view')).toHaveTextContent('Второе описание')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать в TODO' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Создание задачи' })).not.toBeInTheDocument())
    view.unmount()
    render(<App api={api} delays={SLOW} />)
    await screen.findByTestId('task-chat-header')
    expect(screen.queryByRole('dialog', { name: 'Создание задачи' })).not.toBeInTheDocument()

    await waitFor(async () => {
      const saved = (await api['board:get']({ id: project.id })).tasks
      expect(saved).toEqual(expect.arrayContaining([
        expect.objectContaining({ title: 'Первая задача', description: firstDescription, acceptanceCriteria: firstCriteria }),
        expect.objectContaining({ title: 'Вторая задача', description: secondDescription, acceptanceCriteria: secondCriteria })
      ]))
    })
  })

  it('после создания задачи в TODO не продолжает выполнение в текущем чате', async () => {
    const api = createFakeApi([])
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    const project = await api['projects:create']({ name: 'Проект запуска' })
    const board = await api['board:get']({ id: project.id })
    const source = await api['tasks:create']({ projectId: project.id, columnId: board.columns[0]!.id, title: 'Исходная' })
    const chat = await api['tasks:openChat']({ projectId: project.id, taskId: source.id })
    await api['messages:add']({
      conversationId: chat.id,
      role: 'ai',
      text: 'Выберите способ работы.',
      time: '12:01',
      meta: { taskLaunch: { title: 'Новая задача', description: 'Описание', acceptanceCriteria: 'Создана' } }
    })
    const messageCount = api._state.messages.length

    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/chat/${chat.id}`)
    render(<App api={api} delays={SLOW} />)
    await screen.findByTestId('task-chat-header')
    const dialog = await screen.findByRole('dialog', { name: 'Создание задачи' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать в TODO' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Создание задачи' })).not.toBeInTheDocument())
    await waitFor(() => expect(api._state.messages).toHaveLength(messageCount + 1))
    expect(api._state.messages.at(-1)?.text).toContain('создать предложенную задачу в TODO')
    const updatedBoard = await api['board:get']({ id: project.id })
    expect(updatedBoard.tasks.some((task) => task.title === 'Новая задача')).toBe(true)
  })

  it('работает в текущем чате без карточки на доске и отправляет выбор следующим ходом', async () => {
    const api = createFakeApi([])
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    const project = await api['projects:create']({ name: 'Проект запуска' })
    const board = await api['board:get']({ id: project.id })
    const source = await api['tasks:create']({ projectId: project.id, columnId: board.columns[0]!.id, title: 'Исходная' })
    const chat = await api['tasks:openChat']({ projectId: project.id, taskId: source.id })
    await api['messages:add']({
      conversationId: chat.id,
      role: 'ai',
      text: 'Подробное описание.\n\nКритерии приёмки:\n- Проверка',
      time: '12:01',
      meta: { taskLaunch: { title: 'Без карточки', description: 'Подробное описание.', acceptanceCriteria: '- Проверка' } }
    })
    const tasksBefore = (await api['board:get']({ id: project.id })).tasks.length

    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/chat/${chat.id}`)
    render(<App api={api} delays={SLOW} />)
    const dialog = await screen.findByRole('dialog', { name: 'Создание задачи' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Работать в текущем чате' }))

    await waitFor(() => expect(api._state.messages.at(-1)?.text).toContain('без создания карточки'))
    expect((await api['board:get']({ id: project.id })).tasks).toHaveLength(tasksBefore)
  })

  it('закрывает черновик без создания задачи и не открывает его повторно', async () => {
    const api = createFakeApi([])
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    const project = await api['projects:create']({ name: 'Проект запуска' })
    const board = await api['board:get']({ id: project.id })
    const source = await api['tasks:create']({ projectId: project.id, columnId: board.columns[0]!.id, title: 'Исходная' })
    const chat = await api['tasks:openChat']({ projectId: project.id, taskId: source.id })
    await api['messages:add']({
      conversationId: chat.id,
      role: 'ai',
      text: 'Предложение.',
      time: '12:01',
      meta: { taskLaunch: { title: 'Закрываемая', description: 'Описание', acceptanceCriteria: 'Критерий' } }
    })

    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/chat/${chat.id}`)
    const view = render(<App api={api} delays={SLOW} />)
    const dialog = await screen.findByRole('dialog', { name: 'Создание задачи' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }))
    expect(screen.queryByRole('dialog', { name: 'Создание задачи' })).not.toBeInTheDocument()
    expect((await api['board:get']({ id: project.id })).tasks).toHaveLength(1)

    view.unmount()
    render(<App api={api} delays={SLOW} />)
    await screen.findByTestId('task-chat-header')
    expect(screen.queryByRole('dialog', { name: 'Создание задачи' })).not.toBeInTheDocument()
  })
})

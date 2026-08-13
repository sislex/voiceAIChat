import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { expectLabelledIconButtons, expectNoViolations } from './test/a11y'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { createFakeApi, type FakeApi } from './test/fakeApi'
import { DEFAULT_SETTINGS } from '@shared/types'

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
  interface BridgeAction { conversationId: string; requestId: string; action: { kind: string; url?: string } }
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

  afterEach(() => { delete (window as { preview?: unknown }).preview })

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
  it('показывает сохранённое предложение кнопкой и открывает карточку только по клику', async () => {
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
    expect(screen.queryByRole('dialog', { name: 'Настройки задачи разработки' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Создать задачу' }))

    const dialog = await screen.findByRole('dialog', { name: 'Настройки задачи разработки' })
    expect(within(dialog).getByLabelText('Название')).toHaveValue('Исправить запуск')
    expect(within(dialog).getByRole('button', { name: 'Создать в TODO' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Создать в InProgress' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Работать в текущем чате' })).toBeInTheDocument()
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
    expect(screen.getByRole('columnheader', { name: 'Название задачи' })).toBeInTheDocument()

    const secondRow = screen.getAllByRole('row').find((row) => within(row).queryByText('Вторая задача'))!
    await userEvent.click(within(secondRow).getByRole('button', { name: 'Создать задачу' }))
    let dialog = await screen.findByRole('dialog', { name: 'Настройки задачи разработки' })
    expect(within(dialog).getByLabelText('Название')).toHaveValue('Вторая задача')
    expect(within(dialog).getByLabelText('Описание')).toHaveValue(secondDescription)
    expect(within(dialog).getByLabelText('Критерии приёмки')).toHaveValue(secondCriteria)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать в TODO' }))
    await waitFor(() => expect(within(secondRow).getByText('Создана')).toBeInTheDocument())

    // Имитируем обновление страницы: сообщение и статус заново читаются из API.
    view.unmount()
    render(<App api={api} delays={SLOW} />)
    await screen.findByTestId('task-chat-header')
    expect(screen.getByText('Вторая задача').closest('tr')).toHaveTextContent('Создана')
    const firstRow = screen.getByText('Первая задача').closest('tr')!
    await userEvent.click(within(firstRow).getByRole('button', { name: 'Создать задачу' }))
    dialog = await screen.findByRole('dialog', { name: 'Настройки задачи разработки' })
    expect(within(dialog).getByLabelText('Название')).toHaveValue('Первая задача')
    expect(within(dialog).getByLabelText('Описание')).toHaveValue(firstDescription)
    expect(within(dialog).getByLabelText('Критерии приёмки')).toHaveValue(firstCriteria)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать в TODO' }))

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
    await userEvent.click(screen.getByRole('button', { name: 'Создать задачу' }))
    const dialog = await screen.findByRole('dialog', { name: 'Настройки задачи разработки' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать в TODO' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Настройки задачи разработки' })).not.toBeInTheDocument())
    expect(api._state.messages).toHaveLength(messageCount)
    const updatedBoard = await api['board:get']({ id: project.id })
    expect(updatedBoard.tasks.some((task) => task.title === 'Новая задача')).toBe(true)
  })
})

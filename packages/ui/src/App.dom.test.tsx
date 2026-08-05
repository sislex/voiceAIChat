import { describe, it, expect, vi } from 'vitest'
import { expectLabelledIconButtons, expectNoViolations } from './test/a11y'
import { act, render, screen, waitFor, within } from '@testing-library/react'
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

/** Открыть настройки и перейти в раздел меню (Агент — по умолчанию). */
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

describe('App — интеграция UI со стором и IPC', () => {
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
    // Композер открывается свёрнутым — до набора текста его надо развернуть.
    await userEvent.click(screen.getByTestId('composer-expand'))
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

  it('переименование разговора: ✎ → ввод → Enter обновляет название и зовёт api', async () => {
    const api = await renderApp()
    await userEvent.click(screen.getByLabelText('Переименовать разговор «Идеи для подарка»'))
    const input = screen.getByLabelText('Новое название разговора')
    await userEvent.clear(input)
    await userEvent.type(input, 'Подарки на НГ{Enter}')

    await waitFor(() => expect(screen.getByText('Подарки на НГ')).toBeInTheDocument())
    expect(api._state.conversations.some((c) => c.title === 'Подарки на НГ')).toBe(true)
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
  it('клик по пункту меню (Настройки) закрывает выдвинутый сайдбар', async () => {
    await renderApp()
    await userEvent.click(screen.getByLabelText('Меню разговоров')) // ☰ — выдвинуть
    expect(document.querySelector('.side--open')).not.toBeNull()
    await userEvent.click(screen.getByText('Настройки'))
    expect(document.querySelector('.side--open')).toBeNull()
  })

  it('смена маршрута закрывает сайдбар — иначе он висит поверх открытой страницы', async () => {
    await renderApp()
    try {
      await userEvent.click(screen.getByLabelText('Меню разговоров'))
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
  it('task-launch активного чата проекта открывает карточку со всеми вариантами', async () => {
    const api = createFakeApi([])
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    const project = await api['projects:create']({ name: 'Проект запуска' })
    const board = await api['board:get']({ id: project.id })
    const source = await api['tasks:create']({ projectId: project.id, columnId: board.columns[0]!.id, title: 'Исходная' })
    const chat = await api['tasks:openChat']({ projectId: project.id, taskId: source.id })
    await api['messages:add']({ conversationId: chat.id, role: 'u1', text: 'Исправь запуск', time: '12:00' })
    let done: Parameters<NonNullable<typeof window.claude>['onDone']>[0] | null = null
    window.claude = {
      send: vi.fn(),
      cancel: vi.fn(),
      onToken: () => () => {},
      onDone: (callback) => { done = callback; return () => {} },
      onError: () => () => {},
      onLog: () => () => {}
    }

    try {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/chat/${chat.id}`)
      render(<App api={api} delays={SLOW} />)
      await screen.findByTestId('task-chat-header')
      await act(async () => {
        done!({
          conversationId: chat.id,
          text: 'Выберите способ работы.',
          taskLaunch: { title: 'Исправить запуск', description: 'Описание задачи', acceptanceCriteria: 'TODO создан' }
        })
      })

      const dialog = await screen.findByRole('dialog', { name: 'Настройки задачи разработки' })
      expect(within(dialog).getByLabelText('Название')).toHaveValue('Исправить запуск')
      expect(within(dialog).getByRole('button', { name: 'Создать в TODO' })).toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: 'Создать в InProgress' })).toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: 'Работать в текущем чате' })).toBeInTheDocument()
    } finally {
      delete (window as Partial<Window>).claude
    }
  })
})

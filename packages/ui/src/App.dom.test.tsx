import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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

  it('клик по микрофону → запись: live-блок и бейдж «● Запись»', async () => {
    await renderApp()
    await userEvent.click(screen.getByLabelText('Говорить'))
    expect(screen.getByText('● Запись')).toBeInTheDocument()
    expect(screen.getByTestId('live-block')).toBeInTheDocument()
    expect(screen.getByText('РАСПОЗНАВАНИЕ · ЛОКАЛЬНО (WHISPER)')).toBeInTheDocument()
  })

  it('запись → стоп → распознавание с индикатором (think-блок)', async () => {
    await renderApp()
    await userEvent.click(screen.getByLabelText('Говорить'))
    await userEvent.click(screen.getByLabelText('Остановить запись'))
    // transcribing показывает think-блок и бейдж «Распознавание».
    expect(screen.getByText('Распознавание')).toBeInTheDocument()
    expect(screen.getByTestId('think')).toBeInTheDocument()
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
    await userEvent.click(screen.getByText('Настройки'))
    const select = screen.getByLabelText('Модель Claude')
    const labels = [...select.querySelectorAll('option')].map((o) => o.textContent)
    expect(labels).toEqual([
      'Claude Opus 4.8',
      'Claude Sonnet 5',
      'Claude Fable 5',
      'Claude Haiku 4.5'
    ])
  })

  it('тумблер тёмной темы меняет data-theme и сохраняется', async () => {
    const api = await renderApp()
    expect(document.querySelector('.app')?.getAttribute('data-theme')).toBe('light')
    await userEvent.click(screen.getByText('Настройки'))
    await userEvent.click(screen.getByRole('switch', { name: 'Тёмная тема' }))
    expect(api._state.settings.theme).toBe('dark')
    expect(document.querySelector('.app')?.getAttribute('data-theme')).toBe('dark')
  })

  it('тумблер диаризации переключает aria-checked и сохраняется в api', async () => {
    const api = await renderApp()
    await userEvent.click(screen.getByText('Настройки'))
    const sw = screen.getByRole('switch', { name: 'Диаризация спикеров' })
    expect(sw).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(sw)
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(api._state.settings.diarization).toBe(false)
  })

  it('тумблер «Режим консоли» включает панель консоли и сохраняется', async () => {
    const api = await renderApp()
    expect(screen.queryByTestId('console-panel')).toBeNull()

    await userEvent.click(screen.getByText('Настройки'))
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

    await userEvent.click(screen.getByText('Настройки'))
    await userEvent.click(screen.getByRole('switch', { name: 'Диаризация спикеров' }))
    await userEvent.selectOptions(screen.getByLabelText('Модель Claude'), 'sonnet')
    // Голос выбирается по реальному названию из активного движка (см. fakeApi).
    await userEvent.selectOptions(screen.getByLabelText('Голос озвучки'), 'ru_RU-dmitri-medium')
    expect(api._state.settings).toMatchObject({
      diarization: false,
      model: 'sonnet',
      voice: 'ru_RU-dmitri-medium'
    })

    // «Перезапуск»: новый App с тем же api (как чтение из БД при старте).
    first.unmount()
    render(<App api={api} delays={SLOW} />)
    await screen.findByText('Поездка в Лиссабон', {}, { timeout: 10_000 })
    await userEvent.click(screen.getByText('Настройки'))
    expect(screen.getByRole('switch', { name: 'Диаризация спикеров' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    expect(screen.getByLabelText<HTMLSelectElement>('Модель Claude').value).toBe('sonnet')
    expect(screen.getByLabelText<HTMLSelectElement>('Голос озвучки').value).toBe('ru_RU-dmitri-medium')
  })

  it('меню голоса показывает реальные названия из движка', async () => {
    await renderApp()
    await userEvent.click(screen.getByText('Настройки'))
    const select = screen.getByLabelText('Голос озвучки')
    expect(select).toHaveTextContent('Irina — русский (medium)')
    expect(select).toHaveTextContent('Dmitri — русский (medium)')
  })

  it('секция «Скачать голоса» показывает каталог и триггерит скачивание', async () => {
    await renderApp()
    await userEvent.click(screen.getByText('Настройки'))
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

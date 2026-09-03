import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App, { openWebReaderWorkspace } from './App'
import { createFakeApi, type FakeApi } from './test/fakeApi'
import { DEFAULT_SETTINGS } from '@shared/types'
import { DEFAULT_AGENT_POLICY, type AgentInfo } from '@shared/agentProtocol'

const SLOW = { frame: 100_000, transcribe: 100_000, think: 100_000, speak: 100_000 }

// Адрес чата: любой переход к разговору идёт через #/chat/:id, поэтому ссылку
// можно скопировать и открыть заново. Между тестами hash сбрасывает setup.ts.
afterEach(() => {
  window.location.hash = ''
  delete window.desktopHost
  vi.unstubAllGlobals()
})

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

interface Seeded {
  api: FakeApi
  /** Старый разговор (не самый свежий). */
  gifts: string
  /** Самый свежий разговор — его открывает загрузка без адреса. */
  lisbon: string
}

async function seededApi(): Promise<Seeded> {
  const api = createFakeApi([])
  const availableMachine: AgentInfo = { id: 'test-mac', name: 'Test Mac', online: true, createdAt: 1, lastSeen: 1, policy: DEFAULT_AGENT_POLICY }
  api['agents:list'] = async () => [availableMachine]
  await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
  const gifts = await api['conversations:create']({ title: 'Идеи для подарка' })
  await api['messages:add']({ conversationId: gifts.id, role: 'u1', text: 'Что подарить?', time: '10:00' })
  const lisbon = await api['conversations:create']({ title: 'Поездка в Лиссабон' })
  await api['messages:add']({ conversationId: lisbon.id, role: 'u1', text: 'Погода в июле?', time: '14:02' })
  return { api, gifts: gifts.id, lisbon: lisbon.id }
}

describe('App — пустая главная страница чатов', () => {
  it('показывает Make-состояние и открывает существующее создание разговора', async () => {
    const api = createFakeApi([])
    api['agents:list'] = async () => [{
      id: 'test-mac',
      name: 'Test Mac',
      online: true,
      createdAt: 1,
      lastSeen: 1,
      policy: DEFAULT_AGENT_POLICY
    }]
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })

    render(<App api={api} delays={SLOW} />)

    const page = await screen.findByTestId('chats-empty')
    expect(screen.getByRole('heading', { name: 'Чаты' })).toBeInTheDocument()
    expect(page).toHaveTextContent('Новых чатов пока нет')
    expect(page).toHaveTextContent('Новый разговор появится здесь после создания.')
    await userEvent.click(screen.getByRole('button', { name: 'Добавить новый чат' }))
    expect(await screen.findByRole('button', { name: 'Создать разговор' })).toBeInTheDocument()
  })
})

describe('App — machine-required guard', () => {
  it('при отсутствии online-машины приостанавливает создание чата и показывает единый web-диалог', async () => {
    const api = createFakeApi([])
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    await api['conversations:create']({ title: 'Текущий чат' })
    render(<App api={api} delays={SLOW} />)
    await screen.findByText('Текущий чат')
    await userEvent.click(screen.getByRole('button', { name: 'Новый чат' }))
    expect(await screen.findByRole('dialog', { name: 'Подключить устройство' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Скачать приложение' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Подключить текущее устройство' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Создать разговор' })).not.toBeInTheDocument()
  })

  it('после server-confirmed enrollment назначает default и продолжает создание чата ровно один раз', async () => {
    let enrolled = false
    const api = createFakeApi([])
    const currentMac: AgentInfo = {
      id: 'current-mac',
      name: 'Текущий Mac',
      online: true,
      createdAt: 1,
      lastSeen: 1,
      policy: DEFAULT_AGENT_POLICY
    }
    api['agents:list'] = async () => enrolled ? [currentMac] : []
    api['loginApplication:issueEnrollment'] = async () => {
      enrolled = true
      return {
        enrollmentToken: 'one',
        statusId: 'status-one',
        expiresAt: Date.now() + 60_000,
        deepLink: 'voicechat-login://enroll?v=1&token=one&status=status-one&server=http%3A%2F%2Flocalhost%3A8787'
      }
    }
    api['loginApplication:enrollmentStatus'] = async () => ({
      status: 'completed',
      agentId: currentMac.id,
      expiresAt: Date.now() + 60_000
    })
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    await api['conversations:create']({ title: 'Текущий чат' })
    render(<App api={api} delays={SLOW} />)
    await screen.findByText('Текущий чат')

    await userEvent.click(screen.getByRole('button', { name: 'Новый чат' }))
    expect(await screen.findByRole('dialog', { name: 'Подключить устройство' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Подключить текущее устройство' }))

    await waitFor(() => expect(api._state.settings.defaultAgentId).toBe(currentMac.id), { timeout: 2_000 })
    expect(await screen.findByRole('button', { name: 'Создать разговор' })).toBeInTheDocument()
  })

  it('игнорирует запоздалый issue после закрытия диалога и отменяет continuation', async () => {
    const issue = deferred<Awaited<ReturnType<FakeApi['loginApplication:issueEnrollment']>>>()
    const api = createFakeApi([])
    const status = vi.fn(api['loginApplication:enrollmentStatus'])
    api['loginApplication:issueEnrollment'] = () => issue.promise
    api['loginApplication:enrollmentStatus'] = status
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    await api['conversations:create']({ title: 'Текущий чат' })
    render(<App api={api} delays={SLOW} />)
    await screen.findByText('Текущий чат')

    await userEvent.click(screen.getByRole('button', { name: 'Новый чат' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Подключить текущее устройство' }))
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    issue.resolve({
      enrollmentToken: 'old-secret',
      statusId: 'old-status',
      expiresAt: Date.now() + 60_000,
      deepLink: 'voicechat-login://enroll?v=1&secret=old-secret&correlationId=old-status&origin=http%3A%2F%2Flocalhost%3A8787'
    })

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Подключить устройство' })).not.toBeInTheDocument())
    expect(status).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Создать разговор' })).not.toBeInTheDocument()
  })

  it('игнорирует запоздалый ответ реестра артефактов после закрытия диалога', async () => {
    const artifacts = deferred<Awaited<ReturnType<FakeApi['loginApplication:artifacts']>>>()
    const api = createFakeApi([])
    api['loginApplication:artifacts'] = () => artifacts.promise
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    await api['conversations:create']({ title: 'Текущий чат' })
    render(<App api={api} delays={SLOW} />)
    await screen.findByText('Текущий чат')

    await userEvent.click(screen.getByRole('button', { name: 'Новый чат' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Скачать приложение' }))
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    artifacts.resolve([{
      platform: 'macos',
      arch: 'arm64',
      available: false
    }])

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Подключить устройство' })).not.toBeInTheDocument())
    expect(screen.queryByText('Сборка macOS ARM64 сейчас недоступна.')).not.toBeInTheDocument()
  })
})

describe('App — адрес открытого чата (#/chat/:id)', () => {
  it('загрузка без адреса открывает свежий чат и подставляет его id в URL', async () => {
    const { api, lisbon } = await seededApi()
    render(<App api={api} delays={SLOW} />)

    expect(await screen.findByText('Погода в июле?')).toBeInTheDocument()
    await waitFor(() => expect(window.location.hash).toBe(`#/chat/${lisbon}`))
  })

  it('на мобильной ширине показывает centered-композер в пустом чате с id и после первой реплики переводит его в docked', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 768px)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    })))
    const api = createFakeApi([])
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    const conversation = await api['conversations:create']({ title: 'Новый разговор' })
    const addMessage = vi.spyOn(api, 'messages:add')
    window.location.hash = `#/chat/${conversation.id}`

    render(<App api={api} delays={SLOW} />)

    const composer = await screen.findByRole('textbox', { name: 'Поле ввода сообщения' })
    expect(composer.closest('.voicebar')).toHaveAttribute('data-layout', 'centered')
    expect(screen.queryByTestId('composer-expand')).not.toBeInTheDocument()

    await userEvent.type(composer, 'Первое сообщение{enter}')

    await waitFor(() => expect(addMessage).toHaveBeenCalledTimes(1))
    expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: conversation.id,
      text: 'Первое сообщение'
    }))
    const expand = await screen.findByTestId('composer-expand')
    expect(screen.queryByRole('textbox', { name: 'Поле ввода сообщения' })).not.toBeInTheDocument()
    await userEvent.click(expand)
    expect(screen.getByRole('textbox', { name: 'Поле ввода сообщения' }).closest('.voicebar')).toHaveAttribute('data-layout', 'docked')
  })

  it('загрузка по ссылке открывает чат из адреса, а не самый свежий', async () => {
    const { api, gifts } = await seededApi()
    window.location.hash = `#/chat/${gifts}`
    render(<App api={api} delays={SLOW} />)

    expect(await screen.findByText('Что подарить?')).toBeInTheDocument()
    expect(screen.queryByText('Погода в июле?')).not.toBeInTheDocument()
    expect(window.location.hash).toBe(`#/chat/${gifts}`)
  })

  it('клик по разговору в сайдбаре меняет адрес, а смена адреса — открытый чат', async () => {
    const { api, gifts, lisbon } = await seededApi()
    render(<App api={api} delays={SLOW} />)
    await screen.findByText('Погода в июле?')

    await userEvent.click(screen.getByText('Идеи для подарка'))
    await waitFor(() => expect(window.location.hash).toBe(`#/chat/${gifts}`))
    expect(await screen.findByText('Что подарить?')).toBeInTheDocument()

    // «Назад» в браузере — это просто смена hash: чат должен переключиться сам.
    window.location.hash = `#/chat/${lisbon}`
    expect(await screen.findByText('Погода в июле?')).toBeInTheDocument()
  })

  it('новый разговор показывает файловое хранилище и сохраняется до первой отправки', async () => {
    const { api } = await seededApi()
    render(<App api={api} delays={SLOW} />)
    await screen.findByText('Погода в июле?')

    await userEvent.click(screen.getByRole('button', { name: 'Новый чат' }))
    expect(await screen.findByRole('heading', { name: 'Файлы чата' })).toBeInTheDocument()
    expect(await screen.findByText('Нет доступных проектов. Разговор можно создать без проекта.')).toBeInTheDocument()
    expect(screen.getByText(/\.voicechat_uploads/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Создать разговор' }))

    await waitFor(() => expect(window.location.hash).toMatch(/^#\/chat\/.+/))
    expect(api._state.conversations).toHaveLength(3)
    expect(api._state.conversations.filter((conversation) => conversation.title === 'Новый разговор')).toHaveLength(1)
  })

  it('выбранный проект передаётся при создании и остаётся у открытого разговора', async () => {
    const { api } = await seededApi()
    const project = await api['projects:create']({ name: 'Голосовой помощник' })
    const create = vi.spyOn(api, 'conversations:create')
    render(<App api={api} delays={SLOW} />)
    await screen.findByText('Погода в июле?')

    await userEvent.click(screen.getByRole('button', { name: 'Новый чат' }))
    await userEvent.selectOptions(await screen.findByLabelText('Проект'), project.id)
    await userEvent.click(screen.getByRole('button', { name: 'Создать разговор' }))

    await waitFor(() => expect(window.location.hash).toMatch(/^#\/chat\/.+/))
    expect(create).toHaveBeenCalledWith({ title: 'Новый разговор', scope: 'chat', projectId: project.id })
    const created = api._state.conversations.at(-1)
    expect(created?.projectId).toBe(project.id)
    expect(window.location.hash).toBe(`#/chat/${created?.id}`)
  })

  it('ошибка списка проектов видна и не мешает создать разговор без проекта', async () => {
    const { api } = await seededApi()
    render(<App api={api} delays={SLOW} />)
    await screen.findByText('Погода в июле?')
    api['projects:list'] = vi.fn().mockRejectedValue(new Error('projects unavailable'))

    await userEvent.click(screen.getByRole('button', { name: 'Новый чат' }))
    expect(await screen.findByText(/Не удалось загрузить проекты: projects unavailable/)).toHaveAttribute('role', 'alert')
    expect(screen.getByRole('option', { name: 'Без проекта' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Создать разговор' }))

    await waitFor(() => expect(window.location.hash).toMatch(/^#\/chat\/.+/))
    expect(api._state.conversations.at(-1)?.projectId).toBeNull()
  })

  it('удаление открытого чата уводит на адрес следующего', async () => {
    const { api, gifts, lisbon } = await seededApi()
    render(<App api={api} delays={SLOW} />)
    await waitFor(() => expect(window.location.hash).toBe(`#/chat/${lisbon}`))

    await userEvent.click(screen.getByLabelText('Удалить разговор «Поездка в Лиссабон»'))
    await userEvent.click(screen.getByText('Удалить'))

    await waitFor(() => expect(window.location.hash).toBe(`#/chat/${gifts}`))
    expect(await screen.findByText('Что подарить?')).toBeInTheDocument()
  })

  it('ссылка на удалённый чат: показываем ошибку и открываем свежий', async () => {
    const { api, lisbon } = await seededApi()
    window.location.hash = '#/chat/нет-такого'
    render(<App api={api} delays={SLOW} />)

    expect(await screen.findByTestId('error-bar')).toHaveTextContent('Разговор не найден')
    expect(await screen.findByText('Погода в июле?')).toBeInTheDocument()
    await waitFor(() => expect(window.location.hash).toBe(`#/chat/${lisbon}`))
  })

  it('переход на битый адрес при работе возвращает прежний чат', async () => {
    const { api, lisbon } = await seededApi()
    render(<App api={api} delays={SLOW} />)
    await waitFor(() => expect(window.location.hash).toBe(`#/chat/${lisbon}`))

    window.location.hash = '#/chat/id-которого-нет'
    expect(await screen.findByTestId('error-bar')).toHaveTextContent('Разговор не найден')
    await waitFor(() => expect(window.location.hash).toBe(`#/chat/${lisbon}`))
    expect(await screen.findByText('Погода в июле?')).toBeInTheDocument()
  })
})

describe('App — отдельная страница Web Reader', () => {
  it('открывает workspace в новой вкладке и сохраняет исходный чат', () => {
    window.location.hash = '#/chat/chat-42'
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)

    openWebReaderWorkspace()

    expect(open).toHaveBeenCalledWith(
      `${window.location.origin}${window.location.pathname}#/web-reader`,
      '_blank',
      'noopener,noreferrer'
    )
    expect(window.location.hash).toBe('#/chat/chat-42')
  })

  it('показывает Web Reader на собственном маршруте', async () => {
    const { api } = await seededApi()
    window.location.hash = '#/web-reader'
    render(<App api={api} delays={SLOW} />)

    const frame = await screen.findByTitle('Web Reader')
    expect(frame).toHaveAttribute('src', '/web-recorder/')
    expect(window.location.hash).toMatch(/^#\/web-reader\/.+/)
    expect(screen.getByRole('tab', { name: 'Сайт' })).toBeInTheDocument()
    expect(document.querySelector('aside.side')).not.toBeInTheDocument()
    expect(document.querySelector('.app')).toHaveClass('app--web-reader')
    expect(document.querySelector('section.webpreview[aria-label="Web Reader"]')).toBeInTheDocument()
  })

  it('перенаправляет старый URL на Web Reader без открытия второго чата', async () => {
    const { api } = await seededApi()
    const reader = await api['conversations:create']({ title: 'Reader', assistantKind: 'web-recorder' })
    window.location.hash = `#/web-recorder/${reader.id}`
    render(<App api={api} delays={SLOW} />)

    await screen.findByTitle('Web Reader')
    await waitFor(() => expect(window.location.hash).toBe(`#/web-reader/${reader.id}`))
  })

  it('не открывает обычный чат как Web Reader и не создаёт лишний разговор', async () => {
    const { api, gifts } = await seededApi()
    const reader = await api['conversations:create']({ title: 'Reader', assistantKind: 'web-recorder' })
    const count = api._state.conversations.length
    window.location.hash = `#/web-reader/${gifts}`
    render(<App api={api} delays={SLOW} />)

    await screen.findByTitle('Web Reader')
    await waitFor(() => expect(window.location.hash).toBe(`#/web-reader/${reader.id}`))
    expect(api._state.conversations).toHaveLength(count)
    expect(screen.queryByText('Что подарить?')).not.toBeInTheDocument()
  })

  it('фильтр проекта в сайдбаре не сжимает список Web Reader и не плодит чаты', async () => {
    const api = createFakeApi([])
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    const project = await api['projects:create']({ name: 'P' })
    const reader = await api['conversations:create']({ title: 'Reader', assistantKind: 'web-recorder' })
    // Персистентный фильтр обычного сайдбара сужает список другим проектом.
    localStorage.setItem('vc.sidebar.project', project.id)
    const count = api._state.conversations.length
    window.location.hash = '#/web-reader'
    try {
      render(<App api={api} delays={SLOW} />)

      await screen.findByTitle('Web Reader')
      // Открылся существующий reader-чат; цикла повторного создания нет.
      await waitFor(() => expect(window.location.hash).toBe(`#/web-reader/${reader.id}`))
      expect(api._state.conversations).toHaveLength(count)
    } finally {
      localStorage.removeItem('vc.sidebar.project')
    }
  })

  it('селектор перечисляет только scope=web-reader и отклоняет legacy chat из URL', async () => {
    const { api } = await seededApi()
    await api['conversations:create']({ title: 'Reader', assistantKind: 'web-recorder' })
    const legacy = await api['conversations:create']({ title: 'Старый ридер' })
    await api['conversations:setPreviewUrl']({ id: legacy.id, previewUrl: 'https://example.com' })
    window.location.hash = `#/web-reader/${legacy.id}`
    render(<App api={api} delays={SLOW} />)

    const select = await screen.findByLabelText('Разговор Web Reader')
    await waitFor(() => expect(select).not.toHaveValue(legacy.id))
    expect(screen.getByRole('option', { name: 'Reader' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Старый ридер' })).not.toBeInTheDocument()
    // Обычные чаты в селектор не попадают, плейсхолдера при подсвеченном активном нет.
    expect(screen.queryByRole('option', { name: 'Поездка в Лиссабон' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Чат не выбран' })).not.toBeInTheDocument()
  })

  it('активный чат вне списка не подсвечивает первый пункт — виден плейсхолдер', async () => {
    const api = createFakeApi([])
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    const reader = await api['conversations:create']({ title: 'Reader', assistantKind: 'web-recorder' })
    await api['conversations:create']({ title: 'Обычный' })
    // Ответ выбора reader-чата задержан: активным пока остаётся обычный чат.
    const realGet = api['conversations:get']
    const addMessage = vi.spyOn(api, 'messages:add')
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    api['conversations:get'] = async (arg) => {
      if (arg.id === reader.id) await gate
      return realGet(arg)
    }
    window.location.hash = '#/web-reader'
    render(<App api={api} delays={SLOW} />)

    await screen.findByRole('option', { name: 'Reader' })
    const select = screen.getByLabelText('Разговор Web Reader')
    expect(select).toHaveValue('')
    expect(screen.getByRole('option', { name: 'Чат не выбран' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Открываем выбранный Reader-разговор…')
    // Старый ChatColumn не остаётся интерактивным под уже изменившимся Reader URL.
    expect(screen.queryByPlaceholderText(/Напишите сообщение/)).not.toBeInTheDocument()
    expect(screen.queryByTitle('Web Reader')).not.toBeInTheDocument()

    release()
    await waitFor(() => expect(select).toHaveValue(reader.id))
    expect(screen.queryByRole('option', { name: 'Чат не выбран' })).not.toBeInTheDocument()
    const composer = screen.getByPlaceholderText(/Напишите сообщение/)
    expect(composer).toBeInTheDocument()
    expect(screen.getByTitle('Web Reader')).toBeInTheDocument()

    await userEvent.type(composer, 'Сообщение Reader{enter}')
    await waitFor(() => expect(addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: reader.id, text: 'Сообщение Reader' })
    ))
  })

  it('«+ Новый» детерминированно открывает созданный чат, устаревший ответ не возвращает старый', async () => {
    const api = createFakeApi([])
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    const first = await api['conversations:create']({ title: 'Первый ридер', assistantKind: 'web-recorder' })
    const second = await api['conversations:create']({ title: 'Второй ридер', assistantKind: 'web-recorder' })
    // Клик по старому чату, ответ которого искусственно задержан…
    const realGet = api['conversations:get']
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    api['conversations:get'] = async (arg) => {
      if (arg.id === first.id) await gate
      return realGet(arg)
    }
    window.location.hash = `#/web-reader/${second.id}`
    render(<App api={api} delays={SLOW} />)
    const select = await screen.findByLabelText('Разговор Web Reader')
    await waitFor(() => expect(select).toHaveValue(second.id))
    await userEvent.selectOptions(select, first.id)

    // …и сразу «+ Новый»: должен открыться именно созданный чат.
    await userEvent.click(screen.getByRole('button', { name: '+ Новый' }))
    const created = await waitFor(() => {
      const conv = api._state.conversations.find((c) => c.title === 'Web Reader 1')
      expect(conv).toBeDefined()
      return conv!
    })
    await waitFor(() => expect(window.location.hash).toBe(`#/web-reader/${created.id}`))

    // Отложенный устаревший ответ старого чата не перетирает выбор.
    release()
    await waitFor(() => expect(select).toHaveValue(created.id))
    expect(window.location.hash).toBe(`#/web-reader/${created.id}`)
  })

  it('переключает Reader по URL при навигации назад и вперёд', async () => {
    const { api } = await seededApi()
    const first = await api['conversations:create']({ title: 'Reader 1', assistantKind: 'web-recorder' })
    const second = await api['conversations:create']({ title: 'Reader 2', assistantKind: 'web-recorder' })
    window.location.hash = `#/web-reader/${first.id}`
    render(<App api={api} delays={SLOW} />)
    await screen.findByTitle('Web Reader')

    window.location.hash = `#/web-reader/${second.id}`
    await waitFor(() => expect(screen.getByLabelText('Разговор Web Reader')).toHaveValue(second.id))
    window.location.hash = `#/web-reader/${first.id}`
    await waitFor(() => expect(screen.getByLabelText('Разговор Web Reader')).toHaveValue(first.id))
  })
})

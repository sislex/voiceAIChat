import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { createFakeApi, type FakeApi } from './test/fakeApi'
import { DEFAULT_SETTINGS } from '@shared/types'

const SLOW = { frame: 100_000, transcribe: 100_000, think: 100_000, speak: 100_000 }

// Раздел «Проекты» — одна страница проекта: общая шапка (имя + вкладки «Канбан»
// и «Настройки») и переключаемое содержимое. Страницы-списка проектов нет:
// #/projects без id уводит на первый проект, выбор и создание — в сайдбаре.
// Между тестами сбрасываем hash — иначе маршрут протекает в соседние кейсы и
// ломает их (там ожидается чат).
afterEach(() => {
  window.location.hash = ''
  delete (window as { session?: unknown }).session
})

async function renderApp(): Promise<FakeApi> {
  const api = createFakeApi([])
  await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
  render(<App api={api} delays={SLOW} />)
  return api
}

async function renderWithProject(): Promise<{ api: FakeApi; projectId: string }> {
  const api = createFakeApi([])
  await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
  const p = await api['projects:create']({ name: 'Мой проект' })
  render(<App api={api} delays={SLOW} />)
  return { api, projectId: p.id }
}

const tabs = (): HTMLElement => screen.getByRole('tablist', { name: 'Разделы проекта' })

/** Переключатель списка и «+ Проект» в сайдбаре есть только в web-режиме (мост сессии). */
function installSession(): void {
  ;(window as { session?: unknown }).session = {
    login: async () => ({ name: 'admin', role: 'admin' as const }),
    me: async () => ({ name: 'admin', role: 'admin' as const }),
    logout: async () => {}
  }
}

describe('App — страница проекта по URL', () => {
  it('#/projects/:id — страница с общей шапкой, вкладками и канбаном, без крестика', async () => {
    const { projectId } = await renderWithProject()
    window.location.hash = `#/projects/${projectId}`
    const page = await screen.findByTestId('project-page')
    // Полная страница: контейнер .toolpage, без модального оверлея .ovl.
    expect(page.closest('.toolpage')).not.toBeNull()
    expect(page.closest('.ovl')).toBeNull()
    expect(within(page).getByRole('heading', { name: 'Мой проект' })).toBeInTheDocument()
    expect(within(tabs()).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Канбан', 'Настройки'])
    await waitFor(() => expect(within(page).getByTestId('kanban-board')).toBeInTheDocument())
    // Уходят со страницы навигацией: крестика в шапке нет.
    expect(within(page).queryByRole('button', { name: 'Закрыть' })).not.toBeInTheDocument()
    expect(within(page).getByRole('button', { name: 'Открыть меню' })).toBeInTheDocument()
  })

  it('вкладки меняют только содержимое: шапка и имя проекта остаются на месте', async () => {
    const { projectId } = await renderWithProject()
    window.location.hash = `#/projects/${projectId}`
    const page = await screen.findByTestId('project-page')
    await waitFor(() => expect(within(page).getByTestId('kanban-board')).toBeInTheDocument())

    await userEvent.click(within(tabs()).getByRole('tab', { name: 'Настройки' }))
    await waitFor(() => expect(window.location.hash).toBe(`#/projects/${projectId}/settings`))
    expect(await screen.findByTestId('project-settings')).toBeInTheDocument()
    expect(screen.queryByTestId('kanban-board')).not.toBeInTheDocument()
    // Шапка та же: страница не перерисовалась заново, имя и вкладки на месте.
    expect(screen.getByTestId('project-page')).toBe(page)
    expect(within(page).getByRole('heading', { name: 'Мой проект' })).toBeInTheDocument()
    expect(within(tabs()).getByRole('tab', { name: 'Настройки' })).toHaveAttribute('aria-selected', 'true')

    await userEvent.click(within(tabs()).getByRole('tab', { name: 'Канбан' }))
    await waitFor(() => expect(window.location.hash).toBe(`#/projects/${projectId}`))
    expect(await screen.findByTestId('kanban-board')).toBeInTheDocument()
    expect(screen.queryByTestId('project-settings')).not.toBeInTheDocument()
  })

  it('#/projects/:id/settings открывается по прямой ссылке — с той же шапкой', async () => {
    const { projectId } = await renderWithProject()
    window.location.hash = `#/projects/${projectId}/settings`
    const page = await screen.findByTestId('project-page')
    expect(await screen.findByTestId('project-settings')).toBeInTheDocument()
    expect(within(page).getByRole('heading', { name: 'Мой проект' })).toBeInTheDocument()
    expect(within(tabs()).getByRole('tab', { name: 'Настройки' })).toHaveAttribute('aria-selected', 'true')
  })

  it('#/projects/:id/task/:taskId открывает карточку, Esc закрывает её и оставляет страницу', async () => {
    const { api, projectId } = await renderWithProject()
    const board = await api['board:get']({ id: projectId })
    const task = await api['tasks:create']({ projectId, columnId: board.columns[0]!.id, title: 'Задача из чата' })
    window.location.hash = `#/projects/${projectId}/task/${task.id}`

    const modal = await screen.findByTestId('task-modal')
    expect(within(modal).getByLabelText('Заголовок задачи')).toHaveValue('Задача из чата')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('task-modal')).not.toBeInTheDocument())
    expect(screen.getByTestId('project-page')).toBeInTheDocument()
    expect(screen.getByTestId('kanban-board')).toBeInTheDocument()
  })
})

describe('App — завершённые задачи скрыты с доски', () => {
  /** Проект с задачей в «Готово» и порогом 0 («убрать в конце дня»). */
  async function withCompleted(): Promise<{ api: FakeApi; projectId: string; taskId: string }> {
    const api = createFakeApi([])
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    const p = await api['projects:create']({ name: 'Мой проект' })
    const board = await api['board:get']({ id: p.id })
    const done = board.columns.find((c) => c.semanticType === 'done')!
    const task = await api['tasks:create']({ projectId: p.id, columnId: board.columns[0]!.id, title: 'Завершённая' })
    await api['tasks:move']({ projectId: p.id, taskId: task.id, columnId: done.id })
    await api['projects:update']({ id: p.id, doneRetentionDays: 0 })
    // День завершения прошёл: при пороге 0 карточка держится на доске до его конца.
    api._advanceDays(1)
    render(<App api={api} delays={SLOW} />)
    return { api, projectId: p.id, taskId: task.id }
  }

  it('«Показать завершённые» запрашивает доску целиком и возвращает карточку', async () => {
    const { projectId } = await withCompleted()
    window.location.hash = `#/projects/${projectId}`
    await screen.findByTestId('kanban-board')
    expect(screen.queryByText('Завершённая')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('checkbox', { name: /Показать завершённые/ }))
    expect(await screen.findByText('Завершённая')).toBeInTheDocument()
  })

  it('прямая ссылка на скрытую задачу открывает её карточку', async () => {
    const { projectId, taskId } = await withCompleted()
    window.location.hash = `#/projects/${projectId}/task/${taskId}`
    const modal = await screen.findByTestId('task-modal')
    expect(within(modal).getByLabelText('Заголовок задачи')).toHaveValue('Завершённая')
    // Доска подтянула завершённые целиком — переключатель это показывает.
    expect(screen.getByRole('checkbox', { name: /Показать завершённые/ })).toBeChecked()
  })

  it('порог скрытия правится в настройках проекта', async () => {
    const { api, projectId } = await withCompleted()
    window.location.hash = `#/projects/${projectId}/settings`
    // Настройки проекта разбиты на вкладки — порог живёт на «Доске».
    await userEvent.click(await screen.findByRole('tab', { name: 'Доска' }))
    const input = await screen.findByLabelText('Скрывать завершённые через, дней')
    await userEvent.clear(input)
    await userEvent.type(input, '30')
    await userEvent.tab()
    await waitFor(async () => expect((await api['projects:get']({ id: projectId }))!.doneRetentionDays).toBe(30))
  })
})

describe('App — чаты завершённых задач в сайдбаре', () => {
  /** Проект с задачей в «Готово» и её чатом; сайдбар уже сужен этим проектом. */
  async function withDoneTaskChat(): Promise<{ api: FakeApi; projectId: string; taskId: string; chatId: string }> {
    const api = createFakeApi([])
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    const p = await api['projects:create']({ name: 'Мой проект' })
    const board = await api['board:get']({ id: p.id })
    const done = board.columns.find((c) => c.semanticType === 'done')!
    const task = await api['tasks:create']({ projectId: p.id, columnId: board.columns[0]!.id, title: 'Скролл' })
    const chat = await api['tasks:openChat']({ projectId: p.id, taskId: task.id })
    await api['tasks:move']({ projectId: p.id, taskId: task.id, columnId: done.id })
    render(<App api={api} delays={SLOW} />)
    return { api, projectId: p.id, taskId: task.id, chatId: chat.id }
  }

  /** Список бесед сайдбара, суженный проектом (селект над поиском). */
  async function chatList(): Promise<HTMLElement> {
    await userEvent.selectOptions(await screen.findByLabelText('Проект'), 'Мой проект')
    return await screen.findByRole('list', { name: 'Беседы' })
  }

  it('чат задачи из «Готово» скрыт, иконка-фильтр его возвращает', async () => {
    await withDoneTaskChat()
    const list = await chatList()
    await waitFor(() => expect(within(list).queryByText('Задача Скролл')).not.toBeInTheDocument())

    const filter = screen.getByRole('button', { name: 'Показывать чаты завершённых задач' })
    await userEvent.click(filter)
    expect(await within(list).findByText('Задача Скролл')).toBeInTheDocument()
    expect(filter).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(filter)
    await waitFor(() => expect(within(list).queryByText('Задача Скролл')).not.toBeInTheDocument())
  })

  it('прямая ссылка открывает скрытый чат и показывает его строку', async () => {
    const { chatId } = await withDoneTaskChat()
    window.location.hash = `#/chat/${chatId}`
    const list = await screen.findByRole('list', { name: 'Беседы' })
    const row = await within(list).findByRole('button', { name: 'Задача Скролл' })
    expect(row).toHaveAttribute('aria-current', 'true')
  })

  it('«Открыть чат» на карточке завершённой задачи ведёт в её чат', async () => {
    const { projectId, taskId, chatId } = await withDoneTaskChat()
    window.location.hash = `#/projects/${projectId}/task/${taskId}`
    const modal = await screen.findByTestId('task-modal')
    await userEvent.click(within(modal).getAllByRole('button', { name: /Открыть чат/ })[0]!)
    await waitFor(() => expect(window.location.hash).toBe(`#/chat/${chatId}`))
  })

  it('возврат задачи из «Готово» возвращает чат в список', async () => {
    const { api, projectId, taskId } = await withDoneTaskChat()
    const list = await chatList()
    await waitFor(() => expect(within(list).queryByText('Задача Скролл')).not.toBeInTheDocument())

    const board = await api['board:get']({ id: projectId, includeCompleted: true })
    const dev = board.columns.find((c) => c.semanticType !== 'done')!
    await api['tasks:move']({ projectId, taskId, columnId: dev.id })
    // Перечитываем список тем же путём, что и UI, — переключением фильтра туда-обратно.
    const filter = screen.getByRole('button', { name: 'Показывать чаты завершённых задач' })
    await userEvent.click(filter)
    await userEvent.click(filter)
    expect(await within(list).findByText('Задача Скролл')).toBeInTheDocument()
  })
})

describe('App — вход в раздел «Проекты»', () => {
  it('#/projects без id не показывает список: уводит на первый проект', async () => {
    const api = createFakeApi([])
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    const first = await api['projects:create']({ name: 'Первый' })
    await api['projects:create']({ name: 'Второй' })
    window.location.hash = '#/projects'
    render(<App api={api} delays={SLOW} />)

    await waitFor(() => expect(window.location.hash).toBe(`#/projects/${first.id}`))
    const page = await screen.findByTestId('project-page')
    expect(within(page).getByRole('heading', { name: 'Первый' })).toBeInTheDocument()
    await waitFor(() => expect(within(page).getByTestId('kanban-board')).toBeInTheDocument())
  })

  it('проектов нет: #/projects показывает пустое состояние без формы создания', async () => {
    window.location.hash = '#/projects'
    await renderApp()
    const page = await screen.findByTestId('projects-empty')
    expect(within(page).getByText('Проектов пока нет')).toBeInTheDocument()
    expect(screen.queryByLabelText('Название нового проекта')).not.toBeInTheDocument()
    // Редиректу некуда вести — адрес остаётся прежним.
    await new Promise((r) => setTimeout(r, 50))
    expect(window.location.hash).toBe('#/projects')
  })

  it('проекта из адреса нет: понятное сообщение вместо пустой доски', async () => {
    await renderWithProject()
    window.location.hash = '#/projects/ghost-project-id'
    const page = await screen.findByTestId('project-not-found')
    expect(within(page).getByRole('alert')).toHaveTextContent('Проект не найден')
    expect(screen.queryByTestId('kanban-board')).not.toBeInTheDocument()
  })

  it('клик «Проекты» в переключателе сайдбара открывает страницу первого проекта', async () => {
    const api = createFakeApi([])
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    const first = await api['projects:create']({ name: 'Первый' })
    installSession()
    render(<App api={api} delays={SLOW} />)

    const modes = await screen.findByRole('group', { name: 'Тип списка' })
    await userEvent.click(within(modes).getByRole('button', { name: 'Проекты' }))
    await waitFor(() => expect(window.location.hash).toBe(`#/projects/${first.id}`))
    const page = await screen.findByTestId('project-page')
    expect(within(page).getByRole('heading', { name: 'Первый' })).toBeInTheDocument()
  })

  it('«+ Проект» в сайдбаре открывает страницу созданного проекта', async () => {
    window.location.hash = '#/projects'
    installSession()
    await renderApp()
    expect(await screen.findByTestId('projects-empty')).toBeInTheDocument()

    await userEvent.click(await screen.findByRole('button', { name: '+ Проект' }))
    await userEvent.type(screen.getByLabelText('Название нового проекта'), 'Свежий{enter}')
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/projects\/.+/))
    const page = await screen.findByTestId('project-page')
    expect(within(page).getByRole('heading', { name: 'Свежий' })).toBeInTheDocument()
    // Проект уже в списке — «не найден» не мигает.
    expect(screen.queryByTestId('project-not-found')).not.toBeInTheDocument()
  })
})

describe('App — удаление проекта из его настроек', () => {
  it('уводит на другой доступный проект, а не на удалённую страницу-список', async () => {
    const api = createFakeApi([])
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    const first = await api['projects:create']({ name: 'Первый' })
    const second = await api['projects:create']({ name: 'Второй' })
    window.location.hash = `#/projects/${second.id}/settings`
    render(<App api={api} delays={SLOW} />)

    const settings = await screen.findByTestId('project-settings')
    await userEvent.click(within(settings).getByRole('button', { name: 'Удалить проект' }))
    await userEvent.click(within(settings).getByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(window.location.hash).toBe(`#/projects/${first.id}`))
    const page = await screen.findByTestId('project-page')
    expect(within(page).getByRole('heading', { name: 'Первый' })).toBeInTheDocument()
  })

  it('последний проект удалён — пустое состояние, а не страница удалённого проекта', async () => {
    const { projectId } = await renderWithProject()
    window.location.hash = `#/projects/${projectId}/settings`

    const settings = await screen.findByTestId('project-settings')
    await userEvent.click(within(settings).getByRole('button', { name: 'Удалить проект' }))
    await userEvent.click(within(settings).getByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(window.location.hash).toBe('#/projects'))
    expect(await screen.findByTestId('projects-empty')).toBeInTheDocument()
  })
})

describe('App — упавший вызов моста показывается тостом', () => {
  it('ошибка загрузки доски даёт тост с текстом и «Повторить»', async () => {
    const api = createFakeApi([])
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    const project = await api['projects:create']({ name: 'Мой проект' })
    // Первый запрос доски падает, повтор проходит: раньше на странице проектов
    // не было видно вообще ничего — ни ошибки, ни доски.
    const realBoard = api['board:get']
    let broken = true
    api['board:get'] = async (input) => {
      if (!broken) return realBoard(input)
      broken = false
      throw new Error('Сервер недоступен')
    }
    window.location.hash = `#/projects/${project.id}`
    render(<App api={api} delays={SLOW} />)

    const toast = await screen.findByTestId('toast-error')
    expect(toast).toHaveTextContent('Сервер недоступен')
    await userEvent.click(within(toast).getByRole('button', { name: 'Повторить' }))

    const page = await screen.findByTestId('project-page')
    await waitFor(() => expect(within(page).getByTestId('kanban-board')).toBeInTheDocument())
  })
})

// Виджет задачи (`TaskChatHeader`) — свойство открытого чата: он рисуется только
// когда контекст относится к активному чату (`conversationId`). Раньше контекст
// чистила лишь загрузка чата, и в новом разговоре оставался виджет прошлого.
describe('App — виджет задачи только в своём чате', () => {
  /** Проект с задачей и её чатом; чат открыт по адресу. */
  async function withTaskChat(patch?: (api: FakeApi) => void): Promise<{ api: FakeApi; chatId: string }> {
    const api = createFakeApi([])
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    const p = await api['projects:create']({ name: 'Мой проект' })
    const board = await api['board:get']({ id: p.id })
    const task = await api['tasks:create']({ projectId: p.id, columnId: board.columns[0]!.id, title: 'Скролл' })
    const chat = await api['tasks:openChat']({ projectId: p.id, taskId: task.id })
    patch?.(api)
    window.location.hash = `#/chat/${chat.id}`
    render(<App api={api} delays={SLOW} />)
    return { api, chatId: chat.id }
  }

  it('«+ Новый» убирает виджет задачи, лента остаётся', async () => {
    await withTaskChat()
    expect(await screen.findByTestId('task-chat-header')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '+ Новый' }))
    await waitFor(() => expect(screen.queryByTestId('task-chat-header')).not.toBeInTheDocument())
    expect(screen.getByTestId('scroll')).toBeInTheDocument()
  })

  it('контекст другого чата не рисуется, даже если доехал до стора', async () => {
    let answered = false
    await withTaskChat((api) => {
      const real = api['conversations:taskContext']
      api['conversations:taskContext'] = async (arg) => {
        const ctx = await real(arg)
        answered = true
        // Ответ на запрос по уже закрытому чату: контекст принадлежит не ему.
        return ctx && { ...ctx, conversationId: 'чужой-чат' }
      }
    })
    await waitFor(() => expect(answered).toBe(true))
    expect(await screen.findByTestId('scroll')).toBeInTheDocument()
    expect(screen.queryByTestId('task-chat-header')).not.toBeInTheDocument()
  })
})

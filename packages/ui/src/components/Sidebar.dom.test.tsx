import { describe, it, expect, vi } from 'vitest'
import { expectLabelledIconButtons, expectNoViolations } from '../test/a11y'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar, type MessageSearchView } from './Sidebar'
import type { Conversation, MessageSearchHit, PermissionMode, SessionUser } from '@shared/types'
import type { AgentInfo } from '@shared/agentProtocol'
import type { TaskChatBadge } from '@shared/projects'
import type { CiRunSummary } from '@shared/ci'

function conv(id: string, title: string, permissionMode: PermissionMode | null = null): Conversation {
  return { id, title, updatedAt: 1, messageCount: 2, execTarget: null, lastExecTarget: id === 'c1' ? 'm1' : 'none', status: id === 'c1' ? 'developing' : 'planned', permissionMode } as Conversation
}

function setup(overrides: Record<string, unknown> = {}) {
  const props = {
    conversations: [conv('c1', 'Чат 1', 'plan'), conv('c2', 'Чат 2', 'acceptEdits')],
    activeId: 'c1',
    now: 1,
    onNew: vi.fn(),
    onPick: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    searchQuery: '',
    onSearch: vi.fn(),
    onOpenObserver: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides
  }
  render(<Sidebar {...props} />)
  return props
}

describe('Sidebar — фильтр «чаты завершённых задач»', () => {
  it('иконка-фильтр над списком переключает флаг и показывает нажатое состояние', async () => {
    const onShowDoneTaskChatsChange = vi.fn()
    setup({ onShowDoneTaskChatsChange })
    const filter = screen.getByRole('button', { name: 'Показывать чаты завершённых задач' })
    expect(filter).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(filter)
    expect(onShowDoneTaskChatsChange).toHaveBeenCalledWith(true)
  })

  it('включённый фильтр гасится тем же кликом', async () => {
    const onShowDoneTaskChatsChange = vi.fn()
    setup({ showDoneTaskChats: true, onShowDoneTaskChatsChange })
    const filter = screen.getByRole('button', { name: 'Показывать чаты завершённых задач' })
    expect(filter).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(filter)
    expect(onShowDoneTaskChatsChange).toHaveBeenCalledWith(false)
  })

  it('без колбэка кнопки нет — desktop живёт без фильтра', () => {
    setup()
    expect(screen.queryByRole('button', { name: 'Показывать чаты завершённых задач' })).not.toBeInTheDocument()
  })
})

describe('Sidebar — статус работы чата', () => {
  it('в простое показывает режим чата серым словом без точки и без селекта', () => {
    setup({ workingIds: [] })
    expect(screen.getByText('план')).toBeInTheDocument()
    expect(screen.getByText('разработка')).toBeInTheDocument()
    expect(document.querySelectorAll('.cstatus.on')).toHaveLength(0)
    expect(document.querySelectorAll('.cstatus-dot')).toHaveLength(0)
    // Селектор жизненного цикла «разрабатывается»/«планируется» из карточки убран.
    expect(screen.queryByLabelText(/Статус разговора/)).not.toBeInTheDocument()
    expect(screen.queryByText('разрабатывается')).not.toBeInTheDocument()
  })

  it('во время хода пульсирует точкой и пишет «идет <режим>»', () => {
    setup({ workingIds: ['c1', 'c2'] })
    expect(screen.getByText('идет план')).toBeInTheDocument()
    expect(screen.getByText('идет разработка')).toBeInTheDocument()
    expect(document.querySelectorAll('.cstatus.on')).toHaveLength(2)
    expect(document.querySelectorAll('.cstatus.on .cstatus-dot')).toHaveLength(2)
  })

  it('чат без задачи в режиме полного доступа подписан «чат»', () => {
    setup({ conversations: [conv('c3', 'Чат 3')], workingIds: [], defaultPermissionMode: 'bypassPermissions' })
    expect(document.querySelector('.cstatus')).toHaveTextContent('чат')
  })

  it('чат задачи в режиме полного доступа подписан «задача»', () => {
    const taskChat = conv('c3', 'Чат 3', 'bypassPermissions')
    taskChat.taskId = 't3'
    setup({ conversations: [taskChat], workingIds: [] })
    expect(document.querySelector('.cstatus')).toHaveTextContent('задача')
  })

  it('полный доступ пульсирует как «идет чат» или «идет задача» по taskId', () => {
    const taskChat = conv('c4', 'Чат задачи', 'bypassPermissions')
    taskChat.taskId = 't4'
    setup({ conversations: [conv('c3', 'Чат 3', 'bypassPermissions'), taskChat], workingIds: ['c3', 'c4'] })
    expect(screen.getByText('идет чат')).toBeInTheDocument()
    expect(screen.getByText('идет задача')).toBeInTheDocument()
  })
})


describe('Sidebar — машина последнего сообщения', () => {
  const agent = {
    id: 'm1',
    name: 'MacBook',
    online: true,
    createdAt: 1,
    lastSeen: 1,
    policy: { allowedDirs: [], allowNetwork: true, allowWrite: true, denyPatterns: [], allowPatterns: [], skills: [] }
  } as AgentInfo

  it('показывает read-only машину последнего сообщения без списков выбора', () => {
    setup({ agents: [agent] })

    expect(screen.getByText('Последнее: MacBook')).toBeInTheDocument()
    expect(screen.getByText('Последнее: Без машины')).toBeInTheDocument()
    expect(screen.queryByLabelText(/машин/i)).not.toBeInTheDocument()
  })
})


describe('Sidebar — инструменты в меню по клику на пользователя', () => {
  const user = { name: 'Алекс', role: 'admin' } as SessionUser

  it('иконки виджетов лежат в меню аккаунта, а не в отдельном ряду', () => {
    const onOpenObserver = vi.fn()
    setup({
      currentUser: user,
      onOpenObserver,
      onOpenKnowledgeBase: vi.fn(),
        onOpenFiles: vi.fn(),
      onOpenConsole: vi.fn(),
      onOpenMachines: vi.fn(),
      onOpenUsers: vi.fn(),
      onLogout: vi.fn()
    })

    // Отдельного нижнего ряда иконок больше нет.
    expect(document.querySelector('.foottools')).toBeNull()
    // До клика меню (и его пункты) не отрисованы.
    expect(screen.queryByText('История LLM')).not.toBeInTheDocument()

    // Клик по пользователю открывает всплывающее меню с инструментами.
    fireEvent.click(screen.getByRole('button', { name: /Алекс/ }))
    const menu = screen.getByRole('menu')
    for (const label of ['История LLM', 'База знаний', 'Проводник', 'Консоль']) {
      expect(within(menu).getByText(label)).toBeInTheDocument()
    }
    // Управление и настройки — там же.
    expect(within(menu).getByText('Машины')).toBeInTheDocument()
    expect(within(menu).getByText('Настройки')).toBeInTheDocument()

    // Пункт-инструмент кликабелен и вызывает свой обработчик.
    fireEvent.click(within(menu).getByText('История LLM'))
    expect(onOpenObserver).toHaveBeenCalledTimes(1)
  })

  it('в локальном режиме без учётки инструменты остаются рядом иконок', () => {
    setup({ onOpenFiles: vi.fn(), onOpenConsole: vi.fn() })
    expect(document.querySelector('.foottools')).not.toBeNull()
    expect(screen.getByLabelText('История LLM')).toBeInTheDocument()
    expect(screen.getByLabelText('Открыть консоль')).toBeInTheDocument()
  })
})

// Выбор проекта и создание нового живут только здесь: страницы-списка проектов
// нет, а «Проекты» в переключателе открывают страницу первого проекта (адрес
// считает App, сайдбар лишь сообщает о переключении режима).
describe('Sidebar — режим «Проекты»', () => {
  const projects = [
    { id: 'p1', name: 'Альфа', role: 'owner' },
    { id: 'p2', name: 'Бета', role: 'member' }
  ] as never[]

  it('без onModeChange переключателя нет, список чатов как раньше', () => {
    setup({ projects })
    expect(screen.queryByRole('group', { name: 'Тип списка' })).not.toBeInTheDocument()
    expect(screen.getByText('Чат 1')).toBeInTheDocument()
  })

  it('переключатель показывает проекты с ролями, клик по проекту открывает его страницу', async () => {
    const onPickProject = vi.fn()
    const onModeChange = vi.fn()
    setup({ projects, mode: 'projects', onModeChange, onPickProject, activeProjectId: 'p2' })
    // Список чатов и его поиск скрыты, вместо них — проекты.
    expect(screen.queryByText('Чат 1')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Поиск по разговорам')).not.toBeInTheDocument()
    expect(screen.getByText('Альфа')).toBeInTheDocument()
    expect(screen.getByText('владелец')).toBeInTheDocument()
    expect(screen.getByText('участник')).toBeInTheDocument()
    // Активный проект подсвечен.
    expect(screen.getByText('Бета').closest('button')?.className).toContain('on')
    fireEvent.click(screen.getByText('Альфа'))
    expect(onPickProject).toHaveBeenCalledWith('p1')
    // Возврат к чатам через сегмент.
    fireEvent.click(within(screen.getByRole('group', { name: 'Тип списка' })).getByRole('button', { name: 'Чаты' }))
    expect(onModeChange).toHaveBeenCalledWith('chats')
  })

  it('«+ Проект» раскрывает инлайн-форму, Enter создаёт проект', async () => {
    const onCreateProject = vi.fn()
    setup({ projects: [], mode: 'projects', onModeChange: vi.fn(), onCreateProject })
    expect(screen.getByText('Проектов пока нет')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '+ Проект' }))
    const input = screen.getByLabelText('Название нового проекта')
    fireEvent.change(input, { target: { value: '  Новый проект  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCreateProject).toHaveBeenCalledWith('Новый проект')
    // Форма закрылась.
    expect(screen.queryByLabelText('Название нового проекта')).not.toBeInTheDocument()
  })
})

describe('Sidebar — режим поиска «Сообщения»', () => {
  const hit = (id: string, snippet: string, over: Partial<MessageSearchHit> = {}): MessageSearchHit => ({
    messageId: id,
    conversationId: `c-${id}`,
    conversationTitle: `Беседа ${id}`,
    projectId: null,
    role: 'u1',
    createdAt: 1,
    time: '12:00',
    snippet,
    score: -1,
    ...over
  })
  const view = (over: Partial<MessageSearchView> = {}): MessageSearchView => ({
    query: 'миграция',
    status: 'ready',
    hits: [],
    nextCursor: null,
    loadingMore: false,
    error: null,
    ...over
  })

  it('переключатель области сообщает о смене режима', () => {
    const onSearchScopeChange = vi.fn()
    setup({ onSearchScopeChange })

    expect(screen.getByLabelText('Поиск по разговорам')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Сообщения' }))
    expect(onSearchScopeChange).toHaveBeenCalledWith('messages')
  })

  it('в режиме сообщений меняется подпись поля, а список бесед уступает место результатам', () => {
    setup({
      onSearchScopeChange: vi.fn(),
      searchScope: 'messages',
      messageSearch: view({ status: 'idle', query: '' })
    })

    expect(screen.getByLabelText('Поиск по сообщениям')).toBeInTheDocument()
    expect(screen.queryByText('Чат 1')).not.toBeInTheDocument()
  })

  it('без запроса показывает подсказку про синтаксис', () => {
    setup({ onSearchScopeChange: vi.fn(), searchScope: 'messages', messageSearch: view({ status: 'idle', query: '' }) })
    expect(screen.getByText(/последнее слово ищется по началу/i)).toBeInTheDocument()
  })

  it('во время запроса показывает скелетоны', () => {
    setup({ onSearchScopeChange: vi.fn(), searchScope: 'messages', messageSearch: view({ status: 'loading' }) })
    expect(screen.getAllByTestId('msgfound-skeleton')).toHaveLength(3)
  })

  it('пустой результат — «Ничего не найдено»', () => {
    setup({ onSearchScopeChange: vi.fn(), searchScope: 'messages', messageSearch: view({ hits: [] }) })
    expect(screen.getByText('Ничего не найдено')).toBeInTheDocument()
  })

  it('ошибка показывается с кнопкой «Повторить»', () => {
    const onRetryMessageSearch = vi.fn()
    setup({
      onSearchScopeChange: vi.fn(),
      searchScope: 'messages',
      messageSearch: view({ status: 'error', error: 'сервер недоступен' }),
      onRetryMessageSearch
    })

    expect(screen.getByRole('alert')).toHaveTextContent('сервер недоступен')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(onRetryMessageSearch).toHaveBeenCalled()
  })

  it('карточка: заголовок, дата, роль и подсветка совпадения; клик открывает сообщение', () => {
    const onPickMessage = vi.fn()
    const found = hit('m1', 'обсудили <mark>миграцию</mark> канбана')
    setup({
      onSearchScopeChange: vi.fn(),
      searchScope: 'messages',
      messageSearch: view({ hits: [found, hit('m2', 'ещё про <mark>миграцию</mark>', { role: 'ai' })] }),
      onPickMessage
    })

    const card = screen.getByText('Беседа m1').closest('button')!
    expect(card).toHaveTextContent('обсудили миграцию канбана')
    expect(within(card as HTMLElement).getByText('миграцию').tagName).toBe('MARK')
    expect(card).toHaveTextContent('Вы')
    expect(screen.getByText('Беседа m2').closest('button')).toHaveTextContent('Модель')

    fireEvent.click(card as HTMLElement)
    expect(onPickMessage).toHaveBeenCalledWith(found)
  })

  it('разметка из текста сообщения остаётся текстом, а не HTML', () => {
    setup({
      onSearchScopeChange: vi.fn(),
      searchScope: 'messages',
      messageSearch: view({ hits: [hit('m1', '<img src=x onerror=alert(1)> <mark>миграция</mark>')] })
    })

    expect(document.querySelector('.msgfound-snippet img')).toBeNull()
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument()
  })

  it('«Показать ещё» появляется при курсоре и блокируется на время догрузки', () => {
    const onLoadMoreMessages = vi.fn()
    setup({
      onSearchScopeChange: vi.fn(),
      searchScope: 'messages',
      messageSearch: view({ hits: [hit('m1', '<mark>миграция</mark>')], nextCursor: 'c1' }),
      onLoadMoreMessages
    })
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))
    expect(onLoadMoreMessages).toHaveBeenCalled()
  })

  it('во время догрузки кнопка заблокирована', () => {
    setup({
      onSearchScopeChange: vi.fn(),
      searchScope: 'messages',
      messageSearch: view({ hits: [hit('m1', '<mark>миграция</mark>')], nextCursor: 'c1', loadingMore: true }),
      onLoadMoreMessages: vi.fn()
    })
    expect(screen.getByRole('button', { name: 'Загружаем…' })).toBeDisabled()
  })
})

describe('Sidebar — состояния списка бесед', () => {
  it('первая загрузка показывает скелетоны вместо пустого списка', () => {
    setup({ conversations: [], conversationsStatus: 'loading' })
    expect(screen.getAllByTestId('convo-skeleton')).toHaveLength(5)
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument()
  })

  it('повторная загрузка уже показанного списка его не подменяет', () => {
    setup({ conversationsStatus: 'loading' })
    expect(screen.queryByTestId('convo-skeleton')).not.toBeInTheDocument()
    expect(screen.getByText('Чат 1')).toBeInTheDocument()
    expect(screen.getByText('Обновляем список…')).toBeInTheDocument()
  })

  it('пустой список объясняет следующий шаг и предлагает действие', () => {
    const onNew = vi.fn()
    setup({ conversations: [], conversationsStatus: 'ready', onNew })
    expect(screen.getByTestId('empty-state')).toHaveTextContent('Пока нет бесед — начните первую')
    fireEvent.click(screen.getByRole('button', { name: 'Новый разговор' }))
    expect(onNew).toHaveBeenCalledTimes(1)
  })

  it('ошибка загрузки видна и повторяется кнопкой', () => {
    const onRetryConversations = vi.fn()
    setup({
      conversations: [],
      conversationsStatus: 'error',
      conversationsError: 'сервер недоступен',
      onRetryConversations
    })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Не удалось загрузить беседы')
    expect(alert).toHaveTextContent('сервер недоступен')
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }))
    expect(onRetryConversations).toHaveBeenCalledTimes(1)
  })
})


describe('Sidebar — кнопка командной палитры', () => {
  it('рядом с поиском есть «⌘K»/«Ctrl+K», и она открывает палитру', () => {
    const onOpenCommandPalette = vi.fn()
    setup({ onOpenCommandPalette })
    const button = screen.getByRole('button', { name: 'Командная палитра' })
    // Подпись — комбинация платформы: пользователь видит, что нажать.
    expect(button.textContent).toMatch(/⌘K|Ctrl\+K/)
    fireEvent.click(button)
    expect(onOpenCommandPalette).toHaveBeenCalledTimes(1)
  })

  it('без обработчика кнопки нет: в desktop-сборке палитру открывать нечем', () => {
    setup()
    expect(screen.queryByRole('button', { name: 'Командная палитра' })).toBeNull()
  })
})

describe('Sidebar — доступность', () => {
  it('без нарушений axe: список бесед, поиск, статусы', async () => {
    setup({ workingIds: ['c2'], user: { name: 'admin', role: 'admin' } as SessionUser })
    await expectNoViolations()
    expectLabelledIconButtons()
  })

  it('список бесед — role=list, активная помечена aria-current', () => {
    setup()
    const list = screen.getByRole('list', { name: 'Беседы' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Чат 1' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Чат 2' })).not.toHaveAttribute('aria-current')
  })

  it('беседа открывается с клавиатуры: Tab до названия и Enter', async () => {
    const props = setup()
    const title = screen.getByRole('button', { name: 'Чат 2' })
    title.focus()
    await userEvent.keyboard('{Enter}')
    expect(props.onPick).toHaveBeenCalledWith('c2')
  })
})

describe('Sidebar — чаты, связанные с задачами', () => {
  const badge = (over: Partial<TaskChatBadge> = {}): TaskChatBadge => ({
    conversationId: 'c1',
    projectId: 'p1',
    taskId: 't1',
    key: 'VC-42',
    type: 'task',
    columnSemantic: 'development',
    run: null,
    ...over
  })
  const summary = (over: Partial<CiRunSummary> = {}): CiRunSummary => ({
    id: 'run-1',
    taskId: 't1',
    status: 'running',
    slotProgress: { done: 1, total: 4, phase: 'Модель работает' },
    durationMs: null,
    modelActive: true,
    awaitingInput: false,
    ...over
  })
  const row = (id: string): HTMLElement =>
    document.querySelector(`.convo-items [role="listitem"]:nth-child(${id === 'c1' ? 1 : 2})`) as HTMLElement

  it('в строке чата задачи показывает тип, ключ и состояние последнего рана', () => {
    setup({ taskBadges: { c1: badge() }, ciSummaries: { t1: summary({ status: 'awaiting_input', awaitingInput: true }) } })
    expect(screen.getByText('VC-42')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Задача' })).toBeInTheDocument()
    expect(screen.getByText('ждёт ответа')).toBeInTheDocument()
  })

  it('чат задачи отличается от обычного всегда, даже без рана', () => {
    setup({ taskBadges: { c1: badge() } })
    expect(row('c1').className).toContain('convo--task')
    expect(row('c1').className).not.toContain('convo--ci-')
    // Обычный чат не помечен ничем.
    expect(row('c2').className).not.toContain('convo--task')
    expect(screen.queryByText('VC-42')).toBeInTheDocument()
  })

  it.each([
    ['ран идёт — голубая рамка', summary({ status: 'running' }), 'convo--ci-running'],
    ['модель чинит ошибку — красная', summary({ status: 'running', slotProgress: { done: 2, total: 4, phase: 'Модель исправляет ошибку', fixing: true } }), 'convo--ci-fixing'],
    ['ждёт ответа — жёлтая', summary({ status: 'awaiting_input', awaitingInput: true }), 'convo--ci-awaiting'],
    ['упал — красная', summary({ status: 'failed' }), 'convo--ci-failed'],
    ['успех — зелёная', summary({ status: 'success' }), 'convo--ci-done']
  ])('подсвечивает строку как карточку на доске: %s', (_name, run, expected) => {
    setup({ taskBadges: { c1: badge() }, ciSummaries: { t1: run } })
    expect(row('c1').className).toContain(expected)
  })

  it('ручное завершение задачи убирает старую ошибку из строки чата', () => {
    setup({
      taskBadges: { c1: badge({ columnSemantic: 'done' }) },
      ciSummaries: { t1: summary({ status: 'failed', modelActive: false }) }
    })
    expect(row('c1').className).not.toContain('convo--ci-failed')
    expect(screen.queryByText('ошибка')).not.toBeInTheDocument()
    expect(screen.getByText('VC-42')).toBeInTheDocument()
  })

  it('отменённый и пропущенный ран подсветки не дают', () => {
    setup({ taskBadges: { c1: badge() }, ciSummaries: { t1: summary({ status: 'cancelled' }) } })
    expect(row('c1').className).not.toContain('convo--ci-')
  })
})

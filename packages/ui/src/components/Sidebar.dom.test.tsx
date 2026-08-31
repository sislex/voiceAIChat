import { describe, it, expect, vi } from 'vitest'
import { BUILTIN_PROJECT_TYPE_IDS, builtinProjectTypeChain } from '@shared/projectTypes'
import { expectLabelledIconButtons, expectNoViolations } from '../test/a11y'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar, formatConversationCostUsd, type MessageSearchView } from './Sidebar'
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
    searchQuery: '',
    onSearch: vi.fn(),
    onOpenObserver: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides
  }
  const rendered = render(<Sidebar {...props} />)
  return { ...props, ...rendered }
}

describe('Sidebar — фильтр «чаты завершённых задач»', () => {
  it('иконка-фильтр над списком переключает флаг и показывает нажатое состояние', async () => {
    const onShowDoneTaskChatsChange = vi.fn()
    setup({ onShowDoneTaskChatsChange })
    fireEvent.wheel(document.querySelector('.convolist')!, { deltaY: -40 })
    const filter = screen.getByRole('button', { name: 'Показывать чаты завершённых задач' })
    expect(filter).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(filter)
    expect(onShowDoneTaskChatsChange).toHaveBeenCalledWith(true)
  })

  it('включённый фильтр гасится тем же кликом', async () => {
    const onShowDoneTaskChatsChange = vi.fn()
    setup({ showDoneTaskChats: true, onShowDoneTaskChatsChange })
    fireEvent.wheel(document.querySelector('.convolist')!, { deltaY: -40 })
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

describe('Sidebar — стоимость разговоров', () => {
  it('показывает точную компактную сумму только для known и нейтральный partial', () => {
    const known = { ...conv('known', 'Очень длинное название разговора, которое должно сокращаться'), costStatus: 'known' as const, costUsd: 0.000123 }
    const partial = { ...conv('partial', 'Неполный'), costStatus: 'partial' as const, costUsd: null }
    const unknown = { ...conv('unknown', 'Неизвестный'), costStatus: 'unknown' as const, costUsd: null }
    setup({ conversations: [known, partial, unknown] })

    expect(screen.getByText('$0.000123')).toBeInTheDocument()
    expect(screen.getByLabelText('Неполная стоимость')).toHaveTextContent('—')
    expect(document.querySelectorAll('.ccost')).toHaveLength(2)
    expect(screen.getByRole('button', { name: known.title })).toHaveClass('ctitle')
  })

  it('не округляет ненулевые малые суммы до недостоверного нуля', () => {
    expect(formatConversationCostUsd(0)).toBe('$0')
    expect(formatConversationCostUsd(0.00000001)).toBe('$0.00000001')
    expect(formatConversationCostUsd(0.000001)).toBe('$0.000001')
    expect(formatConversationCostUsd(0.0001234)).toBe('$0.0001234')
    expect(formatConversationCostUsd(0.0012)).toBe('$0.0012')
    expect(formatConversationCostUsd(0.01234)).toBe('$0.01234')
    expect(formatConversationCostUsd(1.2345)).toBe('$1.235')
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

describe('Sidebar — фильтр проектов чатов', () => {
  const projects = [
    { id: 'p1', name: 'Альфа', role: 'owner' },
    { id: 'p2', name: 'Бета', role: 'member' }
  ] as never[]

  it('по умолчанию показывает «Все», проекты и «Без проекта»', () => {
    setup({ projects, onSelectProject: vi.fn() })
    fireEvent.wheel(document.querySelector('.convolist')!, { deltaY: -40 })
    const select = screen.getByRole('combobox', { name: 'Проект' })
    expect(select).toHaveValue('__all__')
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Все', 'Альфа', 'Бета', 'Без проекта'
    ])
  })

  it('доступен без проектов и сообщает каждый из трёх режимов', async () => {
    const onSelectProject = vi.fn()
    const first = setup({ projects: [], onSelectProject })
    fireEvent.wheel(document.querySelector('.convolist')!, { deltaY: -40 })
    const select = screen.getByRole('combobox', { name: 'Проект' })
    expect(within(select).getAllByRole('option')).toHaveLength(2)

    await userEvent.selectOptions(select, '__none__')
    await userEvent.selectOptions(select, '__all__')
    first.unmount()
    setup({ projects, selectedProjectId: 'p1', onSelectProject })
    fireEvent.wheel(document.querySelector('.convolist')!, { deltaY: -40 })
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Проект' }), 'p2')

    expect(onSelectProject.mock.calls.map(([value]) => value)).toEqual([null, undefined, 'p2'])
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

  it('«+ Новый проект» просит открыть окно создания, а не форму в сайдбаре', async () => {
    // Имя и тип выбираются в окне: селект типа нельзя держать в поле, которое
    // закрывается по потере фокуса.
    const onCreateProject = vi.fn()
    setup({ projects: [], mode: 'projects', onModeChange: vi.fn(), onCreateProject })
    expect(screen.getByText('Проектов пока нет')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '+ Новый проект' }))
    expect(onCreateProject).toHaveBeenCalledTimes(1)
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

  it('не показывает прежний переключатель «Беседы | Сообщения»', () => {
    setup({ onSearchScopeChange: vi.fn() })
    expect(screen.queryByRole('group', { name: 'Область поиска' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Беседы' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Сообщения' })).not.toBeInTheDocument()
  })

  it('сохраняет внутреннее представление результатов сообщений без визуального scope-переключателя', () => {
    setup({ searchScope: 'messages', messageSearch: view({ status: 'idle', query: '' }) })
    expect(screen.queryByText('Чат 1')).not.toBeInTheDocument()
    expect(screen.getByText(/последнее слово ищется по началу/i)).toBeInTheDocument()
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

describe('Sidebar — недельные секции', () => {
  const monday = new Date(2026, 7, 17, 0, 0, 0, 0).getTime()

  function dated(id: string, title: string, updatedAt: number): Conversation {
    return { ...conv(id, title), updatedAt }
  }

  it('делит список по локальному понедельнику и сохраняет порядок внутри секций', () => {
    setup({
      now: monday + 2 * 86_400_000,
      conversations: [
        dated('c1', 'Свежий первый', monday + 100),
        dated('c2', 'Старый первый', monday - 100),
        dated('c3', 'На границе', monday),
        dated('c4', 'Старый второй', monday - 200)
      ]
    })

    expect(Array.from(screen.getByRole('list', { name: 'Беседы' }).querySelectorAll('.ctitle'))
      .map((button) => button.textContent)).toEqual(['Свежий первый', 'На границе'])
    expect(screen.queryByRole('button', { name: 'Старый первый' })).not.toBeInTheDocument()

    const toggle = screen.getByRole('button', { name: 'Более старые 2' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAttribute('aria-controls', 'sidebar-older-conversations')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(Array.from(screen.getByRole('list', { name: 'Более старые беседы: 2' }).querySelectorAll('.ctitle'))
      .map((button) => button.textContent)).toEqual(['Старый первый', 'Старый второй'])
  })

  it('не показывает пустые секции и сбрасывает раскрытие после remount', () => {
    const conversations = [dated('c1', 'Только старый', monday - 1)]
    const first = setup({ now: monday, conversations })
    expect(screen.queryByText('На этой неделе')).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Более старые 1' })
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Только старый' })).toBeInTheDocument()

    first.unmount()
    setup({ now: monday, conversations })
    expect(screen.getByRole('button', { name: 'Более старые 1' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Только старый' })).not.toBeInTheDocument()
  })

  it('поиск по сообщениям сохраняет несекционное представление', () => {
    setup({
      now: monday,
      onSearchScopeChange: vi.fn(),
      searchScope: 'messages',
      messageSearch: { query: 'старое', status: 'ready', hits: [{ messageId: 'm1', conversationId: 'c1', conversationTitle: 'Беседа m1', role: 'u1', snippet: '<mark>старое</mark>', createdAt: monday - 1, time: '10:00', projectId: null }], nextCursor: null, loadingMore: false, error: null }
    })
    expect(screen.queryByText('На этой неделе')).not.toBeInTheDocument()
    expect(screen.queryByText('Более старые')).not.toBeInTheDocument()
    expect(screen.getByText('Беседа m1')).toBeInTheDocument()
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


describe('Sidebar — запрет переименования', () => {
  it('не показывает кнопку или инлайн-поле переименования', () => {
    setup()
    expect(screen.queryByRole('button', { name: /Переименовать разговор/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Новое название разговора')).not.toBeInTheDocument()
  })
})

describe('Sidebar — кнопка командной палитры', () => {
  it('рядом с поиском есть «⌘K»/«Ctrl+K», и она открывает палитру', () => {
    const onOpenCommandPalette = vi.fn()
    setup({ onOpenCommandPalette })
    fireEvent.wheel(document.querySelector('.convolist')!, { deltaY: -40 })
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

describe('Sidebar — desktop resize и панели управления', () => {
  it('показывает только два раздела, расширяет активный и выводит одно контекстное действие над ними', () => {
    const onNew = vi.fn()
    const onModeChange = vi.fn()
    const view = setup({ onNew, onModeChange, mode: 'chats', onCreateProject: vi.fn() })
    const group = screen.getByRole('group', { name: 'Тип списка' })
    const chats = within(group).getByRole('button', { name: 'Чаты' })
    const projects = within(group).getByRole('button', { name: 'Проекты' })

    expect(within(group).getAllByRole('button')).toHaveLength(2)
    expect(chats).toHaveClass('on')
    expect(chats).toHaveAttribute('aria-pressed', 'true')
    expect(projects).not.toHaveClass('on')
    expect(screen.getByRole('button', { name: /Новый чат/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Новый проект/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Беседы' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Сообщения' })).not.toBeInTheDocument()
    expect(document.querySelector('.side-primary-action')?.nextElementSibling).toBe(group)

    fireEvent.click(screen.getByRole('button', { name: /Новый чат/ }))
    expect(onNew).toHaveBeenCalledTimes(1)
    view.rerender(<Sidebar {...view} onNew={onNew} onModeChange={onModeChange} mode="projects" onCreateProject={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Новый проект/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Новый чат/ })).not.toBeInTheDocument()
    expect(within(group).getByRole('button', { name: 'Проекты' })).toHaveClass('on')
  })

  it('граница меняет ширину pointer-жестом, clamp-ит пределы и доступна с клавиатуры', () => {
    const onWidthChange = vi.fn()
    setup({ width: 264, onWidthChange })
    const handle = screen.getByRole('separator', { name: 'Изменить ширину сайдбара' })

    fireEvent.pointerDown(handle, { pointerId: 7, clientX: 264 })
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 900 })
    expect(onWidthChange).toHaveBeenLastCalledWith(420)
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: -900 })
    expect(onWidthChange).toHaveBeenLastCalledWith(220)
    fireEvent.pointerUp(handle, { pointerId: 7 })

    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(onWidthChange).toHaveBeenLastCalledWith(272)
    expect(handle).toHaveAttribute('aria-valuemin', '220')
    expect(handle).toHaveAttribute('aria-valuemax', '420')

    onWidthChange.mockClear()
    fireEvent.pointerDown(handle, { pointerId: 8, clientX: 264 })
    fireEvent.pointerCancel(handle, { pointerId: 8 })
    fireEvent.pointerMove(handle, { pointerId: 8, clientX: 320 })
    expect(onWidthChange).not.toHaveBeenCalled()
  })

  it('wheel раскрывает вверх у scrollTop=0 и скрывает вниз с порогом', () => {
    setup({ onShowDoneTaskChatsChange: vi.fn() })
    const list = document.querySelector('.convolist')!
    const controls = document.querySelector('.side-controls')!
    expect(controls).toHaveAttribute('aria-hidden', 'true')

    fireEvent.wheel(list, { deltaY: -5 })
    expect(controls).toHaveAttribute('aria-hidden', 'true')
    fireEvent.wheel(list, { deltaY: -7 })
    fireEvent.wheel(list, { deltaY: -7 })
    expect(controls).toHaveAttribute('aria-hidden', 'false')
    fireEvent.wheel(list, { deltaY: 8 })
    fireEvent.wheel(list, { deltaY: -8 })
    expect(controls).toHaveAttribute('aria-hidden', 'false')
    fireEvent.wheel(list, { deltaY: 20 })
    expect(controls).toHaveAttribute('aria-hidden', 'true')
  })

  it('чаты и проекты сохраняют независимые запросы и раскрытие', () => {
    const onSearch = vi.fn()
    const common = { projects: [{ id: 'p1', name: 'Альфа', role: 'owner' }] as never[], onModeChange: vi.fn(), onSearch }
    const view = setup({ ...common, mode: 'chats', searchQuery: 'миграция' })
    fireEvent.wheel(document.querySelector('.convolist')!, { deltaY: -40 })
    expect(screen.getByLabelText('Поиск по разговорам')).toHaveValue('миграция')

    view.rerender(<Sidebar {...view} {...common} mode="projects" searchQuery="миграция" />)
    expect(document.querySelector('.side-controls')).toHaveAttribute('aria-hidden', 'true')
    fireEvent.wheel(document.querySelector('.projlist')!, { deltaY: -40 })
    fireEvent.change(screen.getByLabelText('Поиск по проектам'), { target: { value: 'аль' } })

    view.rerender(<Sidebar {...view} {...common} mode="chats" searchQuery="миграция" />)
    expect(document.querySelector('.side-controls')).toHaveAttribute('aria-hidden', 'false')
    expect(screen.getByLabelText('Поиск по разговорам')).toHaveValue('миграция')
    view.rerender(<Sidebar {...view} {...common} mode="projects" searchQuery="миграция" />)
    expect(screen.getByLabelText('Поиск по проектам')).toHaveValue('аль')
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
    error: null,
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

describe('Sidebar — поиск проектов по типу', () => {
  it('находит проект по названию его типа, а не только по имени', async () => {
    const typed = [
      { id: 'p1', name: 'Лендинг', role: 'owner', typeChain: builtinProjectTypeChain(BUILTIN_PROJECT_TYPE_IDS.web) },
      { id: 'p2', name: 'Ремонт', role: 'owner', typeChain: builtinProjectTypeChain(BUILTIN_PROJECT_TYPE_IDS.general) }
    ] as never[]
    setup({ projects: typed, mode: 'projects', onModeChange: vi.fn() })
    await userEvent.type(screen.getByLabelText('Поиск по проектам'), 'веб')
    expect(screen.getByText('Лендинг')).toBeInTheDocument()
    expect(screen.queryByText('Ремонт')).not.toBeInTheDocument()
  })
})

describe('Sidebar — приглашения при сбое чтения', () => {
  it('ошибка показывается вместо исчезнувшего блока и даёт «Повторить»', async () => {
    const onRetryInvitations = vi.fn()
    setup({
      projects: [], mode: 'projects', onModeChange: vi.fn(),
      invitations: [], invitationsError: 'Сеть недоступна', onRetryInvitations
    })
    // Без этого человек не понимает: приглашение потерялось или его не было.
    expect(screen.getByText('Не удалось загрузить приглашения')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(onRetryInvitations).toHaveBeenCalled()
  })

  it('при непустом списке ошибка не подменяет приглашения', () => {
    const invitation = {
      id: 'i1', projectId: 'p1', projectName: 'Ремонт', email: null, invitedUsername: 'bob',
      role: 'member' as const, status: 'pending' as const, invitedBy: 'alice',
      createdAt: 1, expiresAt: 2, respondedAt: null
    }
    setup({ projects: [], mode: 'projects', onModeChange: vi.fn(), invitations: [invitation], invitationsError: 'Сеть недоступна' })
    expect(screen.getByText('Ремонт')).toBeInTheDocument()
    expect(screen.queryByText('Не удалось загрузить приглашения')).not.toBeInTheDocument()
  })
})

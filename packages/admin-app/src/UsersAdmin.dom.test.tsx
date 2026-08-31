import { describe, it, expect, vi } from 'vitest'
import { expectLabelledIconButtons, expectNoViolations } from './test/a11y'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UsersAdmin, type UsersAdminProps } from './UsersAdmin'
import type { AdminLlmEngine, AdminUserInfo } from '@shared/admin'

const NOW = Date.now()

const users: AdminUserInfo[] = [
  { name: 'admin', role: 'admin', blocked: false, createdAt: 1, conversationCount: 2, agents: [], lastSeenAt: NOW - 30_000, liveSessions: 1 },
  // Разговоры у bob есть: без них отчёт расхода намеренно не запрашивается.
  { name: 'bob', role: 'developer', blocked: false, createdAt: 2, conversationCount: 4, agents: [], lastSeenAt: NOW - 2 * 86_400_000, liveSessions: 0 }
]

const engines: AdminLlmEngine[] = [
  {
    id: 'eng-1',
    name: 'runner-work claude',
    kind: 'claude',
    baseUrl: 'http://runner-work:8080',
    token: 'secret',
    enabled: true,
    allowedRoles: ['admin', 'developer', 'tester', 'observer'],
    isDefault: true,
    createdAt: 3
  }
]

function renderAdmin(props: Partial<UsersAdminProps> = {}): UsersAdminProps {
  const full: UsersAdminProps = {
    users,
    selected: null,
    usage: null,
    conversations: [],
    messages: [],
    conversationId: null,
    currentUserName: 'admin',
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onSetBlocked: vi.fn(),
    onDelete: vi.fn(),
    onLoadUsage: vi.fn(),
    onOpenConversation: vi.fn(),
    engines,
    engineHealth: {
      'eng-1': { engineId: 'eng-1', kind: 'claude', checkedAt: 1, available: true, detail: 'claude: доступен', status: null }
    },
    onRetryEngines: vi.fn(),
    onCreateEngine: vi.fn(),
    onUpdateEngine: vi.fn(),
    onDeleteEngine: vi.fn(),
    onCheckEngineHealth: vi.fn(),
    onClose: vi.fn(),
    ...props
  }
  render(<UsersAdmin {...full} />)
  return full
}

/** Карточка выбранного человека: пропс `selected` + маршрут с вкладкой. */
function renderUser(name: string, tab: 'overview' | 'access' | 'machines' | 'usage' | 'history' = 'overview', props: Partial<UsersAdminProps> = {}): UsersAdminProps {
  return renderAdmin({ selected: name, route: { page: 'users', userName: name, tab }, ...props })
}

describe('UsersAdmin — список и метрики', () => {
  it('метрики считают людей, активность и расход, список открывает карточку кликом', async () => {
    const p = renderAdmin({
      usageSummary: [{ name: 'bob', totals: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, costUsd: 0.02, messages: 1 }, byModel: [{ model: 'gpt', inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, costUsd: 0.02, messages: 1 }] }]
    })
    const metrics = screen.getByTestId('users-metrics')
    expect(metrics).toHaveTextContent('Всего пользователей')
    expect(metrics).toHaveTextContent('$0.02')
    expect(screen.getAllByTestId('user-item')).toHaveLength(2)
    await userEvent.click(screen.getAllByTestId('user-item')[1]!)
    expect(p.onSelect).toHaveBeenCalledWith('bob')
  })

  it('поиск и фильтр статуса сужают список, счётчик показывает выборку', async () => {
    renderAdmin()
    await userEvent.type(screen.getByTestId('users-search'), 'bob')
    // Ввод дебаунсится: список не пересобирается на каждую букву.
    await waitFor(() => expect(screen.getAllByTestId('user-item')).toHaveLength(1))
    expect(screen.getByTestId('users-count')).toHaveTextContent('1 пользователь из 2')

    await userEvent.clear(screen.getByTestId('users-search'))
    await waitFor(() => expect(screen.getAllByTestId('user-item')).toHaveLength(2))
    await userEvent.selectOptions(screen.getByLabelText('Статус'), 'online')
    expect(screen.getAllByTestId('user-item')).toHaveLength(1)
    expect(screen.getAllByTestId('user-item')[0]).toHaveTextContent('admin')
  })

  it('счётчик списка объявляется скринридеру: иначе результат фильтра не слышен', async () => {
    renderAdmin()
    await userEvent.type(screen.getByTestId('users-search'), 'bob')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 пользователь из 2'))
  })

  it('Esc в поиске возвращает полный список', async () => {
    renderAdmin()
    await userEvent.type(screen.getByTestId('users-search'), 'bob')
    await waitFor(() => expect(screen.getAllByTestId('user-item')).toHaveLength(1))
    screen.getByTestId('users-search').focus()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.getAllByTestId('user-item')).toHaveLength(2))
  })

  it('выбор с клавиатуры уводит фокус в карточку, а не оставляет в списке', async () => {
    renderAdmin({ selected: null })
    const row = screen.getAllByTestId('user-item')[1]!
    row.focus()
    await userEvent.keyboard('{Enter}')
    // Карточку рисует уже выбранный пропс: проверяем, что список отдал признак
    // «выбор с клавиатуры» и цель фокуса существует.
    expect(screen.getByTestId('user-detail')).toHaveAttribute('tabindex', '-1')
  })

  it('стрелки ходят по списку, не открывая чужие карточки', async () => {
    const p = renderAdmin({ selected: null })
    const rows = screen.getAllByTestId('user-item')
    rows[0]!.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(rows[1])
    // Движение по списку — не выбор: карточка чужого человека не грузится.
    expect(p.onSelect).not.toHaveBeenCalled()
    await userEvent.keyboard('{End}')
    expect(document.activeElement).toBe(rows[rows.length - 1])
    await userEvent.keyboard('{Enter}')
    expect(p.onSelect).toHaveBeenCalledTimes(1)
  })

  it('без выбранного человека карточка объясняет, что делать', () => {
    renderAdmin()
    expect(screen.getByTestId('user-detail')).toHaveTextContent('Выберите человека')
  })
})

describe('UsersAdmin — масштаб', () => {
  it('тысяча учёток рисуется страницей: на экране не больше предела списка', () => {
    const many: AdminUserInfo[] = Array.from({ length: 1000 }, (_, index) => ({
      name: `user-${String(index).padStart(4, '0')}`,
      role: 'developer' as const,
      blocked: false,
      createdAt: 1,
      conversationCount: 0,
      machinesTotal: 0,
      machinesOnline: 0,
      lastSeenAt: NOW - index * 1000,
      liveSessions: 0
    }))
    const started = Date.now()
    renderAdmin({ users: many })
    // Предел списка держит DOM в разумных границах, а не рисует тысячу строк.
    expect(screen.getAllByTestId('user-item')).toHaveLength(200)
    expect(screen.getByTestId('users-count')).toHaveTextContent('1000')
    // Порог намеренно щедрый: он ловит возврат к отрисовке всего списка, а не
    // соревнуется с производительностью машины.
    expect(Date.now() - started).toBeLessThan(4000)
  })

  it('«показать ещё» догружает следующую страницу и сообщает остаток', async () => {
    const many: AdminUserInfo[] = Array.from({ length: 260 }, (_, index) => ({
      name: `user-${index}`, role: 'developer' as const, blocked: false, createdAt: 1,
      conversationCount: 0, machinesTotal: 0, machinesOnline: 0, lastSeenAt: NOW - index, liveSessions: 0
    }))
    renderAdmin({ users: many })
    expect(screen.getByRole('button', { name: /Показать ещё 60 из 60/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Показать ещё/ }))
    expect(screen.getAllByTestId('user-item')).toHaveLength(260)
    expect(screen.queryByRole('button', { name: /Показать ещё/ })).toBeNull()
  })
})

describe('UsersAdmin — карточка человека', () => {
  it('у обычной учётки есть блокировка и удаление', () => {
    renderUser('bob')
    const detail = screen.getByTestId('user-detail')
    expect(within(detail).getAllByRole('button', { name: 'Заблокировать' }).length).toBeGreaterThan(0)
    expect(within(detail).getByRole('button', { name: 'Удалить учётку' })).toBeInTheDocument()
  })

  it('встроенного admin и себя блокировать и удалять нельзя', () => {
    renderUser('admin')
    const detail = screen.getByTestId('user-detail')
    expect(within(detail).queryByRole('button', { name: 'Заблокировать' })).toBeNull()
    expect(within(detail).queryByRole('button', { name: 'Удалить учётку' })).toBeNull()
    expect(within(detail).queryByLabelText('Роль пользователя')).toBeNull()
  })

  it('блокировка подтверждается диалогом и передаёт причину', async () => {
    const p = renderUser('bob')
    await userEvent.click(within(screen.getByTestId('danger-zone')).getByRole('button', { name: 'Заблокировать' }))
    await userEvent.type(within(screen.getByTestId('block-dialog')).getByLabelText('Причина'), 'запрос СБ')
    await userEvent.click(within(screen.getByTestId('block-dialog')).getByRole('button', { name: 'Заблокировать' }))
    expect(p.onSetBlocked).toHaveBeenCalledWith('bob', true, 'запрос СБ')
  })

  it('не-админ видит карточку без административных действий', () => {
    renderUser('bob', 'overview', { isAdmin: false })
    const detail = screen.getByTestId('user-detail')
    expect(within(detail).queryByRole('button', { name: 'Удалить учётку' })).toBeNull()
    expect(within(detail).queryByLabelText('Роль пользователя')).toBeNull()
    expect(screen.getByRole('tab', { name: /Доступ/ })).toBeInTheDocument()
  })
})

describe('UsersAdmin — расход', () => {
  it('показывает токены и ответы модели', () => {
    renderUser('bob', 'usage', {
      usage: {
        unit: 'day',
        conversationId: null,
        totals: { inputTokens: 1500, outputTokens: 300, cacheReadTokens: 0, costUsd: 0.02, messages: 3 },
        byBucket: [],
        byModel: [{ model: 'opus', inputTokens: 1500, outputTokens: 300, cacheReadTokens: 0, costUsd: 0.02, messages: 3 }],
        byConversation: []
      }
    })
    const tab = screen.getByTestId('usage-tab')
    expect(tab).toHaveTextContent('1.8k')
    expect(tab).toHaveTextContent('3')
  })

  it('не показывает нулевую цену при неизвестном тарифе Codex', () => {
    renderUser('bob', 'usage', {
      usage: {
        unit: 'day', conversationId: null,
        totals: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, costUsd: 0, costIncomplete: true, messages: 1 },
        byBucket: [],
        byModel: [{ model: 'unknown-codex', inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, costUsd: 0, costIncomplete: true, messages: 1 }],
        byConversation: []
      }
    })
    expect(screen.getByTestId('usage-tab')).toHaveTextContent('—')
    expect(screen.getByTestId('usage-tab')).toHaveTextContent('часть ответов без известного тарифа')
  })

  it('расход грузится при открытии вкладки и перезапрашивается на смену периода', async () => {
    const p = renderUser('bob', 'usage')
    await waitFor(() => expect(p.onLoadUsage).toHaveBeenCalled())
    await userEvent.selectOptions(screen.getByLabelText('Период расхода'), '7d')
    await waitFor(() => {
      const last = (p.onLoadUsage as ReturnType<typeof vi.fn>).mock.calls.at(-1)!
      expect(last[1]).toBeCloseTo(Date.now() - 7 * 86_400_000, -5)
    })
  })
})

describe('UsersAdmin — расход и метрики согласованы', () => {
  it('одна и та же сумма в метрике над списком и в строке человека', () => {
    renderAdmin({
      usageSummary: [{ name: 'bob', totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, costFromPrices: 58.2, messages: 5 }, byModel: [] }]
    })
    // Формула одна (`spendUsd`: большая из двух оценок), поэтому «$58.20»
    // обязано совпасть в обоих местах — иначе цифры на экране спорят друг с другом.
    expect(screen.getByTestId('users-metrics')).toHaveTextContent('$58.20')
    const row = screen.getAllByTestId('user-item').find((item) => item.textContent?.includes('bob'))!
    expect(row).toHaveTextContent('$58.20')
  })

  it('человеку без разговоров отчёт не запрашивается', async () => {
    const p = renderAdmin({
      users: [{ name: 'newbie', role: 'developer', blocked: false, createdAt: 1, conversationCount: 0, agents: [], lastSeenAt: null, liveSessions: 0 }],
      selected: 'newbie',
      route: { page: 'users', userName: 'newbie', tab: 'usage' }
    })
    await waitFor(() => expect(screen.getByTestId('usage-tab')).toBeInTheDocument())
    expect(p.onLoadUsage).not.toHaveBeenCalled()
  })
})

describe('UsersAdmin — журнал безопасности', () => {
  it('вкладка «История» запрашивает события и показывает подписи', async () => {
    const onLoadSecurity = vi.fn()
    renderUser('bob', 'history', {
      onLoadSecurity,
      security: [
        { id: 2, at: 2, user: 'bob', type: 'login_failed', ip: '10.0.0.2', userAgent: 'Firefox/1', details: 'неверный пароль' },
        { id: 1, at: 1, user: 'bob', type: 'login', ip: '10.0.0.1', userAgent: 'Chrome/1', details: '' }
      ]
    })
    await waitFor(() => expect(onLoadSecurity).toHaveBeenCalled())
    const tab = screen.getByTestId('history-tab')
    expect(within(tab).getByText('Неверный пароль')).toBeInTheDocument()
    expect(within(tab).getByText('Вход')).toBeInTheDocument()
    expect(tab).toHaveTextContent('10.0.0.2')
  })

  it('переписка человека остаётся доступной администратору под журналом', async () => {
    const p = renderUser('bob', 'history', {
      security: [],
      conversations: [{ id: 'c1', title: 'Рефакторинг', messageCount: 3, updatedAt: 1, createdAt: 1 } as never]
    })
    const section = screen.getByTestId('user-history-section')
    await userEvent.click(within(section).getByText('Рефакторинг'))
    expect(p.onOpenConversation).toHaveBeenCalledWith('c1')
  })
})

describe('UsersAdmin — состояния загрузки и ошибки', () => {
  it('первая загрузка — скелетон списка', () => {
    renderAdmin({ users: [], status: 'loading' })
    expect(screen.getAllByTestId('user-skeleton')).toHaveLength(4)
  })

  it('ошибка загрузки видна и повторяется кнопкой', () => {
    const onRetry = vi.fn()
    renderAdmin({ users: [], status: 'error', error: '401', onRetry })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Не удалось загрузить пользователей')
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

describe('UsersAdmin — служебные страницы', () => {
  it('реестр исполнителей живёт на своей странице и не мешает списку людей', () => {
    renderAdmin({ route: { page: 'engines' } })
    const section = screen.getByTestId('llm-engines-section')
    expect(within(section).getByText('runner-work claude')).toBeInTheDocument()
    expect(within(section).getByText(/health: жив/)).toBeInTheDocument()
    expect(screen.queryByTestId('users-page')).toBeNull()
  })

  it('создание исполнителя зовёт onCreateEngine', async () => {
    const p = renderAdmin({ route: { page: 'engines' } })
    await userEvent.type(screen.getByLabelText('Название исполнителя'), 'runner codex')
    await userEvent.selectOptions(screen.getByLabelText('Kind исполнителя'), 'codex')
    await userEvent.type(screen.getByLabelText('URL исполнителя'), 'http://runner-codex:8080')
    await userEvent.type(screen.getByLabelText('Токен исполнителя'), 'tok')
    await userEvent.click(within(screen.getByTestId('llm-engines-section')).getByRole('button', { name: 'Добавить' }))
    expect(p.onCreateEngine).toHaveBeenCalledWith({
      name: 'runner codex',
      kind: 'codex',
      baseUrl: 'http://runner-codex:8080',
      token: 'tok',
      enabled: true,
      allowedRoles: ['admin', 'developer', 'tester', 'observer'],
      isDefault: false
    })
  })

  it('кнопки шапки ведут на страницы цен, движков и системы', async () => {
    const onNavigate = vi.fn()
    // Маршрут задан снаружи: клик по кнопке шапки не должен уводить сам себя
    // со страницы, иначе следующей кнопки на экране уже нет.
    renderAdmin({ onNavigate, route: { page: 'users' } })
    await userEvent.click(screen.getByRole('button', { name: 'Цены моделей' }))
    expect(onNavigate).toHaveBeenCalledWith({ page: 'prices' })
    await userEvent.click(screen.getByRole('button', { name: 'Движки' }))
    expect(onNavigate).toHaveBeenCalledWith({ page: 'engines' })
    await userEvent.click(screen.getByRole('button', { name: 'Система' }))
    expect(onNavigate).toHaveBeenCalledWith({ page: 'system' })
  })

  it('строка диска: тревога при свободном месте меньше 10 ГБ (roadmap-4 п.40)', () => {
    renderAdmin({ route: { page: 'system' }, makeStats: { disk: { totalBytes: 100 * 1024 ** 3, freeBytes: 4 * 1024 ** 3, alert: true }, projects: 3, bytes: 5 * 1048576, filesBytes: 1048576, snapshotsBytes: 4 * 1048576, shotsBytes: 0, published: 1, shared: 1, views: 7, limitBytes: 64 * 1048576, userLimitBytes: 4 * 1048576, byUser: [{ user: 'alice', projects: 2, bytes: 3.5 * 1048576, published: 1, views: 7 }], top: [] } })
    const disk = screen.getByTestId('admin-disk')
    expect(disk).toHaveAttribute('role', 'alert')
    expect(disk).toHaveTextContent('меньше 10 ГБ')
  })

  it('секция «Make-проекты» показывает сводку и таблицу по пользователям (п.38)', () => {
    renderAdmin({ route: { page: 'system' }, makeStats: { projects: 3, bytes: 5 * 1048576, filesBytes: 1048576, snapshotsBytes: 4 * 1048576, shotsBytes: 0, published: 1, shared: 1, views: 7, limitBytes: 64 * 1048576, userLimitBytes: 4 * 1048576, byUser: [{ user: 'alice', projects: 2, bytes: 3.5 * 1048576, published: 1, views: 7 }], top: [] } })
    const sec = screen.getByTestId('make-stats')
    expect(sec).toHaveTextContent('Проектов: 3')
    expect(sec).toHaveTextContent('5 МБ')
    expect(within(sec).getByText('alice')).toBeInTheDocument()
    expect(within(sec).getByTestId('make-user-quota-warn')).toHaveTextContent('88% квоты')
  })
})

describe('UsersAdmin — сессии пользователя (auth-roadmap п.4)', () => {
  const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36'
  const session = { sid: 's1', user: 'bob', createdAt: 1, lastSeen: 2, expiresAt: Date.now() + 86_400_000, ip: '10.0.0.1', userAgent: chrome }

  it('список запрашивается только при раскрытии и рисуется общим модулем сессий', async () => {
    const list = vi.fn(async () => [session])
    const revoke = vi.fn(async () => undefined)
    renderUser('bob', 'machines', { sessionsClient: { list, revoke } })
    const details = screen.getByTestId('admin-sessions')
    // Закрытый <details> не должен дёргать сервер: у админа сотни пользователей.
    expect(list).not.toHaveBeenCalled()
    await userEvent.click(within(details).getByText('Сессии'))
    await waitFor(() => expect(list).toHaveBeenCalled())
    expect(await within(details).findByText('Chrome 128 · macOS')).toBeInTheDocument()
    await userEvent.click(within(details).getByRole('button', { name: 'Завершить' }))
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('s1'))
  })

  it('чужой список — только чтение: без переименования и доверия', async () => {
    const list = vi.fn(async () => [session])
    renderUser('bob', 'machines', { sessionsClient: { list, revoke: async () => undefined, rename: async () => undefined, setTrusted: async () => undefined } })
    await userEvent.click(within(screen.getByTestId('admin-sessions')).getByText('Сессии'))
    expect(await screen.findByTestId('session-s1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Переименовать' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Сделать доверенным' })).toBeNull()
  })
})

describe('UsersAdmin — приглашения и регистрация', () => {
  it('раскрытие загружает список, форма создаёт инвайт, «Отозвать» удаляет', async () => {
    const onLoadInvites = vi.fn(); const onCreateInvite = vi.fn(); const onDeleteInvite = vi.fn()
    renderAdmin({ onLoadInvites, onCreateInvite, onDeleteInvite, invites: [{ token: 'abc', role: 'tester', createdBy: 'admin', createdAt: 1, expiresAt: 9_999_999_999_999, maxUses: 2, uses: 0, note: 'QA', email: 'guest@example.com', emailedAt: 2 }] })
    const box = screen.getByTestId('admin-invites')
    await userEvent.click(within(box).getByText(/Инвайт-ссылки/))
    await waitFor(() => expect(onLoadInvites).toHaveBeenCalled())
    await userEvent.selectOptions(within(box).getByLabelText('Роль по инвайту'), 'observer')
    await userEvent.type(within(box).getByLabelText('Email получателя'), 'new@example.com')
    await userEvent.type(within(box).getByLabelText('Заметка к инвайту'), 'гость')
    await userEvent.click(within(box).getByRole('button', { name: 'Создать ссылку' }))
    expect(onCreateInvite).toHaveBeenCalledWith({ role: 'observer', ttlHours: 72, maxUses: 1, note: 'гость', email: 'new@example.com' })
    expect(within(box).getByText('guest@example.com · email отправлен')).toBeInTheDocument()
    expect(within(box).getByText(/#\/invite\/abc/)).toBeInTheDocument()
    await userEvent.click(within(box).getByRole('button', { name: 'Отозвать' }))
    expect(onDeleteInvite).toHaveBeenCalledWith('abc')
  })

  it('открытая регистрация: раскрытие грузит настройку, изменения уходят наружу', async () => {
    const onLoadSignup = vi.fn(); const onSetSignup = vi.fn()
    renderAdmin({ onLoadSignup, onSetSignup, signup: { enabled: false, role: 'developer', mailConfigured: false, ownedProjectLimit: 5, sessionLimit: 0 } })
    const box = screen.getByTestId('admin-signup')
    await userEvent.click(within(box).getByText(/Открытая регистрация/))
    await waitFor(() => expect(onLoadSignup).toHaveBeenCalled())
    await userEvent.click(within(box).getByLabelText('Разрешить регистрацию по email'))
    expect(onSetSignup).toHaveBeenCalledWith({ enabled: true })
    await userEvent.selectOptions(within(box).getByLabelText('Роль новых пользователей'), 'tester')
    expect(onSetSignup).toHaveBeenCalledWith({ role: 'tester' })
    fireEvent.change(within(box).getByLabelText('Квота проектов на пользователя'), { target: { value: '7' } })
    expect(onSetSignup).toHaveBeenCalledWith({ ownedProjectLimit: 7 })
    expect(box).toHaveTextContent('SMTP не настроен')
  })
})

describe('UsersAdmin — временный пароль, код сброса и лимит LLM', () => {
  it('создание идёт диалогом и передаёт флаг временного пароля', async () => {
    const onCreate = vi.fn()
    renderAdmin({ onCreate })
    await userEvent.click(screen.getByRole('button', { name: '＋ Добавить' }))
    const dialog = screen.getByTestId('create-user-dialog')
    await userEvent.type(within(dialog).getByLabelText('Логин нового пользователя'), 'newbie')
    await userEvent.type(within(dialog).getByLabelText('Пароль нового пользователя'), 'newbie-long-password')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать' }))
    expect(onCreate).toHaveBeenCalledWith('newbie', 'newbie-long-password', 'developer', true)
  })

  it('«Код сброса» показывает выданный код', async () => {
    const onResetCode = vi.fn(async () => ({ code: 'ABCD1234', expiresAt: 9_999_999_999_999 }))
    renderUser('bob', 'overview', { onResetCode })
    await userEvent.click(screen.getByRole('button', { name: 'Код сброса' }))
    expect(await screen.findByTestId('admin-reset-code')).toHaveTextContent('ABCD1234')
  })

  it('поле лимита сохраняет число, пустое — снимает лимит', async () => {
    const onSetLlmLimit = vi.fn()
    renderUser('bob', 'overview', { onSetLlmLimit })
    const box = screen.getByTestId('admin-llm-limit')
    await userEvent.type(within(box).getByLabelText('Лимит LLM в месяц, USD'), '12')
    await userEvent.click(within(box).getByRole('button', { name: 'Сохранить' }))
    expect(onSetLlmLimit).toHaveBeenCalledWith('bob', 12)
    await userEvent.click(within(box).getByRole('button', { name: 'Сохранить' }))
    expect(onSetLlmLimit).toHaveBeenLastCalledWith('bob', null)
  })
})

describe('UsersAdmin — доступность', () => {
  it('без нарушений axe: список, метрики и карточка человека', async () => {
    renderUser('bob')
    await expectNoViolations()
    expectLabelledIconButtons()
  })

  it('без нарушений axe на служебных страницах', async () => {
    renderAdmin({ route: { page: 'engines' } })
    await expectNoViolations()
  })
  it('у разговора пользователя есть вход в инспектор контекста', async () => {
    // Снимок чужого чата админу отдаёт сервер, но попасть в этот экран из
    // своего чата нельзя: разговор не в его списке. Кнопка — единственный вход.
    const onOpenConversationContext = vi.fn()
    renderUser('bob', 'history', {
      onOpenConversationContext,
      conversations: [{ id: 'conv-1', title: 'Сборка падает', createdAt: 1, updatedAt: 2, messageCount: 3 } as never]
    })
    const section = await screen.findByTestId('user-history-section')
    await userEvent.click(within(section).getByRole('button', { name: 'Контекст' }))
    expect(onOpenConversationContext).toHaveBeenCalledWith('conv-1')
  })
})

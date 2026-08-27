import { describe, it, expect, vi } from 'vitest'
import { expectLabelledIconButtons, expectNoViolations } from './test/a11y'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UsersAdmin, type UsersAdminProps } from './UsersAdmin'
import type { AdminLlmEngine, AdminUserInfo } from '@shared/admin'
import { makeConversation } from './test/fixtures/conversations'

const users: AdminUserInfo[] = [
  { name: 'admin', role: 'admin', blocked: false, createdAt: 1, conversationCount: 2, agents: [] },
  { name: 'bob', role: 'developer', blocked: false, createdAt: 2, conversationCount: 0, agents: [] }
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

describe('UsersAdmin', () => {
  it('рендерит дашборд со сводкой и открывает карточку кликом', async () => {
    const p = renderAdmin({ usageSummary: [{ name: 'bob', totals: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, costUsd: 0.02, messages: 1 }, byModel: [{ model: 'gpt', inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, costUsd: 0.02, messages: 1 }] }] })
    expect(screen.getAllByTestId('user-item')).toHaveLength(2)
    expect(screen.getByTestId('users-dashboard')).toHaveTextContent('gpt')
    await userEvent.click(screen.getAllByTestId('user-dashboard-row')[1]!)
    expect(p.onSelect).toHaveBeenCalledWith('bob')
  })

  it('у обычного пользователя нет вкладки машин', () => {
    renderAdmin({ selected: 'bob', isAdmin: false })
    // Вкладки — role=tab внутри role=tablist: иначе axe даёт critical
    // aria-required-children, и запрос по button их больше не находит.
    expect(screen.queryByRole('tab', { name: 'Машины пользователя' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Доступ к моделям' })).toBeInTheDocument()
  })

  it('создание пользователя зовёт onCreate', async () => {
    const p = renderAdmin()
    await userEvent.type(screen.getByLabelText('Логин нового пользователя'), 'carol')
    await userEvent.selectOptions(screen.getByLabelText('Роль нового пользователя'), 'developer')
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }))
    expect(p.onCreate).toHaveBeenCalledWith('carol', '', 'developer', true)
  })

  it('у обычного пользователя есть блок/удаление', () => {
    renderAdmin({ selected: 'bob' })
    const detail = screen.getByTestId('user-detail')
    expect(within(detail).getByRole('button', { name: 'Заблокировать' })).toBeInTheDocument()
    expect(within(detail).getByRole('button', { name: 'Удалить учётку' })).toBeInTheDocument()
  })

  it('admin нельзя блокировать/удалять (кнопок нет)', () => {
    renderAdmin({ selected: 'admin' })
    const detail = screen.getByTestId('user-detail')
    expect(within(detail).queryByRole('button', { name: 'Заблокировать' })).toBeNull()
    expect(within(detail).queryByRole('button', { name: 'Удалить учётку' })).toBeNull()
  })

  it('показывает отчёт по токенам', () => {
    renderAdmin({
      selected: 'bob',
      usage: {
        unit: 'day',
        conversationId: null,
        totals: { inputTokens: 1500, outputTokens: 300, cacheReadTokens: 0, costUsd: 0.02, messages: 3 },
        byBucket: [],
        byModel: [{ model: 'opus', inputTokens: 1500, outputTokens: 300, cacheReadTokens: 0, costUsd: 0.02, messages: 3 }],
        byConversation: []
      }
    })
    expect(screen.getByTestId('usage-total')).toHaveTextContent('Ответы3')
  })

  it('не показывает нулевую цену при неизвестном тарифе Codex', () => {
    renderAdmin({
      selected: 'bob',
      usage: {
        unit: 'day', conversationId: null,
        totals: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, costUsd: 0, costIncomplete: true, messages: 1 },
        byBucket: [],
        byModel: [{ model: 'unknown-codex', inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, costUsd: 0, costIncomplete: true, messages: 1 }],
        byConversation: []
      }
    })
    expect(screen.getByTestId('usage-total')).toHaveTextContent('По данным CLI—')
    expect(screen.getByTestId('usage-total')).toHaveTextContent('По прайсу—')
    expect(screen.getByTitle('Есть ответы без цены CLI и строки прайса')).toBeInTheDocument()
  })

  it('перезагружает расход при смене периода и разговора', async () => {
    const conversation = makeConversation({ id: 'chat-usage', title: 'Точный разговор' })
    const p = renderAdmin({ selected: 'bob', conversations: [conversation] })
    await userEvent.selectOptions(screen.getByLabelText('Период расхода'), '7')
    expect(p.onLoadUsage).toHaveBeenLastCalledWith('day', expect.any(Number), expect.any(Number), undefined)
    await userEvent.selectOptions(screen.getByLabelText('Разговор расхода'), conversation.id)
    expect(p.onLoadUsage).toHaveBeenLastCalledWith('day', expect.any(Number), expect.any(Number), conversation.id)
  })

  it('рендерит реестр LLM-исполнителей и health', () => {
    renderAdmin()
    const sec = screen.getByTestId('llm-engines-section')
    expect(within(sec).getByText('runner-work claude')).toBeInTheDocument()
    expect(within(sec).getByText(/health: жив/)).toBeInTheDocument()
  })

  it('создание исполнителя зовёт onCreateEngine', async () => {
    const p = renderAdmin()
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

describe('UsersAdmin — доступность', () => {
  it('без нарушений axe: список, форма создания, карточка пользователя и реестр исполнителей', async () => {
    renderAdmin({ selected: 'bob' })
    await expectNoViolations()
    expectLabelledIconButtons()
  })

  it('строка диска с данными: тревога при свободном месте меньше 10 ГБ (roadmap-4 п.40)', () => {
    renderAdmin({ isAdmin: true, makeStats: { disk: { totalBytes: 100 * 1024 ** 3, freeBytes: 4 * 1024 ** 3, alert: true }, projects: 3, bytes: 5 * 1048576, filesBytes: 1048576, snapshotsBytes: 4 * 1048576, shotsBytes: 0, published: 1, shared: 1, views: 7, limitBytes: 64 * 1048576, userLimitBytes: 4 * 1048576, byUser: [{ user: 'alice', projects: 2, bytes: 3.5 * 1048576, published: 1, views: 7 }], top: [] } })
    const disk = screen.getByTestId('admin-disk')
    expect(disk).toHaveAttribute('role', 'alert')
    expect(disk).toHaveTextContent('меньше 10 ГБ')
  })

  it('секция «Make-проекты» показывает сводку и таблицу по пользователям (п.38)', () => {
    renderAdmin({ isAdmin: true, makeStats: { projects: 3, bytes: 5 * 1048576, filesBytes: 1048576, snapshotsBytes: 4 * 1048576, shotsBytes: 0, published: 1, shared: 1, views: 7, limitBytes: 64 * 1048576, userLimitBytes: 4 * 1048576, byUser: [{ user: 'alice', projects: 2, bytes: 3.5 * 1048576, published: 1, views: 7 }], top: [] } })
    const sec = screen.getByTestId('make-stats')
    expect(sec).toHaveTextContent('Проектов: 3')
    expect(sec).toHaveTextContent('5.0 МБ')
    expect(within(sec).getByText('alice')).toBeInTheDocument()
    expect(within(sec).getByTestId('make-user-quota-warn')).toHaveTextContent('88% квоты')
  })
})

describe('UsersAdmin — сессии пользователя (auth-roadmap п.4)', () => {
  it('раскрытие «Сессии» запрашивает список; «Завершить» отзывает по sid', async () => {
    const onLoadSessions = vi.fn()
    const onRevokeSession = vi.fn()
    renderAdmin({ isAdmin: true, selected: 'bob', sessions: [{ sid: 's1', user: 'bob', createdAt: 1, lastSeen: 2, expiresAt: 9, ip: '10.0.0.1', userAgent: 'Chrome/1' }], onLoadSessions, onRevokeSession })
    const details = screen.getByTestId('admin-sessions')
    await userEvent.click(within(details).getByText(/Сессии \(1\)/))
    await waitFor(() => expect(onLoadSessions).toHaveBeenCalled())
    await userEvent.click(within(details).getByRole('button', { name: 'Завершить' }))
    expect(onRevokeSession).toHaveBeenCalledWith('s1')
  })
})

describe('UsersAdmin — журнал безопасности (auth-roadmap п.7)', () => {
  it('вкладка «Безопасность» запрашивает события и показывает таблицу с подписями', async () => {
    const onLoadSecurity = vi.fn()
    renderAdmin({ isAdmin: true, selected: 'bob', onLoadSecurity, security: [
      { id: 2, at: 2, user: 'bob', type: 'login_failed', ip: '10.0.0.2', userAgent: 'Firefox/1', details: 'неверный пароль' },
      { id: 1, at: 1, user: 'bob', type: 'login', ip: '10.0.0.1', userAgent: 'Chrome/1', details: '' }
    ] })
    await userEvent.click(screen.getByRole('tab', { name: 'Безопасность' }))
    expect(onLoadSecurity).toHaveBeenCalled()
    const sec = screen.getByTestId('admin-security')
    expect(within(sec).getByText('Неверный пароль')).toBeInTheDocument()
    expect(within(sec).getByText('Вход')).toBeInTheDocument()
    expect(within(sec).getByText('10.0.0.2')).toBeInTheDocument()
  })
})

describe('UsersAdmin — инвайт-ссылки (auth-roadmap п.8)', () => {
  it('раскрытие загружает список, форма создаёт инвайт с ролью/сроком/лимитом, «Отозвать» удаляет', async () => {
    const onLoadInvites = vi.fn(); const onCreateInvite = vi.fn(); const onDeleteInvite = vi.fn()
    renderAdmin({ isAdmin: true, onLoadInvites, onCreateInvite, onDeleteInvite, invites: [{ token: 'abc', role: 'tester', createdBy: 'admin', createdAt: 1, expiresAt: 9_999_999_999_999, maxUses: 2, uses: 0, note: 'QA' }] })
    const box = screen.getByTestId('admin-invites')
    await userEvent.click(within(box).getByText(/Инвайт-ссылки/))
    await waitFor(() => expect(onLoadInvites).toHaveBeenCalled())
    await userEvent.selectOptions(within(box).getByLabelText('Роль по инвайту'), 'observer')
    await userEvent.type(within(box).getByLabelText('Заметка к инвайту'), 'гость')
    await userEvent.click(within(box).getByRole('button', { name: 'Создать ссылку' }))
    expect(onCreateInvite).toHaveBeenCalledWith({ role: 'observer', ttlHours: 72, maxUses: 1, note: 'гость' })
    expect(within(box).getByText(/#\/invite\/abc/)).toBeInTheDocument()
    await userEvent.click(within(box).getByRole('button', { name: 'Отозвать' }))
    expect(onDeleteInvite).toHaveBeenCalledWith('abc')
  })
})

describe('UsersAdmin — временный пароль и код сброса (auth-roadmap пп.10–11)', () => {
  it('создание передаёт флаг временного пароля; «Код сброса» показывает выданный код', async () => {
    const onCreate = vi.fn()
    const onResetCode = vi.fn(async () => ({ code: 'ABCD1234', expiresAt: 9_999_999_999_999 }))
    renderAdmin({ isAdmin: true, onCreate, onResetCode, selected: 'bob' })
    await userEvent.type(screen.getByLabelText('Логин нового пользователя'), 'newbie')
    await userEvent.type(screen.getByLabelText('Пароль нового пользователя'), 'newbie-long-password')
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }))
    expect(onCreate).toHaveBeenCalledWith('newbie', 'newbie-long-password', 'developer', true)
    await userEvent.click(screen.getByRole('button', { name: 'Код сброса' }))
    expect(await screen.findByTestId('admin-reset-code')).toHaveTextContent('ABCD1234')
  })
})

describe('UsersAdmin — лимит LLM (auth-roadmap п.17)', () => {
  it('поле лимита сохраняет число, пустое — снимает лимит', async () => {
    const onSetLlmLimit = vi.fn()
    renderAdmin({ isAdmin: true, selected: 'bob', onSetLlmLimit })
    const box = screen.getByTestId('admin-llm-limit')
    await userEvent.type(within(box).getByLabelText('Лимит LLM в месяц, USD'), '12')
    await userEvent.click(within(box).getByRole('button', { name: 'Сохранить' }))
    expect(onSetLlmLimit).toHaveBeenCalledWith('bob', 12)
    await userEvent.click(within(box).getByRole('button', { name: 'Сохранить' }))
    expect(onSetLlmLimit).toHaveBeenLastCalledWith('bob', null)
  })
})

describe('UsersAdmin — открытая регистрация', () => {
  it('раскрытие запрашивает настройку; галка и роль зовут onSetSignup; без SMTP — предупреждение', async () => {
    const onLoadSignup = vi.fn(); const onSetSignup = vi.fn()
    renderAdmin({ isAdmin: true, onLoadSignup, onSetSignup, signup: { enabled: false, role: 'developer', mailConfigured: false } })
    const box = screen.getByTestId('admin-signup')
    await userEvent.click(within(box).getByText(/Открытая регистрация/))
    await waitFor(() => expect(onLoadSignup).toHaveBeenCalled())
    await userEvent.click(within(box).getByLabelText('Разрешить регистрацию по email'))
    expect(onSetSignup).toHaveBeenCalledWith({ enabled: true })
    await userEvent.selectOptions(within(box).getByLabelText('Роль новых пользователей'), 'tester')
    expect(onSetSignup).toHaveBeenCalledWith({ role: 'tester' })
    expect(box).toHaveTextContent('SMTP не настроен')
  })
})

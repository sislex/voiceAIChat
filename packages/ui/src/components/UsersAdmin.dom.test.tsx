import { describe, it, expect, vi } from 'vitest'
import { expectLabelledIconButtons, expectNoViolations } from '../test/a11y'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UsersAdmin, type UsersAdminProps } from './UsersAdmin'
import type { AdminLlmEngine, AdminUserInfo } from '@shared/admin'
import { makeConversation } from '../test/fixtures/conversations'

const users: AdminUserInfo[] = [
  { name: 'admin', role: 'admin', blocked: false, createdAt: 1, conversationCount: 2, agents: [] },
  { name: 'bob', role: 'user', blocked: false, createdAt: 2, conversationCount: 0, agents: [] }
]

const engines: AdminLlmEngine[] = [
  {
    id: 'eng-1',
    name: 'runner-work claude',
    kind: 'claude',
    baseUrl: 'http://runner-work:8080',
    token: 'secret',
    enabled: true,
    allowedRoles: ['admin', 'user'],
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
    await userEvent.selectOptions(screen.getByLabelText('Роль нового пользователя'), 'user')
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }))
    expect(p.onCreate).toHaveBeenCalledWith('carol', '', 'user')
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
    expect(screen.getByTestId('usage-total')).toHaveTextContent('Стоимость—')
    expect(screen.getByTitle('Есть ответы без известного тарифа')).toBeInTheDocument()
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
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))
    expect(p.onCreateEngine).toHaveBeenCalledWith({
      name: 'runner codex',
      kind: 'codex',
      baseUrl: 'http://runner-codex:8080',
      token: 'tok',
      enabled: true,
      allowedRoles: ['admin', 'user'],
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
})

import { describe, it, expect, vi } from 'vitest'
import { expectLabelledIconButtons, expectNoViolations } from '../test/a11y'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UsersAdmin, type UsersAdminProps } from './UsersAdmin'
import type { AdminUserInfo } from '@shared/admin'

const users: AdminUserInfo[] = [
  { name: 'admin', role: 'admin', blocked: false, createdAt: 1, conversationCount: 2, agents: [] },
  { name: 'bob', role: 'user', blocked: false, createdAt: 2, conversationCount: 0, agents: [] }
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
    onClose: vi.fn(),
    ...props
  }
  render(<UsersAdmin {...full} />)
  return full
}

describe('UsersAdmin', () => {
  it('рендерит список пользователей', () => {
    renderAdmin()
    expect(screen.getAllByTestId('user-item')).toHaveLength(2)
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
        totals: { inputTokens: 1500, outputTokens: 300, cacheReadTokens: 0, costUsd: 0.02, messages: 3 },
        byBucket: [],
        byModel: [{ model: 'opus', inputTokens: 1500, outputTokens: 300, cacheReadTokens: 0, costUsd: 0.02, messages: 3 }]
      }
    })
    expect(screen.getByTestId('usage-total').textContent).toContain('3 отв.')
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
  it('без нарушений axe: список, форма создания, карточка пользователя', async () => {
    renderAdmin({ selected: 'bob' })
    await expectNoViolations()
    expectLabelledIconButtons()
  })
})

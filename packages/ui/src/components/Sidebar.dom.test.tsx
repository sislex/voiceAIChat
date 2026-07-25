import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from './Sidebar'
import type { Conversation } from '@shared/types'
import type { AgentInfo } from '@shared/agentProtocol'

function conv(id: string, title: string): Conversation {
  return { id, title, updatedAt: 1, messageCount: 2, execTarget: id === 'c1' ? 'm1' : null } as Conversation
}

function setup(overrides: Record<string, unknown> = {}) {
  const props = {
    conversations: [conv('c1', 'Чат 1'), conv('c2', 'Чат 2')],
    activeId: 'c1',
    now: 1,
    onNew: vi.fn(),
    onPick: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    searchQuery: '',
    onSearch: vi.fn(),
    onOpenObserver: vi.fn(),
    onOpenCodexObserver: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides
  }
  render(<Sidebar {...props} />)
  return props
}

describe('Sidebar — статус работы чата', () => {
  it('чат с активным ходом → «идёт работа», остальные → «не ведётся»', () => {
    setup({ workingIds: ['c1'] })
    expect(screen.getAllByText(/идёт работа|не ведётся/)).toHaveLength(2)
    expect(screen.getByText('идёт работа')).toBeInTheDocument()
    expect(screen.getByText('не ведётся')).toBeInTheDocument()
  })

  it('без активных ходов → у всех «не ведётся»', () => {
    setup({ workingIds: [] })
    expect(screen.getAllByText('не ведётся')).toHaveLength(2)
    expect(screen.queryByText('идёт работа')).not.toBeInTheDocument()
  })
})


describe('Sidebar — машина отдельного чата', () => {
  const agent = {
    id: 'm1',
    name: 'MacBook',
    online: true,
    createdAt: 1,
    lastSeen: 1,
    policy: { allowedDirs: [], allowNetwork: true, allowWrite: true, denyPatterns: [], allowPatterns: [], skills: [] }
  } as AgentInfo

  it('показывает свой выбор у каждого чата и меняет только выбранный', async () => {
    const onChangeExecTarget = vi.fn()
    setup({ agents: [agent], onChangeExecTarget })

    const first = screen.getByLabelText('Машина чата «Чат 1»') as HTMLSelectElement
    const second = screen.getByLabelText('Машина чата «Чат 2»') as HTMLSelectElement
    expect(first.value).toBe('m1')
    expect(second.value).toBe('')

    await userEvent.selectOptions(second, 'none')
    expect(onChangeExecTarget).toHaveBeenCalledWith('c2', 'none')
    expect(first.value).toBe('m1')
  })
})

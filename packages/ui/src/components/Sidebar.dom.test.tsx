import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import type { Conversation } from '@shared/types'

function conv(id: string, title: string): Conversation {
  return { id, title, updatedAt: 1, messageCount: 2 } as Conversation
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

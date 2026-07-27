import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import type { Conversation } from '@shared/types'
import type { AgentInfo } from '@shared/agentProtocol'

function conv(id: string, title: string): Conversation {
  return { id, title, updatedAt: 1, messageCount: 2, execTarget: null, lastExecTarget: id === 'c1' ? 'm1' : 'none', status: id === 'c1' ? 'developing' : 'planned', permissionMode: id === 'c1' ? 'plan' : 'default' } as Conversation
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
  it('в простое показывает persistent-статусы в выпадающих списках', () => {
    setup({ workingIds: [] })
    const statuses = screen.getAllByRole('combobox') as HTMLSelectElement[]
    expect(statuses.map((select) => select.value)).toEqual(['developing', 'planned'])
    expect(screen.queryByText('планирую')).not.toBeInTheDocument()
  })

  it('во время хода пульсирует режимом: «планирую» или «разрабатываю»', () => {
    setup({ workingIds: ['c1', 'c2'] })
    expect(screen.getByText('планирую')).toBeInTheDocument()
    expect(screen.getByText('разрабатываю')).toBeInTheDocument()
    expect(document.querySelectorAll('.cstatus.on')).toHaveLength(2)
  })

  it('передаёт ручную смену статуса и не открывает чат', () => {
    const onStatusChange = vi.fn()
    const onPick = vi.fn()
    setup({ workingIds: [], onStatusChange, onPick })
    fireEvent.change(screen.getByLabelText('Статус разговора «Чат 1»'), {
      target: { value: 'development_done' }
    })
    expect(onStatusChange).toHaveBeenCalledWith('c1', 'development_done')
    expect(onPick).not.toHaveBeenCalled()
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
    expect(screen.getAllByLabelText(/Статус разговора/)).toHaveLength(2)
  })
})

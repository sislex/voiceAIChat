import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import type { Conversation, SessionUser } from '@shared/types'
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


describe('Sidebar — инструменты в меню по клику на пользователя', () => {
  const user = { name: 'Алекс', role: 'admin' } as SessionUser

  it('иконки виджетов лежат в меню аккаунта, а не в отдельном ряду', () => {
    const onOpenObserver = vi.fn()
    setup({
      currentUser: user,
      onOpenObserver,
      onOpenCodexObserver: vi.fn(),
      onOpenKnowledgeBase: vi.fn(),
      onOpenProjects: vi.fn(),
      onOpenFiles: vi.fn(),
      onOpenConsole: vi.fn(),
      onOpenMachines: vi.fn(),
      onOpenUsers: vi.fn(),
      onLogout: vi.fn()
    })

    // Отдельного нижнего ряда иконок больше нет.
    expect(document.querySelector('.foottools')).toBeNull()
    // До клика меню (и его пункты) не отрисованы.
    expect(screen.queryByText('Claude Code')).not.toBeInTheDocument()

    // Клик по пользователю открывает всплывающее меню с инструментами.
    fireEvent.click(screen.getByRole('button', { name: /Алекс/ }))
    const menu = screen.getByRole('menu')
    for (const label of ['Claude Code', 'Codex', 'Проекты', 'База знаний', 'Проводник', 'Консоль']) {
      expect(within(menu).getByText(label)).toBeInTheDocument()
    }
    // Управление и настройки — там же.
    expect(within(menu).getByText('Машины')).toBeInTheDocument()
    expect(within(menu).getByText('Настройки')).toBeInTheDocument()

    // Пункт-инструмент кликабелен и вызывает свой обработчик.
    fireEvent.click(within(menu).getByText('Claude Code'))
    expect(onOpenObserver).toHaveBeenCalledTimes(1)
  })

  it('в локальном режиме без учётки инструменты остаются рядом иконок', () => {
    setup({ onOpenFiles: vi.fn(), onOpenConsole: vi.fn() })
    expect(document.querySelector('.foottools')).not.toBeNull()
    expect(screen.getByLabelText('Claude Code')).toBeInTheDocument()
    expect(screen.getByLabelText('Открыть консоль')).toBeInTheDocument()
  })
})

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

  it('переключатель показывает проекты с ролями, клик по проекту зовёт onPickProject', async () => {
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

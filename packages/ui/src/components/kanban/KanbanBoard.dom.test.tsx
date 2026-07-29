import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KanbanBoard, type KanbanBoardProps } from './KanbanBoard'
import type { Board, Task } from '@shared/projects'

const task = (over: Partial<Task>): Task => ({
  id: 't', projectId: 'p1', columnId: 'c1', type: 'task', parentId: null, title: 'T', description: '',
  acceptanceCriteria: '', priority: 'medium', assignee: null, labels: [], storyPoints: null, dueDate: null,
  flagged: false, seq: 1, position: 1024, createdAt: 1, updatedAt: 1, ...over
})

const board: Board = {
  columns: [
    { id: 'c1', projectId: 'p1', name: 'To Do', semanticType: 'backlog', position: 1024, hidden: false, wipLimit: null, createdAt: 1 },
    { id: 'c2', projectId: 'p1', name: 'Скрытая', semanticType: 'custom', position: 2048, hidden: true, wipLimit: null, createdAt: 1 }
  ],
  tasks: [task({ id: 't1', title: 'A' })]
}

function renderBoard(props: Partial<KanbanBoardProps> = {}): KanbanBoardProps {
  const full: KanbanBoardProps = {
    projectName: 'P1',
    board,
    loading: false,
    members: [],
    onCreateColumn: vi.fn(),
    onUpdateColumn: vi.fn(),
    onSetColumnHidden: vi.fn(),
    onReorderColumns: vi.fn(),
    onDeleteColumn: vi.fn(),
    onCreateTask: vi.fn(),
    onUpdateTask: vi.fn(),
    onMoveTask: vi.fn(),
    onDeleteTask: vi.fn(),
    ...props
  }
  render(<KanbanBoard {...full} />)
  return full
}

describe('KanbanBoard (изолированный)', () => {
  it('ошибка показывается баннером role=alert; без board — только баннер', () => {
    renderBoard({ board: null, error: 'Сервер недоступен' })
    expect(screen.getByRole('alert')).toHaveTextContent('Сервер недоступен')
    expect(screen.queryByTestId('kanban-board')).not.toBeInTheDocument()
  })

  it('чекбокс «скрытые» в панели фильтров показывает скрытые колонки', async () => {
    renderBoard()
    expect(screen.getAllByTestId('kanban-column')).toHaveLength(1)
    const filters = screen.getByTestId('board-filters')
    await userEvent.click(within(filters).getByRole('checkbox', { name: /скрытые/ }))
    expect(screen.getAllByTestId('kanban-column')).toHaveLength(2)
    expect(screen.getByText('Скрытая')).toBeInTheDocument()
  })

  it('битые данные рендерятся без падения, seq 0 даёт ключ «P1-?»', () => {
    const broken = {
      columns: [{ id: 'c1', projectId: 'p1', name: '', semanticType: 'x', position: 'a', hidden: 0, wipLimit: -5, createdAt: 1 }],
      tasks: [{ id: 'tb', projectId: 'p1', columnId: 'c1', type: 'bug', parentId: 'ghost', title: '', description: 1,
        acceptanceCriteria: null, priority: 'критический', assignee: 7, labels: 'ui', storyPoints: -1, dueDate: 'x',
        flagged: 'y', seq: undefined, position: null, createdAt: 1, updatedAt: 1 }]
    } as unknown as Board
    renderBoard({ board: broken })
    expect(screen.getByText('(без названия)')).toBeInTheDocument()
    expect(screen.getByText('P1-?')).toBeInTheDocument()
    expect(screen.getByText('(колонка)')).toBeInTheDocument()
  })

  it('без openTaskId-пропсов модалка управляется внутренним состоянием', async () => {
    renderBoard()
    await userEvent.click(screen.getByText('A'))
    expect(await screen.findByTestId('task-modal')).toBeInTheDocument()
  })
})

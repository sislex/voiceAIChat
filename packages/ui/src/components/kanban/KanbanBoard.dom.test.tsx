import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KanbanBoard, type KanbanBoardProps } from './KanbanBoard'
import type { Board, Task } from '@shared/projects'
import type { GenerateParams } from '../prompt-builder/PromptBuilder'

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


  it('AI-помощник применяет результат в описание карточки и сохраняет задачу', async () => {
    const generateAiAssist = vi.fn(async (_params: GenerateParams) => [{ id: 's1', text: 'Готовое AI-описание задачи' }])
    const props = renderBoard({
      aiAssistPrompts: [
        { id: 'system', title: 'Кратко', text: 'Пиши кратко', enabled: true, readonly: true },
        { id: 'off', title: 'Неактивный', text: 'Не использовать', enabled: false }
      ],
      generateAiAssist
    })

    await userEvent.click(screen.getByText('A'))
    const description = await screen.findByLabelText('Описание задачи')
    expect(description).toHaveAttribute('data-ai-assist')
    await userEvent.click(screen.getByRole('button', { name: 'Открыть AI-помощник' }))
    await userEvent.type(screen.getByLabelText('Что нужно сформулировать'), 'Опиши задачу')
    expect(generateAiAssist).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Предложить варианты' }))
    expect(await screen.findByText('Готовое AI-описание задачи', {}, { timeout: 2000 })).toBeInTheDocument()

    expect(generateAiAssist).toHaveBeenCalledTimes(1)
    expect(generateAiAssist.mock.calls[0]![0].modifiers.map((item) => item.id)).toEqual(['system'])
    const assistant = within(screen.getByRole('dialog', { name: 'AI-помощник формулировки' }))
    await userEvent.click(assistant.getByRole('button', { name: 'Добавить' }))
    await userEvent.click(assistant.getByRole('button', { name: 'Применить' }))

    expect(description).toHaveValue('Готовое AI-описание задачи')
    expect(props.onUpdateTask).toHaveBeenCalledWith('t1', { description: 'Готовое AI-описание задачи' })
    expect(screen.queryByRole('dialog', { name: 'AI-помощник формулировки' })).not.toBeInTheDocument()
  })

  it('без openTaskId-пропсов модалка управляется внутренним состоянием', async () => {
    renderBoard()
    await userEvent.click(screen.getByText('A'))
    expect(await screen.findByTestId('task-modal')).toBeInTheDocument()
  })
})

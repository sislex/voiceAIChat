import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectBoard, type ProjectBoardProps } from './ProjectBoard'
import type { Board } from '@shared/projects'

const board: Board = {
  columns: [
    { id: 'c1', projectId: 'p1', name: 'To Do', semanticType: 'backlog', position: 1024, hidden: false, createdAt: 1 },
    { id: 'c2', projectId: 'p1', name: 'Done', semanticType: 'done', position: 2048, hidden: false, createdAt: 1 }
  ],
  tasks: [
    { id: 't1', projectId: 'p1', columnId: 'c1', type: 'task', parentId: null, acceptanceCriteria: '', title: 'A', description: '', priority: 'medium', assignee: null, position: 1024, createdAt: 1, updatedAt: 1 },
    { id: 't2', projectId: 'p1', columnId: 'c1', type: 'task', parentId: null, acceptanceCriteria: '', title: 'B', description: '', priority: 'high', assignee: null, position: 2048, createdAt: 1, updatedAt: 1 }
  ]
}

function renderBoard(props: Partial<ProjectBoardProps> = {}): ProjectBoardProps {
  const full: ProjectBoardProps = {
    projectName: 'P1',
    board,
    loading: false,
    members: [],
    onCreateColumn: vi.fn(),
    onRenameColumn: vi.fn(),
    onSetColumnHidden: vi.fn(),
    onReorderColumns: vi.fn(),
    onDeleteColumn: vi.fn(),
    onCreateTask: vi.fn(),
    onUpdateTask: vi.fn(),
    onMoveTask: vi.fn(),
    onDeleteTask: vi.fn(),
    onClose: vi.fn(),
    ...props
  }
  render(<ProjectBoard {...full} />)
  return full
}

describe('ProjectBoard', () => {
  it('рендерит колонки и карточки', () => {
    renderBoard()
    expect(screen.getAllByTestId('kanban-column')).toHaveLength(2)
    expect(screen.getAllByTestId('task-card')).toHaveLength(2)
  })

  it('создание задачи по Enter зовёт onCreateTask с id колонки', async () => {
    const p = renderBoard()
    const input = screen.getByLabelText('Новая задача в «To Do»')
    await userEvent.type(input, 'Новая{enter}')
    expect(p.onCreateTask).toHaveBeenCalledWith('c1', { title: 'Новая', type: 'task' })
  })

  it('для Story требует выбрать родительский Epic и передаёт parentId', async () => {
    const epic = { id: 'e1', projectId: 'p1', columnId: 'c1', type: 'epic' as const, parentId: null, acceptanceCriteria: '', title: 'Авторизация', description: '', priority: 'medium' as const, assignee: null, position: 3072, createdAt: 1, updatedAt: 1 }
    const p = renderBoard({ board: { ...board, tasks: [...board.tasks, epic] } })
    await userEvent.selectOptions(screen.getByLabelText('Тип нового элемента в «To Do»'), 'story')
    const input = screen.getByLabelText('Новая задача в «To Do»')
    await userEvent.type(input, 'OAuth{enter}')
    expect(p.onCreateTask).not.toHaveBeenCalled()

    await userEvent.selectOptions(screen.getByLabelText('Родительский эпик для истории в «To Do»'), 'e1')
    await userEvent.type(input, '{enter}')
    expect(p.onCreateTask).toHaveBeenCalledWith('c1', { title: 'OAuth', type: 'story', parentId: 'e1' })
  })

  it('после failed Feature показывает кнопку повторной попытки', async () => {
    const p = renderBoard({
      features: [{ id: 'f1', projectId: 'p1', sourceTaskId: 't1', attempt: 1, previousFeatureId: null, conversationId: 'chat1', repositorySlotId: null, title: 'A', description: '', status: 'failed', deployStatus: 'not_requested', baseBranch: 'main', featureBranch: 'feature/f1', baseCommitSha: null, testedCommitSha: null, mergedCommitSha: null, commitPolicy: 'agent_commits', mergeTransport: 'local', agentPlanApprovalMode: 'automatic', autoMerge: false, autoDeployProduction: false, createdAt: 1, updatedAt: 2, completedAt: null, lastError: 'clone failed', version: 2 }],
      onStartFeature: vi.fn()
    })
    await userEvent.click(screen.getByRole('button', { name: 'Повторить фичу' }))
    expect(p.onStartFeature).toHaveBeenCalledWith('t1', 'task')
  })

  it('добавление колонки зовёт onCreateColumn', async () => {
    const p = renderBoard()
    await userEvent.type(screen.getByLabelText('Новая колонка'), 'Review')
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))
    expect(p.onCreateColumn).toHaveBeenCalledWith('Review')
  })

  it('drag-drop задачи в верхнюю зону колонки зовёт onMoveTask с соседями', () => {
    const p = renderBoard()
    const { container } = { container: document.body }
    const dt = { setData: () => {}, getData: () => 't2', effectAllowed: '' }
    const cards = screen.getAllByTestId('task-card')
    fireEvent.dragStart(cards[1], { dataTransfer: dt }) // тащим B (t2)
    const zones = container.querySelectorAll('.kanban-dropzone')
    // zones[0] — верх колонки c1: after=null, before=t1
    fireEvent.dragOver(zones[0], { dataTransfer: dt })
    fireEvent.drop(zones[0], { dataTransfer: dt })
    expect(p.onMoveTask).toHaveBeenCalledWith('t2', 'c1', null, 't1')
  })
})

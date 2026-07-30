import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent, within } from '@testing-library/react'
import { render } from '../test/uiRender'
import userEvent from '@testing-library/user-event'
import { ProjectBoard, type ProjectBoardProps } from './ProjectBoard'
import type { Board, Task } from '@shared/projects'

const task = (over: Partial<Task>): Task => ({
  id: 't', projectId: 'p1', columnId: 'c1', type: 'task', parentId: null, title: 'T', description: '',
  acceptanceCriteria: '', priority: 'medium', assignee: null, labels: [], skills: [], storyPoints: null, dueDate: null,

  flagged: false, seq: 1, position: 1024, createdAt: 1, updatedAt: 1, ...over
})

const board: Board = {
  columns: [
    { id: 'c1', projectId: 'p1', name: 'To Do', semanticType: 'backlog', position: 1024, hidden: false, wipLimit: null, createdAt: 1 },
    { id: 'c2', projectId: 'p1', name: 'Done', semanticType: 'done', position: 2048, hidden: false, wipLimit: null, createdAt: 1 }
  ],
  tasks: [
    task({ id: 't1', title: 'A', seq: 1 }),
    task({ id: 't2', title: 'B', priority: 'high', seq: 2, position: 2048 })
  ]
}

function renderBoard(props: Partial<ProjectBoardProps> = {}): ProjectBoardProps {
  const full: ProjectBoardProps = {
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
    onClose: vi.fn(),
    ...props
  }
  render(<ProjectBoard {...full} />)
  return full
}

describe('ProjectBoard', () => {
  it('рендерит колонки и карточки с ключами Jira', () => {
    renderBoard()
    expect(screen.getAllByTestId('kanban-column')).toHaveLength(2)
    expect(screen.getAllByTestId('task-card')).toHaveLength(2)
    expect(screen.getByText('P1-1')).toBeInTheDocument()
    expect(screen.getByText('P1-2')).toBeInTheDocument()
  })

  it('создание задачи: «+ Создать» открывает композер, Enter зовёт onCreateTask', async () => {
    const p = renderBoard()
    await userEvent.click(screen.getByLabelText('Создать элемент в «To Do»'))
    const input = screen.getByLabelText('Новая задача в «To Do»')
    await userEvent.type(input, 'Новая{enter}')
    expect(p.onCreateTask).toHaveBeenCalledWith('c1', { title: 'Новая', type: 'task' })
  })

  it('для Story требует выбрать родительский Epic и передаёт parentId', async () => {
    const epic = task({ id: 'e1', type: 'epic', title: 'Авторизация', seq: 3, position: 3072 })
    const p = renderBoard({ board: { ...board, tasks: [...board.tasks, epic] } })
    await userEvent.click(screen.getByLabelText('Создать элемент в «To Do»'))
    await userEvent.selectOptions(screen.getByLabelText('Тип нового элемента в «To Do»'), 'story')
    const input = screen.getByLabelText('Новая задача в «To Do»')
    await userEvent.type(input, 'OAuth{enter}')
    expect(p.onCreateTask).not.toHaveBeenCalled()

    await userEvent.selectOptions(screen.getByLabelText('Родительский эпик для истории в «To Do»'), 'e1')
    await userEvent.type(input, '{enter}')
    expect(p.onCreateTask).toHaveBeenCalledWith('c1', { title: 'OAuth', type: 'story', parentId: 'e1' })
  })

  it('добавление колонки зовёт onCreateColumn', async () => {
    const p = renderBoard()
    await userEvent.type(screen.getByLabelText('Новая колонка'), 'Review')
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))
    expect(p.onCreateColumn).toHaveBeenCalledWith('Review')
  })

  it('drag-drop задачи в верхнюю зону колонки зовёт onMoveTask с соседями', () => {
    const p = renderBoard()
    const dt = { setData: () => {}, getData: () => 't2', effectAllowed: '' }
    const cards = screen.getAllByTestId('task-card')
    fireEvent.dragStart(cards[1], { dataTransfer: dt }) // тащим B (t2)
    const zones = document.body.querySelectorAll('.kanban-dropzone')
    // zones[0] — верх колонки c1: after=null, before=t1
    fireEvent.dragOver(zones[0], { dataTransfer: dt })
    fireEvent.drop(zones[0], { dataTransfer: dt })
    expect(p.onMoveTask).toHaveBeenCalledWith('t2', 'c1', null, 't1')
  })

  it('поиск фильтрует карточки и показывает «N из M» в шапке колонки', async () => {
    renderBoard()
    await userEvent.type(screen.getByLabelText('Поиск на доске'), 'B')
    expect(screen.getAllByTestId('task-card')).toHaveLength(1)
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getByText('1 из 2')).toBeInTheDocument()
  })

  it('быстрый фильтр «С флагом» оставляет только помеченные карточки', async () => {
    renderBoard({ board: { ...board, tasks: [task({ id: 't1', title: 'A', flagged: true }), task({ id: 't2', title: 'B', seq: 2 })] } })
    await userEvent.click(screen.getByRole('button', { name: 'С флагом' }))
    expect(screen.getAllByTestId('task-card')).toHaveLength(1)
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('меню карточки: «Добавить флаг» зовёт onUpdateTask(flagged)', async () => {
    const p = renderBoard()
    await userEvent.click(screen.getByLabelText('Действия с «A»'))
    await userEvent.click(screen.getByRole('button', { name: 'Добавить флаг' }))
    expect(p.onUpdateTask).toHaveBeenCalledWith('t1', { flagged: true })
  })

  it('клик по карточке открывает модалку задачи, смена статуса зовёт onMoveTask', async () => {
    const p = renderBoard()
    await userEvent.click(screen.getByText('A'))
    const modal = await screen.findByTestId('task-modal')
    await userEvent.selectOptions(within(modal).getByLabelText('Статус'), 'c2')
    expect(p.onMoveTask).toHaveBeenCalledWith('t1', 'c2', null, null)
  })

  it('WIP-лимит: превышение подсвечивает счётчик «N/лимит»', () => {
    renderBoard({
      board: { ...board, columns: [{ ...board.columns[0], wipLimit: 1 }, board.columns[1]] }
    })
    const wip = screen.getByTitle('WIP-лимит: 1')
    expect(wip).toHaveTextContent('2/1')
    expect(wip.className).toContain('jcol-wip--over')
  })

  it('свимлейны по эпикам: карточки группируются, эпики не показываются как карточки', async () => {
    const epic = task({ id: 'e1', type: 'epic', title: 'Эпик1', seq: 3 })
    const story = task({ id: 's1', type: 'story', parentId: 'e1', title: 'Стори', seq: 4 })
    renderBoard({ board: { ...board, tasks: [epic, story, task({ id: 't9', title: 'Одинокая', seq: 5 })] } })
    await userEvent.selectOptions(screen.getByLabelText('Свимлейны'), 'epic')
    const lanes = screen.getAllByTestId('swimlane')
    expect(lanes).toHaveLength(2) // Эпик1 + «Без эпика»
    expect(within(lanes[0]).getByText('Стори')).toBeInTheDocument()
    expect(within(lanes[1]).getByText('Одинокая')).toBeInTheDocument()
    expect(screen.queryByText('P1-3')).not.toBeInTheDocument() // карточки эпика нет
  })

  it('меню колонки: WIP-лимит сохраняется через onUpdateColumn', async () => {
    const p = renderBoard()
    await userEvent.click(screen.getByLabelText('Меню колонки «To Do»'))
    await userEvent.click(screen.getByRole('button', { name: 'WIP-лимит…' }))
    await userEvent.type(screen.getByLabelText('WIP-лимит'), '3{enter}')
    expect(p.onUpdateColumn).toHaveBeenCalledWith('c1', { wipLimit: 3 })
  })
})

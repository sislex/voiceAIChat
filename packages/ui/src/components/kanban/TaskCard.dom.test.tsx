import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Task } from '@shared/projects'
import type { CiRunSummary } from '@shared/ci'
import { TaskCard, type TaskCardProps } from './TaskCard'

function mkTask(over: Partial<Task> = {}): Task {
  return {
    id: 't1', projectId: 'p1', columnId: 'c1', type: 'task', parentId: null, title: 'Задача A',
    description: '', acceptanceCriteria: '', priority: 'medium', assignee: null, labels: [], skills: [],
    storyPoints: null, dueDate: null, flagged: false, seq: 1, position: 1024, createdAt: 1, updatedAt: 1, ...over
  } as Task
}

function props(over: Partial<TaskCardProps> = {}): TaskCardProps {
  return {
    task: mkTask(), projectName: 'Proj', allTasks: [], doneColumnIds: new Set(),
    onOpen: vi.fn(), onUpdate: vi.fn(), onDelete: vi.fn(), onMoveTop: vi.fn(), onMoveBottom: vi.fn(),
    onDragStart: vi.fn(), onDragEnd: vi.fn(), dragging: false, ...over
  }
}


describe('TaskCard связанный чат', () => {
  it('постоянно показывает действие и открывает чат, не открывая карточку', () => {
    const onOpenChat = vi.fn()
    const onOpen = vi.fn()
    render(<TaskCard {...props({ onOpenChat, onOpen })} />)

    const chatButton = screen.getByRole('button', { name: 'Связанный чат' })
    expect(chatButton).toHaveTextContent('Чат')
    fireEvent.click(chatButton)

    expect(onOpenChat).toHaveBeenCalledWith('t1')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('объясняет, создаст ли новый чат или откроет существующий', () => {
    const { rerender } = render(<TaskCard {...props({ onOpenChat: vi.fn() })} />)
    expect(screen.getByRole('button', { name: 'Связанный чат' })).toHaveAttribute('title', 'Создать связанный чат')

    rerender(<TaskCard {...props({ task: mkTask({ chatId: 'chat-1' }), onOpenChat: vi.fn() })} />)
    expect(screen.getByRole('button', { name: 'Связанный чат' })).toHaveAttribute('title', 'Открыть связанный чат')
  })
})

describe('TaskCard CI-панель', () => {
  it('кнопка «Выполнить» вызывает onStartCi', () => {
    const onStartCi = vi.fn()
    render(<TaskCard {...props({ onStartCi })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Выполнить' }))
    expect(onStartCi).toHaveBeenCalledWith('t1')
  })

  it('показывает сводку рана и открывает ленту', () => {
    const onOpenCiRun = vi.fn()
    const ciSummary: CiRunSummary = { id: 'run-1', taskId: 't1', status: 'running', slotProgress: { done: 1, total: 4, phase: 'до модели' }, durationMs: null, modelActive: false, awaitingInput: false }
    render(<TaskCard {...props({ ciSummary, onOpenCiRun, onStartCi: vi.fn() })} />)
    expect(screen.getByText('выполняется')).toBeInTheDocument()
    expect(screen.getByText(/до модели 1\/4/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Лента рана' }))
    expect(onOpenCiRun).toHaveBeenCalledWith('run-1')
  })
})

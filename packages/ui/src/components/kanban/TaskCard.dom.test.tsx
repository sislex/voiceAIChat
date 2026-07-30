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


function mkSummary(over: Partial<CiRunSummary> = {}): CiRunSummary {
  return { id: 'run-1', taskId: 't1', status: 'running', slotProgress: { done: 1, total: 4, phase: 'Модель работает' }, durationMs: null, modelActive: true, awaitingInput: false, ...over }
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

  it('пока ран идёт, «Выполнить» недоступна — остаётся только лента', () => {
    for (const status of ['queued', 'running', 'awaiting_input'] as const) {
      const ciSummary = mkSummary({ status, awaitingInput: status === 'awaiting_input' })
      const { unmount } = render(<TaskCard {...props({ ciSummary, onOpenCiRun: vi.fn(), onStartCi: vi.fn() })} />)
      expect(screen.queryByRole('button', { name: 'Выполнить' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: status === 'awaiting_input' ? 'Ответить модели' : 'Лента рана' })).toBeInTheDocument()
      unmount()
    }
  })

  it('после завершения рана кнопка запуска возвращается', () => {
    const onStartCi = vi.fn()
    render(<TaskCard {...props({ ciSummary: mkSummary({ status: 'success' }), onOpenCiRun: vi.fn(), onStartCi })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Выполнить' }))
    expect(onStartCi).toHaveBeenCalledWith('t1')
  })
})

describe('TaskCard подсветка по состоянию рана', () => {
  const cases: Array<[string, CiRunSummary, string]> = [
    ['ран идёт — голубая рамка', mkSummary({ status: 'running' }), 'jcard--ci-running'],
    ['модель чинит ошибку — красная', mkSummary({ status: 'running', slotProgress: { done: 2, total: 4, phase: 'Модель исправляет ошибку', fixing: true } }), 'jcard--ci-fixing'],
    ['ждёт ответа — жёлтая', mkSummary({ status: 'awaiting_input', awaitingInput: true }), 'jcard--ci-awaiting'],
    ['упал — красная', mkSummary({ status: 'failed' }), 'jcard--ci-failed'],
    ['успех — зелёная', mkSummary({ status: 'success' }), 'jcard--ci-done']
  ]

  for (const [name, ciSummary, cls] of cases) {
    it(name, () => {
      render(<TaskCard {...props({ ciSummary, onOpenCiRun: vi.fn(), onStartCi: vi.fn() })} />)
      expect(screen.getByTestId('task-card').className).toContain(cls)
    })
  }

  it('без рана и после отмены подсветки нет', () => {
    const { unmount } = render(<TaskCard {...props({ onStartCi: vi.fn() })} />)
    expect(screen.getByTestId('task-card').className).not.toContain('jcard--ci-')
    unmount()
    render(<TaskCard {...props({ ciSummary: mkSummary({ status: 'cancelled' }), onOpenCiRun: vi.fn(), onStartCi: vi.fn() })} />)
    expect(screen.getByTestId('task-card').className).not.toContain('jcard--ci-')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Board, Task } from '@shared/projects'
import type { CiRunSummary } from '@shared/ci'
import { TaskModal, type TaskModalProps } from './TaskModal'
import { createFakeCi } from '../../test/fakeApi'

function mkTask(over: Partial<Task> = {}): Task {
  return {
    id: 't1', projectId: 'p1', columnId: 'c1', type: 'task', parentId: null, title: 'Задача A',
    description: '', acceptanceCriteria: '', priority: 'medium', assignee: null, labels: [], skills: [],
    storyPoints: null, dueDate: null, flagged: false, seq: 1, position: 1024, createdAt: 1, updatedAt: 1, ...over
  } as Task
}

const board: Board = { columns: [{ id: 'c1', projectId: 'p1', name: 'Разработка', semanticType: 'development', position: 1024, hidden: false, wipLimit: null, createdAt: 1 }], tasks: [] }

function props(over: Partial<TaskModalProps> = {}): TaskModalProps {
  return {
    task: mkTask(), board, projectName: 'Proj', members: [],
    onUpdate: vi.fn(), onDelete: vi.fn(), onMoveToColumn: vi.fn(), onOpenTask: vi.fn(), onClose: vi.fn(),
    ...over
  }
}

function mkSummary(over: Partial<CiRunSummary> = {}): CiRunSummary {
  return { id: 'run-1', taskId: 't1', status: 'running', slotProgress: { done: 1, total: 4, phase: 'Модель работает' }, durationMs: null, modelActive: true, awaitingInput: false, ...over }
}

describe('TaskModal — связанный чат создаётся при открытии карточки', () => {
  beforeEach(() => { window.ci = createFakeCi() })

  it('у таска без чата зовёт onEnsureChat один раз', () => {
    const onEnsureChat = vi.fn()
    render(<TaskModal {...props({ onEnsureChat })} />)
    expect(onEnsureChat).toHaveBeenCalledWith('t1')
    expect(onEnsureChat).toHaveBeenCalledTimes(1)
  })

  it('если чат уже есть — не зовёт', () => {
    const onEnsureChat = vi.fn()
    render(<TaskModal {...props({ task: mkTask({ chatId: 'c1' }), onEnsureChat })} />)
    expect(onEnsureChat).not.toHaveBeenCalled()
  })

  it('для эпика чат не создаётся (у эпиков нет ранов)', () => {
    const onEnsureChat = vi.fn()
    render(<TaskModal {...props({ task: mkTask({ type: 'epic' }), onEnsureChat })} />)
    expect(onEnsureChat).not.toHaveBeenCalled()
  })
})

describe('TaskModal — панель CI-рана', () => {
  beforeEach(() => { window.ci = createFakeCi() })

  it('показывает статус и ведёт в ленту рана', () => {
    const onOpenCiRun = vi.fn()
    const onStartCi = vi.fn()
    render(<TaskModal {...props({ ciSummary: mkSummary(), onOpenCiRun, onStartCi })} />)

    const panel = screen.getByTestId('task-modal-ci')
    expect(panel).toHaveTextContent('выполняется')
    expect(panel).toHaveTextContent('Модель работает 1/4')

    fireEvent.click(screen.getByRole('button', { name: 'Лента рана' }))
    expect(onOpenCiRun).toHaveBeenCalledWith('run-1')
    // Ран идёт — повторный запуск недоступен.
    expect(screen.queryByRole('button', { name: 'Выполнить' })).not.toBeInTheDocument()
    expect(onStartCi).not.toHaveBeenCalled()
  })

  it('после завершения рана «Выполнить» снова доступна', () => {
    const onStartCi = vi.fn()
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }), onOpenCiRun: vi.fn(), onStartCi })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Выполнить' }))
    expect(onStartCi).toHaveBeenCalledWith('t1')
  })

  it('когда ран ждёт ответа, кнопка зовёт ответить', () => {
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'awaiting_input', awaitingInput: true }), onOpenCiRun: vi.fn(), onStartCi: vi.fn() })} />)
    expect(screen.getByTestId('task-modal-ci')).toHaveTextContent('ждёт ответа')
    expect(screen.getByRole('button', { name: 'Ответить модели' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Выполнить' })).not.toBeInTheDocument()
  })

  it('у эпика панели рана нет', () => {
    render(<TaskModal {...props({ task: mkTask({ type: 'epic' }), onStartCi: vi.fn() })} />)
    expect(screen.queryByTestId('task-modal-ci')).not.toBeInTheDocument()
  })
})

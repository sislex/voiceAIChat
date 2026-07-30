import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Board, Task } from '@shared/projects'
import type { CiRunSummary } from '@shared/ci'
import { TaskModal, type TaskModalProps } from './TaskModal'
import { createFakeCi } from '../../test/fakeApi'
import { MOBILE_QUERY } from '../../lib/mediaQuery'

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

describe('TaskModal — вложенное окно AI-помощника', () => {
  beforeEach(() => { window.ci = createFakeCi() })

  it('Esc закрывает только помощника, карточка остаётся открытой', async () => {
    const onClose = vi.fn()
    render(<TaskModal {...props({ onClose, generateAiAssist: async () => [] })} />)

    await userEvent.click(screen.getByRole('button', { name: 'Открыть AI-помощник' }))
    expect(screen.getByRole('dialog', { name: 'AI-помощник формулировки' })).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'AI-помощник формулировки' })).not.toBeInTheDocument()
    expect(screen.getByTestId('task-modal')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    // Второй Esc достаётся уже карточке.
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
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

/**
 * Ширина экрана для карточки: она смотрит на matchMedia (lib/mediaQuery), потому
 * что мобильная раскладка — другая разметка, а не только другие стили.
 * Дефолт тестов — десктоп (см. src/test/setup.ts).
 */
function setMobile(mobile: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: mobile && query === MOBILE_QUERY,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia
}

describe('TaskModal — мобильная раскладка (как в Jira)', () => {
  beforeEach(() => { window.ci = createFakeCi() })
  afterEach(() => { setMobile(false) })

  it('статус и исполнитель — над описанием, остальные поля свёрнуты', () => {
    setMobile(true)
    render(<TaskModal {...props()} />)

    const quick = screen.getByTestId('task-modal-quick')
    expect(quick).toContainElement(screen.getByLabelText('Статус'))
    expect(quick).toContainElement(screen.getByLabelText('Исполнитель'))
    // Порядок: статус выше описания (в Jira он первым делом под заголовком).
    const desc = screen.getByLabelText('Описание задачи')
    expect(quick.compareDocumentPosition(desc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    expect(screen.queryByTestId('task-modal-details')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Приоритет')).not.toBeInTheDocument()
  })

  it('«Подробности» раскрываются и сворачиваются', async () => {
    setMobile(true)
    render(<TaskModal {...props()} />)

    const toggle = screen.getByRole('button', { name: /Подробности/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('task-modal-details')).toBeInTheDocument()
    expect(screen.getByLabelText('Приоритет')).toBeInTheDocument()
    // Статус не дублируется: он остаётся наверху, а не уезжает в «Подробности».
    expect(screen.getAllByLabelText('Статус')).toHaveLength(1)

    fireEvent.click(toggle)
    expect(screen.queryByTestId('task-modal-details')).not.toBeInTheDocument()
  })

  it('действия шапки живут в ⋯-меню', () => {
    const onUpdate = vi.fn()
    const onOpenChat = vi.fn()
    setMobile(true)
    render(<TaskModal {...props({ onUpdate, onOpenChat })} />)

    // В шапке из подписанных кнопок — только ⋯ и закрытие.
    expect(screen.queryByLabelText('Удалить задачу')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Открыть чат|Создать чат/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Действия с задачей'))
    fireEvent.click(screen.getByRole('button', { name: /Создать чат/ }))
    expect(onOpenChat).toHaveBeenCalledWith('t1')

    fireEvent.click(screen.getByLabelText('Действия с задачей'))
    fireEvent.click(screen.getByRole('button', { name: /Флаг/ }))
    expect(onUpdate).toHaveBeenCalledWith('t1', { flagged: true })
    // Пункт выбран — меню закрылось.
    expect(screen.queryByRole('button', { name: /Удалить задачу/ })).not.toBeInTheDocument()
  })

  it('удаление из ⋯-меню спрашивает подтверждение и закрывает карточку', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onDelete = vi.fn()
    const onClose = vi.fn()
    setMobile(true)
    render(<TaskModal {...props({ onDelete, onClose })} />)

    fireEvent.click(screen.getByLabelText('Действия с задачей'))
    fireEvent.click(screen.getByRole('button', { name: /Удалить задачу/ }))
    expect(confirm).toHaveBeenCalledWith('Удалить «Задача A»?')
    expect(onDelete).toHaveBeenCalledWith('t1')
    expect(onClose).toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('панель CI-рана видна и при свёрнутых «Подробностях»', () => {
    setMobile(true)
    render(<TaskModal {...props({ ciSummary: mkSummary(), onOpenCiRun: vi.fn(), onStartCi: vi.fn() })} />)

    expect(screen.queryByTestId('task-modal-details')).not.toBeInTheDocument()
    expect(screen.getByTestId('task-modal-ci')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Лента рана' })).toBeInTheDocument()
  })

  it('на десктопе — правая панель раскрыта, кнопки в шапке, без ⋯', () => {
    render(<TaskModal {...props({ onOpenChat: vi.fn() })} />)

    expect(screen.getByTestId('task-modal-details')).toBeInTheDocument()
    expect(screen.getByLabelText('Приоритет')).toBeInTheDocument()
    expect(screen.getByLabelText('Статус')).toBeInTheDocument()
    expect(screen.queryByTestId('task-modal-quick')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Удалить задачу')).toBeInTheDocument()
    expect(screen.queryByLabelText('Действия с задачей')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Подробности/ })).not.toBeInTheDocument()
  })
})

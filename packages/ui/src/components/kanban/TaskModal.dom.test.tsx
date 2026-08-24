import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectLabelledIconButtons, expectNoViolations } from '../../test/a11y'
import { act, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { render } from '../../test/uiRender'
import userEvent from '@testing-library/user-event'
import type { Board, Task } from '@shared/projects'
import type { CiRunSummary, CiTaskReport, TaskImprovement } from '@shared/ci'
import { EMPTY_CI_USAGE_TOTALS } from '@shared/ci'
import { TaskModal, type TaskModalProps } from './TaskModal'
import '../../styles/app.css'
import { createFakeCi } from '../../test/fakeApi'
import { makeReportStep, makeRunReport, makeTaskReport, makeUsageTotals } from '../../test/fixtures'
import type { KbTaskUsageReport } from '@shared/kb'
import type { TaskPreparationRun } from '@shared/qa'
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

describe('TaskModal — создание задачи из улучшения', () => {
  const improvement: TaskImprovement = {
    id: 'i1', taskId: 't1', projectId: 'p1', runId: null, stepId: null, source: 'development',
    status: 'new', title: 'Улучшить ретраи', description: 'Подробности', acceptanceCriteria: 'Ошибка видима',
    createdTaskId: null, fingerprint: 'retry', evidence: [], occurrences: 1,
    suggestedAction: 'create_chatai_task', isNew: true, createdAt: 1, updatedAt: 1
  }

  it('открывает стандартный предзаполненный черновик и создаёт только после подтверждения', async () => {
    const ci = createFakeCi()
    ci.listTaskImprovements = vi.fn(async () => [improvement])
    ci.createTaskFromImprovement = vi.fn(async (_id, input) => ({
      created: true,
      task: mkTask({ id: 'created', columnId: input.columnId, title: input.title, description: input.description, acceptanceCriteria: input.acceptanceCriteria, sourceTaskId: 't1' }),
      improvement: { ...improvement, status: 'implemented' as const, createdTaskId: 'created', isNew: false }
    }))
    window.ci = ci
    render(<TaskModal {...props()} />)
    await userEvent.click(screen.getByRole('tab', { name: /Улучшения/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Создать задачу ChatAI' }))
    const draft = screen.getByRole('dialog', { name: 'Создание задачи' })
    expect(draft).toBeInTheDocument()
    expect(within(draft).getByRole('textbox', { name: 'Заголовок задачи' })).toHaveValue('Улучшить ретраи')
    expect(within(draft).getByText('Подробности')).toBeInTheDocument()
    expect(ci.createTaskFromImprovement).not.toHaveBeenCalled()
    await userEvent.selectOptions(within(draft).getByRole('combobox', { name: 'Статус' }), 'c1')
    await userEvent.click(screen.getByRole('button', { name: 'Создать задачу' }))
    await waitFor(() => expect(ci.createTaskFromImprovement).toHaveBeenCalledTimes(1))
  })

  it('показывает только допустимые статусные действия', async () => {
    const ci = createFakeCi()
    ci.listTaskImprovements = vi.fn(async () => [
      improvement,
      { ...improvement, id: 'i2', status: 'accepted' as const, isNew: false },
      { ...improvement, id: 'i3', status: 'rejected' as const, isNew: false },
      { ...improvement, id: 'i4', status: 'implemented' as const, isNew: false, createdTaskId: 't2' }
    ])
    window.ci = ci
    render(<TaskModal {...props()} />)
    await userEvent.click(screen.getByRole('tab', { name: /Улучшения/ }))
    expect(await screen.findAllByRole('button', { name: 'Принять' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Отклонить' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Реализовано' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Создать задачу ChatAI' })).toHaveLength(2)
  })
})

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

    // Палочка живёт в правке описания — сначала открываем её.
    await userEvent.click(screen.getByTestId('task-desc-empty'))
    await userEvent.click(screen.getByRole('button', { name: 'Открыть AI-помощник' }))
    expect(screen.getByRole('dialog', { name: 'AI-помощник формулировки' })).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'AI-помощник формулировки' })).not.toBeInTheDocument()
    expect(screen.getByTestId('task-modal')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    // Второй Esc достаётся правке описания: она тоже слой стека окон.
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByLabelText('Описание задачи')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    // И только третий — самой карточке.
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('TaskModal — название и текущее состояние в шапке', () => {
  beforeEach(() => { window.ci = createFakeCi() })

  it('показывает ключ, редактируемое название и этап единственный раз', () => {
    render(<TaskModal {...props()} />)

    const heading = screen.getByTestId('task-modal-heading')
    expect(heading).toHaveTextContent('PROJ-1 ·')
    expect(within(heading).getByLabelText('Заголовок задачи')).toHaveValue('Задача A')
    expect(heading).toHaveTextContent('(Разработка)')
    expect(screen.getAllByText('PROJ-1 ·', { exact: true })).toHaveLength(1)
    expect(screen.getAllByLabelText('Заголовок задачи')).toHaveLength(1)
    expect(screen.queryByText(/Последний запуск:/)).not.toBeInTheDocument()
  })

  it('добавляет фазу активного development-рана и обновляется по новым props', () => {
    const { rerender } = render(<TaskModal {...props()} />)
    expect(screen.getByTestId('task-modal-heading')).toHaveTextContent('(Разработка)')

    rerender(<TaskModal {...props({ ciSummary: mkSummary() })} />)
    expect(screen.getByTestId('task-modal-heading')).toHaveTextContent('(Разработка · Модель работает)')
  })

  it('после успешного рана показывает только новый этап', () => {
    const qaBoard: Board = { ...board, columns: [{ ...board.columns[0]!, name: 'Ручное QA', semanticType: 'manual_qa' }] }
    render(<TaskModal {...props({
      board: qaBoard,
      ciSummary: mkSummary({ status: 'success', modelActive: false, slotProgress: { done: 4, total: 4, phase: 'Готово' } })
    })} />)

    expect(screen.getByTestId('task-modal-heading')).toHaveTextContent('(Ручное QA)')
    expect(screen.getByTestId('task-modal-heading')).not.toHaveTextContent('Готово')
  })

  it('показывает актуальный ошибочный итог вместе с этапом', () => {
    const errorBoard: Board = { ...board, columns: [{ ...board.columns[0]!, name: 'Ошибка' }] }
    render(<TaskModal {...props({
      board: errorBoard,
      ciSummary: mkSummary({ status: 'failed', modelActive: false, slotProgress: { done: 2, total: 4, phase: 'Проверки не пройдены' } })
    })} />)

    expect(screen.getByTestId('task-modal-heading')).toHaveTextContent('(Ошибка · Проверки не пройдены)')
  })

  it('активный merge отображается в тех же скобках', () => {
    render(<TaskModal {...props({ task: mkTask({ activeMergeRunId: 'merge-1' }) })} />)
    expect(screen.getByTestId('task-modal-heading')).toHaveTextContent('(Разработка · Мерж выполняется)')
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
    expect(screen.queryByRole('button', { name: 'В очередь' })).not.toBeInTheDocument()
    expect(onStartCi).not.toHaveBeenCalled()
  })

  it('после завершения рана «В очередь» снова доступна', () => {
    const onStartCi = vi.fn()
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }), onOpenCiRun: vi.fn(), onStartCi })} />)
    fireEvent.click(screen.getByRole('button', { name: 'В очередь' }))
    expect(onStartCi).toHaveBeenCalledWith('t1')
  })

  it('в колонке «Готово» кнопка запуска не показывается', () => {
    const doneBoard: Board = { ...board, columns: [{ ...board.columns[0]!, semanticType: 'done' }] }
    render(<TaskModal {...props({ board: doneBoard, ciSummary: mkSummary({ status: 'success', modelActive: false }), onStartCi: vi.fn() })} />)
    expect(screen.queryByRole('button', { name: 'В очередь' })).not.toBeInTheDocument()
  })

  it('когда ран ждёт ответа, кнопка зовёт ответить', () => {
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'awaiting_input', awaitingInput: true }), onOpenCiRun: vi.fn(), onStartCi: vi.fn() })} />)
    expect(screen.getByTestId('task-modal-ci')).toHaveTextContent('ждёт ответа')
    expect(screen.getByRole('button', { name: 'Ответить модели' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'В очередь' })).not.toBeInTheDocument()
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
    const desc = screen.getByRole('heading', { name: 'Описание' })
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

  it('удаление из ⋯-меню спрашивает подтверждение и закрывает карточку', async () => {
    const onDelete = vi.fn()
    const onClose = vi.fn()
    setMobile(true)
    render(<TaskModal {...props({ onDelete, onClose })} />)

    fireEvent.click(screen.getByLabelText('Действия с задачей'))
    fireEvent.click(screen.getByRole('button', { name: /Удалить задачу/ }))
    // Своё окно подтверждения, а не нативный диалог: его видно и по нему кликают.
    const dialog = await screen.findByTestId('confirm-dialog')
    expect(within(dialog).getByRole('heading', { name: 'Удалить «Задача A»?' })).toBeInTheDocument()
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }))
    // Ответ приходит промисом (useConfirm), поэтому ждём следующего такта.
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('t1'))
    expect(onClose).toHaveBeenCalled()
  })

  it('отказ в подтверждении оставляет задачу на месте', async () => {
    const onDelete = vi.fn()
    setMobile(true)
    render(<TaskModal {...props({ onDelete })} />)

    fireEvent.click(screen.getByLabelText('Действия с задачей'))
    fireEvent.click(screen.getByRole('button', { name: /Удалить задачу/ }))
    const dialog = await screen.findByTestId('confirm-dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull())
    expect(onDelete).not.toHaveBeenCalled()
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

// Описание пишется маркдауном, поэтому по умолчанию оно отрисовано, а поле на 10
// строк появляется только по кнопке «Изменить».
describe('TaskModal — описание: маркдаун в просмотре, поле в правке', () => {
  beforeEach(() => { window.ci = createFakeCi() })

  const MD = '## Зачем\n\n- первый пункт\n- второй пункт'

  it('при открытии описание — разметка, а не сырой текст в поле', () => {
    render(<TaskModal {...props({ task: mkTask({ description: MD }) })} />)

    const view = screen.getByTestId('task-desc-view')
    expect(within(view).getByRole('heading', { name: 'Зачем' })).toBeInTheDocument()
    expect(within(view).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByLabelText('Описание задачи')).not.toBeInTheDocument()
  })

  it('«Изменить» открывает поле на 10 строк с текстом-исходником', async () => {
    render(<TaskModal {...props({ task: mkTask({ description: MD }) })} />)

    await userEvent.click(screen.getByTestId('task-desc-edit'))
    const field = screen.getByLabelText('Описание задачи')
    expect(field).toHaveAttribute('rows', '10')
    expect(field).toHaveValue(MD)
    expect(screen.queryByTestId('task-desc-view')).not.toBeInTheDocument()
  })

  it('пустое описание — подсказка, клик по ней ведёт в правку', async () => {
    render(<TaskModal {...props()} />)

    await userEvent.click(screen.getByTestId('task-desc-empty'))
    expect(screen.getByLabelText('Описание задачи')).toBeInTheDocument()
  })

  it('правка и «Сохранить» зовут onUpdate один раз и возвращают просмотр', async () => {
    const onUpdate = vi.fn()
    render(<TaskModal {...props({ task: mkTask({ description: MD }), onUpdate })} />)

    await userEvent.click(screen.getByTestId('task-desc-edit'))
    await userEvent.type(screen.getByLabelText('Описание задачи'), '\n- третий пункт')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith('t1', { description: `${MD}\n- третий пункт` })
    expect(screen.getByTestId('task-desc-view')).toBeInTheDocument()
    expect(screen.queryByLabelText('Описание задачи')).not.toBeInTheDocument()
  })

  it('«Отмена» возвращает просмотр и ничего не пишет', async () => {
    const onUpdate = vi.fn()
    render(<TaskModal {...props({ task: mkTask({ description: MD }), onUpdate })} />)

    await userEvent.click(screen.getByTestId('task-desc-edit'))
    await userEvent.type(screen.getByLabelText('Описание задачи'), ' лишнее')
    await userEvent.click(screen.getByRole('button', { name: 'Отмена' }))

    expect(onUpdate).not.toHaveBeenCalled()
    expect(within(screen.getByTestId('task-desc-view')).getByRole('heading', { name: 'Зачем' })).toBeInTheDocument()
  })

  it('Esc отменяет правку, а карточку не закрывает', async () => {
    const onUpdate = vi.fn()
    const onClose = vi.fn()
    render(<TaskModal {...props({ task: mkTask({ description: MD }), onUpdate, onClose })} />)

    await userEvent.click(screen.getByTestId('task-desc-edit'))
    await userEvent.type(screen.getByLabelText('Описание задачи'), ' лишнее')
    await userEvent.keyboard('{Escape}')

    expect(onUpdate).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('task-desc-view')).toBeInTheDocument()
  })

  it('палочка AI-помощника есть только в правке', async () => {
    render(<TaskModal {...props({ generateAiAssist: async () => [] })} />)

    expect(screen.queryByRole('button', { name: 'Открыть AI-помощник' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId('task-desc-empty'))
    expect(screen.getByRole('button', { name: 'Открыть AI-помощник' })).toBeInTheDocument()
  })

  it('открытие другой задачи возвращает просмотр', async () => {
    const child = mkTask({ id: 't2', parentId: 't1', title: 'Подзадача', seq: 2 })
    const parent = mkTask({ description: MD })
    const withChild: Board = { ...board, tasks: [parent, child] }
    const { rerender } = render(<TaskModal {...props({ task: parent, board: withChild })} />)

    await userEvent.click(screen.getByTestId('task-desc-edit'))
    expect(screen.getByLabelText('Описание задачи')).toBeInTheDocument()

    rerender(<TaskModal {...props({ task: child, board: withChild })} />)
    expect(screen.queryByLabelText('Описание задачи')).not.toBeInTheDocument()
    expect(screen.getByTestId('task-desc-empty')).toBeInTheDocument()
  })
})

describe('TaskModal — вкладки и merge', () => {
  beforeEach(() => { window.ci = createFakeCi() })

  it('располагает постоянные вкладки по workflow', () => {
    render(<TaskModal {...props()} />)

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Общее', 'Временная шкала', 'Настройки', 'Ход выполнения', 'Улучшения', 'Ручное QA', 'Merge', 'Лента рана'
    ])
  })

  it('растягивает только вкладку ленты рана на ширину контентной области', () => {
    render(<TaskModal {...props()} />)
    const feedTab = screen.getByTestId('task-run-feed-tab')
    const mergeTab = screen.getByTestId('task-merge-tab')

    expect(feedTab).toHaveClass('task-run-feed-tab')
    expect(getComputedStyle(feedTab).width).toBe('100%')
    expect(getComputedStyle(feedTab).maxWidth).toBe('100%')
    expect(getComputedStyle(feedTab).overflowX).toBe('hidden')
    expect(mergeTab).not.toHaveClass('task-run-feed-tab')
  })

  it('располагает preparation и QA-вкладки на своих местах workflow', () => {
    const preparationBoard: Board = { ...board, columns: [{ ...board.columns[0]!, name: 'Подготовка', semanticType: 'preparation' }] }
    const { unmount } = render(<TaskModal {...props({ board: preparationBoard, task: mkTask({ taskPreparationRunId: 'prep-1' }) })} />)
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Общее', 'Временная шкала', 'Подготовка к разработке', 'Настройки', 'Ход выполнения', 'Улучшения', 'Ручное QA', 'Merge', 'Лента рана'
    ])
    unmount()

    const manualQaBoard: Board = { ...board, columns: [{ ...board.columns[0]!, name: 'Ручное QA', semanticType: 'manual_qa' }] }
    render(<TaskModal {...props({ board: manualQaBoard })} />)
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Общее', 'Временная шкала', 'Настройки', 'Ход выполнения', 'Улучшения', 'Component QA', 'Интеграционные тесты', 'Automated QA', 'Ручное QA', 'Merge', 'Лента рана'
    ])
  })

  it('переключает восемь вкладок без закрытия и сохраняет черновик', async () => {
    const onClose = vi.fn()
    render(<TaskModal {...props({ onClose })} />)
    expect(screen.getAllByRole('tab')).toHaveLength(8)
    fireEvent.click(screen.getByRole('button', { name: 'Изменить критерии приёмки' }))
    fireEvent.change(screen.getByLabelText('Критерии приёмки'), { target: { value: 'черновик' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Ручное QA' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Общее' }))
    expect(screen.getByLabelText('Критерии приёмки')).toHaveValue('1. черновик')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('правая панель «Общего» не содержит тематические секции', () => {
    render(<TaskModal {...props()} />)
    const details = screen.getByTestId('task-modal-details')
    for (const title of ['Использование БЗ', 'Тестовое окружение', 'Команды воркфлоу', 'Машина выполнения', 'Движок модели']) {
      expect(within(details).queryByText(title)).not.toBeInTheDocument()
    }
  })

  it('машина и LLM размещены вертикально в настройках, черновик переживает переключение', async () => {
    render(<TaskModal {...props()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Настройки' }))
    const settings = screen.getByTestId('task-settings-panel')
    await waitFor(() => expect(within(settings).getByLabelText('Движок модели')).toHaveValue('claude'))
    expect(within(settings).getByLabelText('Машина выполнения')).toBeInTheDocument()
    expect(within(settings).queryByTestId('feature-preview')).not.toBeInTheDocument()
    fireEvent.change(within(settings).getByLabelText('Движок модели'), { target: { value: 'codex' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Общее' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Настройки' }))
    expect(within(settings).getByLabelText('Движок модели')).toHaveValue('codex')
  })

  it('показывает тестовое окружение перед тест-кейсами и QA-сессией в ручном QA', async () => {
    window.featurePreview = { get: vi.fn().mockResolvedValue(null), operate: vi.fn(), cancel: vi.fn(), open: vi.fn(), closeTunnel: vi.fn() }
    render(<TaskModal {...props()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Ручное QA' }))

    const panel = screen.getByTestId('task-manual-qa-panel')
    const preview = await within(panel).findByTestId('feature-preview')
    const manualQa = within(panel).getByRole('region', { name: 'Ручное QA' })
    expect(preview.compareDocumentPosition(manualQa) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('TaskModal — критерии приёмки', () => {
  it('показывает старый текст единым нумерованным списком', () => {
    render(<TaskModal {...props({ task: mkTask({ acceptanceCriteria: 'Первый\nВторой' }) })} />)
    const view = screen.getByTestId('task-criteria-view')
    expect(within(view).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Первый', 'Второй'])
  })

  it('Enter создаёт пункт, Shift+Enter — внутренний перенос, а blur сохраняет нормализованный Markdown', async () => {
    const onUpdate = vi.fn()
    render(<TaskModal {...props({ task: mkTask({ acceptanceCriteria: 'Первый' }), onUpdate })} />)
    await userEvent.click(screen.getByRole('button', { name: 'Изменить критерии приёмки' }))
    const field = screen.getByRole('textbox', { name: 'Критерии приёмки' }) as HTMLTextAreaElement
    expect(field.value).toBe('1. Первый')

    field.setSelectionRange(field.value.length, field.value.length)
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(field.value).toBe('1. Первый\n2. ')
    await userEvent.type(field, 'Второй')
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true })
    await userEvent.type(field, 'пояснение')
    fireEvent.blur(field)

    expect(onUpdate).toHaveBeenCalledWith('t1', {
      acceptanceCriteria: '1. Первый\n2. Второй\n   пояснение'
    })
  })

  it('многострочная вставка убирает повторные ручные номера', async () => {
    render(<TaskModal {...props()} />)
    await userEvent.click(screen.getByText('Добавьте критерии приёмки…'))
    const field = screen.getByRole('textbox', { name: 'Критерии приёмки' }) as HTMLTextAreaElement
    fireEvent.paste(field, {
      clipboardData: { getData: () => '1. 9. Первый\n3. Второй' }
    })
    expect(field.value).toBe('1. Первый\n2. Второй')
  })
})

describe('TaskModal — доступность', () => {
  beforeEach(() => { window.ci = createFakeCi() })

  it('без нарушений axe: карточка задачи целиком', async () => {
    render(<TaskModal {...props({ task: mkTask({ description: 'Описание', acceptanceCriteria: '- [ ] пункт', labels: ['ui'] }) })} />)
    await expectNoViolations()
    expectLabelledIconButtons()
  })
})

// Блок «Использование БЗ» в карточке — агрегат по ВСЕМ ранам задачи: цифры и
// разделы со ссылками в базу знаний.
describe('TaskModal — использование базы знаний по ранам задачи', () => {
  const report = (over: Partial<KbTaskUsageReport> = {}): KbTaskUsageReport => ({
    projectId: 'p1', taskId: 't1', runs: 2,
    totals: { queries: 5, delivered: 4, empty: 1, errors: 0, toolQueries: 3, sections: 6, documents: 2, chars: 2000, estimatedTokens: 500, promptChars: 9000, lastAt: 9 },
    sections: [{ documentId: 'ci-runner', title: 'CI-раннер', heading: 'Работа модели', anchor: 'model', sourcePath: 'docs/kb/features/ci-runner.md', freshness: 'current', times: 3, autoTimes: 1, chars: 1500, estimatedTokens: 375, lastAt: 9 }],
    recent: [],
    ...over
  })

  beforeEach(() => {
    window.ci = { ...createFakeCi(), getTaskKbUsage: async () => report() } as typeof window.ci
  })

  it('показывает агрегат по всем ранам задачи и ссылку на раздел', async () => {
    render(<TaskModal {...props()} />)
    const block = await screen.findByTestId('task-modal-kb-usage')
    expect(within(block).getByText('по 2 ранам задачи')).toBeInTheDocument()
    expect(within(block).getByTestId('task-modal-kb-usage-nums').textContent).toContain('5 обращений')
    const toggle = within(block).getByRole('button', { name: /Использование базы знаний/, hidden: true })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(within(block).getByRole('link', { name: /CI-раннер/, hidden: true })).toHaveAttribute('href', '#/kb/ci-runner')
  })

  it('у эпика блока нет: раны бывают только у задач', () => {
    render(<TaskModal {...props({ task: mkTask({ type: 'epic' }) })} />)
    expect(screen.queryByTestId('task-modal-kb-usage')).not.toBeInTheDocument()
  })

  it('сбой отчёта не ломает карточку — показывается только сообщение', async () => {
    window.ci = { ...createFakeCi(), getTaskKbUsage: async () => { throw new Error('HTTP 500') } } as typeof window.ci
    render(<TaskModal {...props()} />)
    // Отчёта нет вовсе — блок не рисуется, карточка живёт своей жизнью.
    await waitFor(() => expect(screen.queryByTestId('task-modal-kb-usage')).not.toBeInTheDocument())
    expect(screen.getByDisplayValue('Задача A')).toBeInTheDocument()
  })
})

describe('TaskModal — сворачиваемая работа модели', () => {
  beforeEach(() => {
    window.ci = { ...createFakeCi(), getTaskReport: async () => makeTaskReport() } as typeof window.ci
  })

  const progress = (over: Partial<NonNullable<CiRunSummary['progress']>> = {}): NonNullable<CiRunSummary['progress']> => ({
    runId: 'run-1',
    version: 1,
    stage: 'Работа модели',
    status: 'running',
    startedAt: 1,
    finishedAt: null,
    elapsedMs: 2_000,
    percent: null,
    completedSteps: 1,
    totalSteps: null,
    currentStep: 'Анализ кода',
    etaMs: null,
    etaRangeMs: null,
    etaUnavailableReason: 'Объём работы модели заранее неизвестен',
    logUrl: '#run-1',
    steps: [],
    ...over
  })

  it('по умолчанию показывает компактную строку и раскрывает подробности кликом и клавиатурой', async () => {
    render(<TaskModal {...props({ ciSummary: mkSummary({ progress: progress() }) })} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Ход выполнения', hidden: true }))

    const block = screen.getByTestId('task-model-work')
    const toggle = within(block).getByRole('button', { name: /Работа модели/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(within(toggle).getByText('выполняется')).toBeInTheDocument()
    expect(within(toggle).getByText('Анализ кода')).toBeInTheDocument()
    expect(within(toggle).getByRole('progressbar', { name: 'Прогресс работы модели' })).toBeInTheDocument()
    expect(within(block).queryByText('Данных о работе модели пока нет.')).not.toBeInTheDocument()

    const detailId = toggle.getAttribute('aria-controls')!
    expect(detailId).toBe('task-model-work-detail-run-1')
    expect(document.getElementById(detailId)).toHaveAttribute('hidden')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById(detailId)).not.toHaveAttribute('hidden')
    expect(within(block).getByText(/Начало:/)).toBeInTheDocument()
    expect(within(block).getByRole('link', { name: 'Журнал' })).toBeInTheDocument()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    toggle.focus()
    await userEvent.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await userEvent.keyboard(' ')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('сохраняет ручное раскрытие при realtime-обновлении статуса, стадии и прогресса', async () => {
    const initial = props({ ciSummary: mkSummary({ progress: progress() }) })
    const view = render(<TaskModal {...initial} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Ход выполнения', hidden: true }))
    const block = screen.getByTestId('task-model-work')
    const toggle = within(block).getByRole('button', { name: /Работа модели/ })
    fireEvent.click(toggle)
    toggle.focus()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    view.rerender(<TaskModal {...initial} ciSummary={mkSummary({
      status: 'success',
      modelActive: false,
      progress: progress({ version: 2, status: 'success', percent: 100, currentStep: 'Готово', finishedAt: 5_000 })
    })} />)

    expect(screen.getByTestId('task-model-work')).toBe(block)
    const updated = within(block).getByRole('button', { name: /Работа модели/ })
    expect(updated).toHaveFocus()
    expect(updated).toHaveAttribute('aria-expanded', 'true')
    expect(within(updated).getByText('завершена')).toBeInTheDocument()
    expect(within(updated).getByText('Готово')).toBeInTheDocument()
    expect(within(updated).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    expect(await within(block).findByText('claude')).toBeInTheDocument()
    expect(within(block).getAllByText('opus').length).toBeGreaterThan(0)
  })

  it('показывает один контейнер и журнал не переключает disclosure', async () => {
    render(<TaskModal {...props({ ciSummary: mkSummary({ progress: progress() }) })} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Ход выполнения', hidden: true }))

    expect(screen.getAllByTestId('task-model-work')).toHaveLength(1)
    expect(screen.queryByText('running')).not.toBeInTheDocument()
    const block = screen.getByTestId('task-model-work')
    const toggle = within(block).getByRole('button', { name: /Работа модели/ })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(within(block).getByRole('link', { name: 'Журнал' }))
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })

  it('ошибка обновляет компактный статус, но не раскрывает блок', () => {
    const initial = props({ ciSummary: mkSummary({ progress: progress() }) })
    const view = render(<TaskModal {...initial} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Ход выполнения', hidden: true }))
    const toggle = within(screen.getByTestId('task-model-work')).getByRole('button', { name: /Работа модели/ })

    view.rerender(<TaskModal {...initial} ciSummary={mkSummary({
      status: 'failed',
      modelActive: false,
      progress: progress({ version: 2, status: 'failed' })
    })} />)

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(within(toggle).getByText('завершилась ошибкой')).toBeInTheDocument()
  })

  it.each([
    ['queued', 'ожидает запуска'],
    ['running', 'выполняется'],
    ['waiting', 'ожидает ответа'],
    ['success', 'завершена'],
    ['failed', 'завершилась ошибкой'],
    ['cancelled', 'отменена']
  ] as const)('корректно отображает состояние %s', (status, label) => {
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: status === 'waiting' ? 'awaiting_input' : status, progress: progress({ status }) }) })} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Ход выполнения', hidden: true }))
    expect(within(screen.getByTestId('task-model-work')).getByText(label)).toBeInTheDocument()
  })
})

// Раздел «Отчёт»: во что обошёлся ран задачи. Показывается только у завершённого
// рана — пока ран идёт, цифры устаревают на глазах, и смотреть надо ленту.
describe('TaskModal — отчёт по завершённой задаче', () => {
  const withReport = (report: CiTaskReport): void => {
    window.ci = { ...createFakeCi(), getTaskReport: async () => report } as typeof window.ci
  }
  // Числа форматируются `toLocaleString('ru')` — разряды разделяет неразрывный
  // пробел, и сравнивать с обычным можно только после нормализации.
  const text = (el: HTMLElement): string => el.textContent!.replace(/\u00a0/g, ' ')

  beforeEach(() => withReport(makeTaskReport()))

  it('у завершённой задачи показывает плитки итогов и таблицу шагов', async () => {
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false, durationMs: 720_000 }) })} />)

    const block = await screen.findByTestId('task-modal-report')
    expect(text(within(block).getByTestId('task-modal-report-cost'))).toContain('$1.84')
    expect(text(within(block).getByTestId('task-modal-report-tokens'))).toContain('219 400')
    expect(text(within(block).getByTestId('task-modal-report-requests'))).toContain('4')
    expect(text(within(block).getByTestId('task-modal-report-model-time'))).toContain('10м 40с')
    // Шаги — со статусом и временем, вложенный вызов команды моделью тоже.
    const steps = within(block).getByTestId('task-modal-report-steps')
    expect(within(steps).getByRole('rowheader', { name: /npm ci/, hidden: true })).toBeInTheDocument()
    expect(within(steps).getByRole('rowheader', { name: /Установить зависимости/, hidden: true })).toBeInTheDocument()
    expect(within(steps).getByRole('rowheader', { name: /Работа модели/, hidden: true })).toBeInTheDocument()
    expect(within(steps).getAllByText('9м 00с').length).toBeGreaterThan(0)
  })


  it('показывает вызовы инструментов рана с разбивкой', async () => {
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }) })} />)

    const tools = await screen.findByTestId('task-modal-report-tools')
    // 12 bash + 31 read + 9 grep + 14 edit + 3 kb + 1 прочий = 70 вызовов.
    // Два отказа в «всего» не входят: сами вызовы уже посчитаны своими видами.
    expect(text(tools)).toContain('Инструменты: 70 вызовов, из них чтений 31, правок 14')
    expect(text(tools)).toContain('bash 12')
    expect(text(tools)).toContain('отказов 2')
  })

  // Задача «сжать контекст»: в отчёте обязаны быть видны оба множителя цены —
  // контекст на запрос и объём ответов, плюс три самых тяжёлых ответа.
  it('показывает средний и максимальный контекст на запрос', async () => {
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }) })} />)

    const tile = await screen.findByTestId('task-modal-report-context')
    // (12 000 входа + 180 000 чтения кэша + 24 000 записи) / 24 запроса = 9 000.
    expect(text(tile)).toContain('9 000')
    expect(text(tile)).toContain('макс 12 000')
    expect(text(tile)).toContain('запросов к API 24')
  })

  it('контекст на запрос без данных CLI — прочерк с объяснением, а не ноль', async () => {
    withReport(makeTaskReport([makeRunReport({ totals: makeUsageTotals({ apiRequests: 0, maxContextPerRequest: 0 }) })]))
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }) })} />)

    const tile = await screen.findByTestId('task-modal-report-context')
    expect(text(tile)).toContain('—')
    expect(text(tile)).toContain('CLI не сообщил число запросов')
  })

  it('показывает объём ответов инструментов и три самых тяжёлых ответа', async () => {
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }) })} />)

    const tools = await screen.findByTestId('task-modal-report-tools')
    expect(text(tools)).toContain('ответами 290k симв.')
    expect(text(tools)).toContain('bash 148k')

    const heaviest = await screen.findByTestId('task-modal-report-heaviest')
    expect(text(heaviest)).toContain('npm ci')
    expect(text(heaviest)).toContain('20k симв.')
    // Обрезка видна вместе с исходным объёмом: сколько лимит сэкономил.
    expect(text(heaviest)).toContain('обрезано из 243k')
  })

  it('у рана без тяжёлых ответов строки самых тяжёлых нет', async () => {
    withReport(makeTaskReport([makeRunReport({ toolResponses: [] })]))
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }) })} />)

    await screen.findByTestId('task-modal-report')
    expect(screen.queryByTestId('task-modal-report-heaviest')).not.toBeInTheDocument()
  })

  it('без отказов приписки в строке инструментов нет', async () => {
    withReport(makeTaskReport([makeRunReport({
      toolCalls: { bash: 1, read: 2, grep: 0, edit: 0, kb: 0, other: 0, denied: 0 }
    })]))
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }) })} />)

    const tools = await screen.findByTestId('task-modal-report-tools')
    expect(text(tools)).not.toContain('отказов')
  })

  it('время работы модели без данных CLI — прочерк, а не «0мс»', async () => {
    withReport(makeTaskReport([makeRunReport({ totals: makeUsageTotals({ modelActiveMs: 0 }) })]))
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }) })} />)

    const tile = await screen.findByTestId('task-modal-report-model-time')
    expect(text(tile)).toContain('—')
  })

  it('у рана без счётчика вызовов строки инструментов нет (а не «0»)', async () => {
    withReport(makeTaskReport([makeRunReport({ toolCalls: null })]))
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }) })} />)

    await screen.findByTestId('task-modal-report')
    expect(screen.queryByTestId('task-modal-report-tools')).not.toBeInTheDocument()
  })

  it('итог с ходами без прайса помечен заниженным, а не просто оценкой', async () => {
    withReport(makeTaskReport([makeRunReport({
      totals: makeUsageTotals({ costUsd: 0.9, costEstimated: true, costUnderstated: true })
    })]))
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }) })} />)

    const cost = await screen.findByTestId('task-modal-report-cost')
    expect(text(cost)).toContain('≈ $0.90')
    expect(text(cost)).toContain('итог занижен')
  })

  it('показывает попадание БЗ рядом с расходом завершённого рана', async () => {
    withReport(makeTaskReport([makeRunReport({
      kbHit: { sectionsDelivered: 5, sectionsHit: 3, hitRatio: 0.6 }
    })]))
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }) })} />)

    const hit = await screen.findByTestId('task-modal-report-kb-hit')
    expect(text(hit)).toContain('БЗ: выдано 5 разделов, пригодились 3 (60%')
  })

  it('стоимость без данных CLI помечена «≈»', async () => {
    withReport(makeTaskReport([makeRunReport({ totals: makeUsageTotals({ costUsd: 2.07, costEstimated: true }) })]))
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }) })} />)

    const cost = await screen.findByTestId('task-modal-report-cost')
    expect(text(cost)).toContain('≈ $2.07')
    expect(text(cost)).toContain('оценка по прайсу')
  })

  it('при нескольких ранах переключатель показывает итог по задаче', async () => {
    withReport(makeTaskReport([
      makeRunReport({ runId: 'run-2', durationMs: 100_000, totals: makeUsageTotals({ requests: 1, tokens: 1000, costUsd: 0.5 }) }),
      makeRunReport({ runId: 'run-1', status: 'failed' })
    ]))
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }) })} />)

    const block = await screen.findByTestId('task-modal-report')
    // По умолчанию — свежий ран со своими шагами.
    expect(text(within(block).getByTestId('task-modal-report-cost'))).toContain('$0.50')
    await userEvent.click(within(block).getByRole('button', { name: 'Итог по задаче', hidden: true }))
    expect(text(within(block).getByTestId('task-modal-report-cost'))).toContain('$2.34')
    expect(within(block).getByTestId('task-modal-report-runs')).toBeInTheDocument()
  })

  it('у старого рана без расхода отчёт открывается: шаги есть, деньги прочерком', async () => {
    withReport(makeTaskReport([makeRunReport({ totals: { ...EMPTY_CI_USAGE_TOTALS }, stages: [], steps: [makeReportStep()] })]))
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }) })} />)

    const block = await screen.findByTestId('task-modal-report')
    expect(text(within(block).getByTestId('task-modal-report-cost'))).toContain('—')
    expect(within(block).getByRole('rowheader', { name: /npm ci/, hidden: true })).toBeInTheDocument()
    // Стадий у рана до фичи расхода нет — таблицы тоже нет, а не пустая шапка.
    expect(within(block).queryByTestId('task-modal-report-stages')).not.toBeInTheDocument()
  })

  it('стадии рана показывают модель, которой каждая посчитана', async () => {
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }) })} />)

    const stages = await screen.findByTestId('task-modal-report-stages')
    const row = within(stages).getByRole('rowheader', { name: 'Актуализация базы знаний', hidden: true }).closest('tr')!
    expect(text(row)).toContain('sonnet')
    expect(text(within(stages).getByRole('rowheader', { name: 'Разработка', hidden: true }).closest('tr')!)).toContain('opus')
  })

  it('у задачи с активным раном отчёта нет — там лента', async () => {
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'running' }) })} />)
    await screen.findByTestId('task-modal-ci')
    expect(screen.queryByTestId('task-modal-report')).not.toBeInTheDocument()
  })

  it('без рана вовсе отчёта тоже нет', async () => {
    render(<TaskModal {...props()} />)
    await waitFor(() => expect(screen.queryByTestId('task-modal-report')).not.toBeInTheDocument())
  })
})

describe('TaskModal — подготовка к разработке', () => {
  beforeEach(() => { window.ci = createFakeCi() })
  const preparationBoard: Board = { columns: [{ ...board.columns[0], name: 'Подготовка к разработке', semanticType: 'preparation' }], tasks: [] }
  const run = (status: TaskPreparationRun['status'], over: Partial<TaskPreparationRun> = {}): TaskPreparationRun => ({
    id: `prep-${status}`, projectId: 'p1', taskId: 't1', status, attempt: 1, maxAttempts: 3,
    log: 'Уточняю критерии', error: null, readiness: null, gateReasons: [], createdAt: 1,
    finishedAt: status === 'running' ? null : 2, canRetry: status !== 'running', canCancel: status === 'running', ...over
  })

  it('позволяет выбрать машину и LLM, а активный ран показывает фактический снимок', async () => {
    window.ci!.getTaskMachines = vi.fn(async () => ({ machines: [{ agentId: 'm1', name: 'MacBook', online: true, canUse: true, personal: true, project: true, projectDefault: true }], selectedAgentId: null, unavailableSelection: null, effectiveAgentId: 'm1' }))
    const onStartPreparation = vi.fn().mockResolvedValue(run('running'))
    const { unmount } = render(<TaskModal {...props({ board: preparationBoard, initialTab: 'preparation', onStartPreparation })} llmAccess={[]} llmEngines={[{ id: 'claude-local', name: 'Claude local', kind: 'claude', isDefault: true }]} />)
    expect(screen.getByRole('tab', { name: 'Подготовка к разработке' })).toBeInTheDocument()
    expect(await screen.findByLabelText('Машина подготовки')).toHaveValue('m1')
    expect(screen.getByLabelText('Модель подготовки')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Запустить подготовку' }))
    await waitFor(() => expect(onStartPreparation).toHaveBeenCalledWith('t1', expect.objectContaining({ machineId: 'm1', provider: 'claude' })))
    unmount()

    render(<TaskModal {...props({
      board: preparationBoard,
      task: mkTask({ taskPreparationRunId: 'prep-running', taskPreparationStatus: 'running' }),
      loadPreparationRuns: async () => [run('running', { provider: 'codex', model: 'gpt-5.6-sol' })]
    })} />)
    expect(screen.getByRole('tab', { name: 'Подготовка к разработке' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('LLM: codex · gpt-5.6-sol')).toBeInTheDocument()
    expect(await screen.findByTestId('task-preparation-feed')).toHaveTextContent('Уточняю критерии')
  })

  it.each([
    ['running', 'выполняется'],
    ['success', 'успешно'],
    ['failed', 'ошибка'],
    ['cancelled', 'отменён']
  ] as const)('показывает статус %s и допустимые действия', async (status, label) => {
    const value = run(status, status === 'failed' ? { error: 'Ответ модели невалиден', gateReasons: ['missing_acceptance_criteria'] } : {})
    render(<TaskModal {...props({
      board: preparationBoard,
      initialTab: 'preparation',
      task: mkTask({ taskPreparationRunId: value.id, taskPreparationStatus: status }),
      loadPreparationRuns: async () => [value],
      onRetryPreparation: vi.fn(),
      onCancelPreparation: vi.fn(),
      onStartCi: vi.fn(),
      onStartCiParallel: vi.fn()
    })} />)
    expect(await screen.findByText(`Статус: ${label}`)).toBeInTheDocument()
    if (status === 'running') {
      expect(screen.getByRole('button', { name: 'Отменить' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Повторить подготовку' })).not.toBeInTheDocument()
    } else {
      expect(screen.queryByRole('button', { name: 'Отменить' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Повторить подготовку' })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'В очередь' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Параллельно' })).not.toBeInTheDocument()
    if (status === 'failed') {
      expect(screen.getByRole('alert')).toHaveTextContent('Ответ модели невалиден')
      expect(screen.getByTestId('task-preparation-gate-reasons')).toHaveTextContent('missing_acceptance_criteria')
    }
  })

  it('показывает пустое состояние активного рана до появления истории', async () => {
    render(<TaskModal {...props({
      board: preparationBoard,
      task: mkTask({ taskPreparationStatus: 'running' }),
      loadPreparationRuns: async () => []
    })} />)
    expect(await screen.findByTestId('task-preparation-empty')).toHaveTextContent('ещё не запускалась')
  })

  it('retry добавляет новую попытку, сохраняя предыдущую', async () => {
    const failed = run('failed')
    const retry = run('running', { id: 'prep-2', attempt: 2 })
    const load = vi.fn().mockResolvedValueOnce([failed]).mockResolvedValueOnce([retry, failed])
    render(<TaskModal {...props({
      board: preparationBoard,
      initialTab: 'preparation',
      task: mkTask({ taskPreparationRunId: failed.id, taskPreparationStatus: 'failed' }),
      loadPreparationRuns: load,
      onRetryPreparation: async () => retry
    })} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Повторить подготовку' }))
    await waitFor(() => expect(within(screen.getByTestId('task-preparation-history')).getAllByRole('button')).toHaveLength(2))
  })

  it('не применяет устаревший ответ после смены задачи', async () => {
    let resolveOld!: (runs: TaskPreparationRun[]) => void
    const oldRequest = new Promise<TaskPreparationRun[]>((resolve) => { resolveOld = resolve })
    const load = vi.fn((taskId: string) => taskId === 't1'
      ? oldRequest
      : Promise.resolve([run('success', { id: 'prep-new', taskId: 't2' })]))
    const view = render(<TaskModal {...props({
      board: preparationBoard, initialTab: 'preparation',
      task: mkTask({ taskPreparationRunId: 'prep-old', taskPreparationStatus: 'running' }),
      loadPreparationRuns: load
    })} />)
    view.rerender(<TaskModal {...props({
      board: preparationBoard, initialTab: 'preparation',
      task: mkTask({ id: 't2', taskPreparationRunId: 'prep-new', taskPreparationStatus: 'success' }),
      loadPreparationRuns: load
    })} />)
    expect(await screen.findByText('Статус: успешно')).toBeInTheDocument()
    await act(async () => { resolveOld([run('failed', { id: 'prep-old' })]); await oldRequest })
    expect(screen.getByText('Статус: успешно')).toBeInTheDocument()
    expect(screen.queryByText('Статус: ошибка')).not.toBeInTheDocument()
  })

  it('обновляет историю адресно с debounce, синхронизируется один раз после reconnect и очищает обработчики', async () => {
    let preparationUpdated: ((event: { projectId: string; taskId: string; runId: string }) => void) | null = null
    let reconnected: (() => void) | null = null
    const offUpdate = vi.fn()
    const offReconnect = vi.fn()
    const previousBoard = window.board
    window.board = {
      subscribe: vi.fn(), unsubscribe: vi.fn(),
      onChanged: vi.fn(() => () => {}), onConnected: vi.fn(() => () => {}),
      onPreparationRunUpdated: vi.fn((cb) => { preparationUpdated = cb; return offUpdate }),
      onTaskRepositoriesUpdated: vi.fn(() => () => {}),
      onReconnect: vi.fn((cb) => { reconnected = cb; return offReconnect })
    }
    const load = vi.fn(async () => [run('waiting_for_answer')])
    const view = render(<TaskModal {...props({
      board: preparationBoard,
      initialTab: 'preparation',
      task: mkTask({ taskPreparationRunId: 'prep-waiting_for_answer', taskPreparationStatus: 'waiting_for_answer' }),
      loadPreparationRuns: load
    })} />)
    await screen.findByText('Статус: ожидает ответа')
    expect(load).toHaveBeenCalledTimes(1)

    vi.useFakeTimers()
    try {
      act(() => {
        preparationUpdated?.({ projectId: 'other', taskId: 't1', runId: 'foreign-project' })
        preparationUpdated?.({ projectId: 'p1', taskId: 'other', runId: 'foreign-task' })
        preparationUpdated?.({ projectId: 'p1', taskId: 't1', runId: 'prep-1' })
        preparationUpdated?.({ projectId: 'p1', taskId: 't1', runId: 'prep-2' })
        vi.advanceTimersByTime(100)
      })
      await act(async () => { await Promise.resolve() })
      expect(load).toHaveBeenCalledTimes(2)

      await act(async () => { reconnected?.(); await Promise.resolve() })
      expect(load).toHaveBeenCalledTimes(3)
      act(() => vi.advanceTimersByTime(10_000))
      expect(load).toHaveBeenCalledTimes(3)

      act(() => preparationUpdated?.({ projectId: 'p1', taskId: 't1', runId: 'late' }))
      view.unmount()
      act(() => vi.advanceTimersByTime(100))
      expect(load).toHaveBeenCalledTimes(3)
      expect(offUpdate).toHaveBeenCalledOnce()
      expect(offReconnect).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
      window.board = previousBoard
    }
  })
})

describe('TaskModal — вкладка Merge', () => {
  beforeEach(() => {
    window.ci = createFakeCi()
  })

  it('размонтирует скрытую Merge-панель и делает один новый snapshot при повторном открытии', async () => {
    const getTaskMachines = vi.spyOn(window.ci!, 'getTaskMachines').mockResolvedValue({
      machines: [{ agentId: 'm1', name: 'MacBook', online: true, personal: true, project: false, projectDefault: false }],
      selectedAgentId: null,
      unavailableSelection: null
    })
    const getMergeMachines = vi.spyOn(window.ci!, 'getMergeMachines').mockResolvedValue({
      machines: [{ agentId: 'm1', name: 'MacBook', readiness: { ready: true, selectable: true, mode: 'managed', code: 'ready', message: 'Готово' } }],
      defaultAgentId: 'm1'
    })
    const mergeBoard: Board = {
      columns: [{ ...board.columns[0]!, name: 'Ожидает merge', semanticType: 'awaiting_merge' }],
      tasks: []
    }

    render(<TaskModal {...props({
      board: mergeBoard,
      initialTab: 'merge',
      task: mkTask({ mergeSourceBranch: 'CHAT-326', mergePermitted: true, mergeMachineBound: true }),
      onStartMerge: vi.fn()
    })} />)

    expect(await screen.findByRole('option', { name: /MacBook/ })).toBeInTheDocument()
    const taskMachineCalls = getTaskMachines.mock.calls.length
    const mergeMachineCalls = getMergeMachines.mock.calls.length
    await userEvent.click(screen.getByRole('tab', { name: 'Настройки' }))
    await userEvent.click(screen.getByRole('tab', { name: 'Merge' }))

    expect(screen.getByRole('option', { name: /MacBook/ })).toBeInTheDocument()
    expect(screen.queryByTestId('merge-machines-skeleton-list')).not.toBeInTheDocument()
    expect(getTaskMachines).toHaveBeenCalledTimes(taskMachineCalls + 1)
    expect(getMergeMachines).toHaveBeenCalledTimes(mergeMachineCalls + 1)
  })
})

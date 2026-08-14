import { describe, it, expect, vi, afterEach } from 'vitest'
import { expectLabelledIconButtons, expectNoViolations } from '../../test/a11y'
import { act, fireEvent, screen, within, waitFor } from '@testing-library/react'
import { render } from '../../test/uiRender'
import userEvent from '@testing-library/user-event'
import { KanbanBoard, type KanbanBoardProps } from './KanbanBoard'
import type { Board, Task } from '@shared/projects'
import type { CiRunSummary } from '@shared/ci'
import type { GenerateParams } from '../prompt-builder/PromptBuilder'
import { DRAG_HOLD_MS } from '../../lib/dnd'
import { listCommands, resetCommands } from '../../lib/commands'

const task = (over: Partial<Task>): Task => ({
  id: 't', projectId: 'p1', columnId: 'c1', type: 'task', parentId: null, title: 'T', description: '',
  acceptanceCriteria: '', priority: 'medium', assignee: null, labels: [], skills: [], storyPoints: null, dueDate: null,

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

  it('общая поверхность колонок не включает панель фильтров', () => {
    renderBoard()
    const surface = screen.getByTestId('kanban-board')
    const filters = screen.getByTestId('board-filters')
    expect(surface).not.toContainElement(filters)
    expect(surface).toContainElement(screen.getByTestId('kanban-column'))
  })

  it('открытие и закрытие карточки сохраняет вертикальную позицию колонки', async () => {
    renderBoard()
    const body = document.querySelector<HTMLElement>('[data-drop-body]')!
    body.scrollTop = 240

    await userEvent.click(screen.getByText('A'))
    expect(await screen.findByTestId('task-modal')).toBeInTheDocument()
    expect(body.scrollTop).toBe(240)

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('task-modal')).not.toBeInTheDocument())
    expect(body.scrollTop).toBe(240)
  })

  it('«Лента подготовки» открывает модалку сразу на preparation-вкладке', async () => {
    const preparationBoard: Board = {
      columns: [{ ...board.columns[0]!, name: 'Подготовка к разработке', semanticType: 'preparation' }],
      tasks: [task({ id: 't1', title: 'A', taskPreparationRunId: 'prep-1', taskPreparationStatus: 'failed' })]
    }
    renderBoard({ board: preparationBoard, loadPreparationRuns: async () => [{ id: 'prep-1', projectId: 'p1', taskId: 't1', status: 'failed', attempt: 1, maxAttempts: 2, log: 'Лента', error: 'Ошибка', readiness: null, gateReasons: [], createdAt: 1, finishedAt: 2, canRetry: true, canCancel: false }] })

    await userEvent.click(screen.getByRole('button', { name: 'Лента подготовки' }))

    expect(await screen.findByTestId('task-modal')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Подготовка к разработке' })).toHaveAttribute('aria-selected', 'true')
  })

  it('обычное обновление данных сохраняет горизонтальную и вертикальные позиции', () => {
    const view = render(<KanbanBoardHarness board={dndBoard} />)
    const surface = screen.getByTestId('kanban-board')
    const bodies = document.querySelectorAll<HTMLElement>('[data-drop-body]')
    surface.scrollLeft = 180
    bodies[0]!.scrollTop = 120
    bodies[1]!.scrollTop = 55

    view.rerender(<KanbanBoardHarness board={{ ...dndBoard, tasks: [...dndBoard.tasks] }} />)

    expect(screen.getByTestId('kanban-board')).toBe(surface)
    expect(surface.scrollLeft).toBe(180)
    expect(document.querySelectorAll<HTMLElement>('[data-drop-body]')[0]).toBe(bodies[0])
    expect(bodies[0]!.scrollTop).toBe(120)
    expect(bodies[1]!.scrollTop).toBe(55)
  })

  it('чекбокс «скрытые» в панели фильтров показывает скрытые колонки', async () => {
    renderBoard()
    expect(screen.getAllByTestId('kanban-column')).toHaveLength(1)
    const filters = screen.getByTestId('board-filters')
    await userEvent.click(within(filters).getByRole('checkbox', { name: /скрытые/ }))
    expect(screen.getAllByTestId('kanban-column')).toHaveLength(2)
    expect(screen.getByText('Скрытая')).toBeInTheDocument()
  })

  it('меню колонки закрывается при клике вне него, не блокируя целевой элемент', async () => {
    renderBoard()
    await userEvent.click(screen.getByRole('button', { name: 'Меню колонки «To Do»' }))
    expect(screen.getByTestId('column-menu')).toBeInTheDocument()

    await userEvent.click(screen.getByText('A'))

    expect(screen.queryByTestId('column-menu')).not.toBeInTheDocument()
    expect(await screen.findByTestId('task-modal')).toBeInTheDocument()
  })

  it('нажатие внутри меню колонки не закрывает его преждевременно', async () => {
    renderBoard()
    await userEvent.click(screen.getByRole('button', { name: 'Меню колонки «To Do»' }))
    const menu = screen.getByTestId('column-menu')

    fireEvent.pointerDown(menu)

    expect(menu).toBeInTheDocument()
  })

  it('Escape закрывает меню колонки', async () => {
    renderBoard()
    await userEvent.click(screen.getByRole('button', { name: 'Меню колонки «To Do»' }))

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByTestId('column-menu')).not.toBeInTheDocument()
  })

  it('повторное нажатие на триггер закрывает меню колонки', async () => {
    renderBoard()
    const trigger = screen.getByRole('button', { name: 'Меню колонки «To Do»' })
    await userEvent.click(trigger)
    expect(screen.getByTestId('column-menu')).toBeInTheDocument()

    await userEvent.click(trigger)

    expect(screen.queryByTestId('column-menu')).not.toBeInTheDocument()
  })

  it('колонка с semanticType done показывает последний вход сверху независимо от позиции', () => {
    renderBoard({
      board: {
        columns: [
          { id: 'c1', projectId: 'p1', name: 'Работа', semanticType: 'development', position: 1024, hidden: false, wipLimit: null, createdAt: 1 },
          { id: 'c2', projectId: 'p1', name: 'Архив', semanticType: 'done', position: 2048, hidden: false, wipLimit: null, createdAt: 1 }
        ],
        tasks: [
          task({ id: 'old', columnId: 'c2', title: 'Раньше', position: 1024, doneAt: 10 }),
          task({ id: 'new', columnId: 'c2', title: 'Позже', position: 2048, doneAt: 20 })
        ]
      }
    })
    expect(screen.getAllByTestId('task-card').map((card) => card.textContent)).toEqual([
      expect.stringContaining('Позже'),
      expect.stringContaining('Раньше')
    ])
  })

  it('«Показать завершённые» сообщает наружу — состав доски решает сервер', async () => {
    const onShowCompletedChange = vi.fn()
    renderBoard({ showCompleted: false, onShowCompletedChange })
    const filters = screen.getByTestId('board-filters')
    const toggle = within(filters).getByRole('checkbox', { name: /Показать завершённые/ })
    expect(toggle).not.toBeChecked()
    await userEvent.click(toggle)
    expect(onShowCompletedChange).toHaveBeenCalledWith(true)
  })

  it('«Показывать чаты завершённых задач» сообщает наружу — список бесед фильтрует сервер', async () => {
    const onShowDoneTaskChatsChange = vi.fn()
    renderBoard({ showDoneTaskChats: false, onShowDoneTaskChatsChange })
    const filters = screen.getByTestId('board-filters')
    await userEvent.click(within(filters).getByRole('checkbox', { name: /Показывать чаты завершённых задач/ }))
    expect(onShowDoneTaskChatsChange).toHaveBeenCalledWith(true)
  })

  it('без колбэка галки «Показывать чаты завершённых задач» нет (Storybook/desktop)', () => {
    renderBoard()
    expect(
      within(screen.getByTestId('board-filters')).queryByRole('checkbox', { name: /Показывать чаты завершённых задач/ })
    ).not.toBeInTheDocument()
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
    // Описание карточки — маркдаун в просмотре; палочка появляется в правке.
    await userEvent.click(await screen.findByTestId('task-desc-empty'))
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

  it('удаление колонки требует набрать её название', async () => {
    const props = renderBoard()
    const filters = screen.getByTestId('board-filters')
    await userEvent.click(within(filters).getByRole('checkbox', { name: /скрытые/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Меню колонки «Скрытая»' }))
    await userEvent.click(screen.getByRole('button', { name: 'Удалить' }))

    const dialog = await screen.findByTestId('confirm-dialog')
    expect(within(dialog).getByRole('heading', { name: 'Удалить колонку «Скрытая» со всеми задачами?' })).toBeInTheDocument()
    // Необратимо и уносит задачи — пока название не набрано, кнопка выключена.
    const ok = within(dialog).getByRole('button', { name: 'Удалить колонку' })
    expect(ok).toBeDisabled()
    await userEvent.type(within(dialog).getByRole('textbox'), 'Скрытая')
    await userEvent.click(ok)
    // Ответ приходит промисом (useConfirm) — ждём следующего такта.
    await waitFor(() => expect(props.onDeleteColumn).toHaveBeenCalledWith('c2'))
  })

  it('без openTaskId-пропсов модалка управляется внутренним состоянием', async () => {
    renderBoard()
    await userEvent.click(screen.getByText('A'))
    expect(await screen.findByTestId('task-modal')).toBeInTheDocument()
  })

  // Раны разных задач идут параллельно, поэтому доска не считает активный ран
  // единственным: подсветка берётся из сводки по taskId, у каждой карточки своя.
  it('несколько ранов одновременно: каждая карточка подсвечена своим статусом', () => {
    const ciSummary = (taskId: string, over: Partial<CiRunSummary>): CiRunSummary => ({
      id: `run-${taskId}`, taskId, status: 'running',
      slotProgress: { done: 1, total: 4, phase: 'Модель работает' },
      durationMs: null, modelActive: false, awaitingInput: false, ...over
    })
    renderBoard({
      board: { ...board, tasks: [task({ id: 't1', title: 'A' }), task({ id: 't2', title: 'B' }), task({ id: 't3', title: 'C' })] },
      ciSummaries: {
        t1: ciSummary('t1', { status: 'running' }),
        t2: ciSummary('t2', { status: 'awaiting_input', awaitingInput: true }),
        t3: ciSummary('t3', { status: 'failed' })
      },
      onStartCi: vi.fn(),
      onOpenCiRun: vi.fn()
    })
    const cards = screen.getAllByTestId('task-card')
    expect(cards).toHaveLength(3)
    expect(cards[0]!.className).toContain('jcard--ci-running')
    expect(cards[1]!.className).toContain('jcard--ci-awaiting')
    expect(cards[2]!.className).toContain('jcard--ci-failed')
  })
})

describe('KanbanBoard — состояния загрузки, пустоты и ошибки', () => {
  it('первая загрузка — скелетон колонок и карточек, самой доски ещё нет', () => {
    renderBoard({ board: null, loading: true })
    const skeleton = screen.getByTestId('kanban-skeleton')
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
    expect(within(skeleton).getAllByTestId('skeleton').length).toBeGreaterThan(3)
    expect(screen.queryByTestId('kanban-board')).not.toBeInTheDocument()
  })

  it('повторная загрузка уже показанной доски её не подменяет скелетоном', () => {
    renderBoard({ loading: true })
    expect(screen.queryByTestId('kanban-skeleton')).not.toBeInTheDocument()
    expect(screen.getByTestId('kanban-board')).toBeInTheDocument()
    expect(screen.getByText('Обновляем доску…')).toBeInTheDocument()
  })

  it('ошибка без доски предлагает «Повторить»', async () => {
    const onRetry = vi.fn()
    renderBoard({ board: null, error: 'ECONNREFUSED', onRetry })
    await userEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Повторить' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('доска без колонок объясняет, что такое колонка', () => {
    renderBoard({ board: { columns: [], tasks: [] } })
    expect(screen.getByText('Колонок пока нет — создайте первую')).toBeInTheDocument()
  })

  it('пустая колонка подсказывает, чем её наполнить', () => {
    renderBoard({ board: { columns: [board.columns[0]!], tasks: [] } })
    const column = screen.getByTestId('kanban-column')
    expect(within(column).getByTestId('empty-state')).toHaveTextContent('Здесь пока пусто')
  })
})

// ---- Перенос задач: указатель (мышь/палец) и клавиатура ---------------------
// HTML5 DnD заменён pointer-жестом, поэтому сценарии — pointerdown → pointermove
// → pointerup, а не dragStart/drop.

const dndBoard: Board = {
  columns: [
    { id: 'c1', projectId: 'p1', name: 'To Do', semanticType: 'backlog', position: 1024, hidden: false, wipLimit: null, createdAt: 1 },
    { id: 'c2', projectId: 'p1', name: 'In Progress', semanticType: 'development', position: 2048, hidden: false, wipLimit: null, createdAt: 1 }
  ],
  tasks: [
    task({ id: 't1', title: 'A', columnId: 'c1', position: 1024, seq: 1 }),
    task({ id: 't2', title: 'B', columnId: 'c1', position: 2048, seq: 2 }),
    task({ id: 't3', title: 'C', columnId: 'c2', position: 1024, seq: 3 })
  ]
}

/**
 * jsdom не считает раскладку — все getBoundingClientRect нулевые, и хит-тест
 * доски проверять было бы нечем. Раскладываем сами: колонка i — полоса по X с
 * шагом 300, внутри тела колонки зоны (10px) и карточки (60px) идут сверху вниз.
 *
 * Колонка c1: зона 100–110, A 110–170, зона 170–180, B 180–240, зона 240–250.
 * Колонка c2 (x от 300): зона 100–110, C 110–170, зона 170–180.
 */
function layout(): void {
  const put = (el: Element, left: number, top: number, width: number, height: number): void => {
    el.getBoundingClientRect = () =>
      ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) }) as DOMRect
  }
  put(screen.getByTestId('kanban-board'), 0, 0, 900, 600)
  document.querySelectorAll('[data-column-id]').forEach((col, i) => put(col, i * 300, 0, 272, 600))
  document.querySelectorAll<HTMLElement>('[data-drop-body]').forEach((body, i) => {
    const left = i * 300
    put(body, left, 100, 272, 400)
    let y = 100
    for (const item of Array.from(body.querySelectorAll<HTMLElement>('[data-dropzone], [data-testid="task-card"]'))) {
      const height = item.hasAttribute('data-dropzone') ? 10 : 60
      put(item, left, y, 272, height)
      y += height
    }
  })
}

const down = (el: Element, x: number, y: number, init: PointerEventInit = {}): void => {
  fireEvent.pointerDown(el, { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', ...init })
}
const move = (x: number, y: number, init: PointerEventInit = {}): void => {
  fireEvent.pointerMove(window, { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', ...init })
}
const up = (x: number, y: number, init: PointerEventInit = {}): void => {
  fireEvent.pointerUp(window, { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', ...init })
}

describe('KanbanBoard — перенос указателем', () => {
  // После переноса движок гасит один клик (иначе карточка открывалась бы
  // модалкой). Съедаем его здесь, чтобы он не достался следующему тесту.
  afterEach(() => fireEvent.click(document.body))

  it('мышь: карточка переносится в другую колонку — move с соседями этой колонки', () => {
    const props = renderBoard({ board: dndBoard })
    layout()
    const card = screen.getAllByTestId('task-card')[0]!
    down(card, 40, 130)
    // Порог: до него это клик, после — перенос с плейсхолдером и копией под курсором.
    expect(screen.queryByTestId('drop-placeholder')).not.toBeInTheDocument()
    move(60, 140)
    expect(screen.getByTestId('drop-placeholder')).toBeInTheDocument()
    expect(document.querySelector('.vc-drag-ghost')).not.toBeNull()
    // Копия — картинка, а не второй экземпляр карточки.
    expect(screen.getAllByTestId('task-card')).toHaveLength(3)

    move(360, 175)
    up(360, 175)
    expect(props.onMoveTask).toHaveBeenCalledWith('t1', 'c2', 't3', null)
    expect(document.querySelector('.vc-draglayer')).toBeNull()
    expect(screen.queryByTestId('drop-placeholder')).not.toBeInTheDocument()
  })

  it('мышь: у нижнего края прокручивается только список активной колонки', () => {
    vi.useFakeTimers()
    try {
      renderBoard({ board: dndBoard })
      layout()
      const surface = screen.getByTestId('kanban-board')
      const bodies = document.querySelectorAll<HTMLElement>('[data-drop-body]')
      bodies[0]!.scrollTop = 100
      bodies[1]!.scrollTop = 40
      const card = screen.getAllByTestId('task-card')[0]!

      down(card, 40, 130)
      move(40, 490)
      act(() => vi.advanceTimersByTime(20))

      expect(bodies[0]!.scrollTop).toBeGreaterThan(100)
      expect(bodies[1]!.scrollTop).toBe(40)
      expect(surface.scrollTop).toBe(0)
      up(40, 490)
    } finally {
      vi.useRealTimers()
    }
  })

  it('мышь: у боковой кромки продолжает прокручиваться общая поверхность', () => {
    vi.useFakeTimers()
    try {
      renderBoard({ board: dndBoard })
      layout()
      const surface = screen.getByTestId('kanban-board')
      surface.scrollLeft = 100
      const card = screen.getAllByTestId('task-card')[0]!

      down(card, 40, 130)
      move(890, 300)
      act(() => vi.advanceTimersByTime(20))

      expect(surface.scrollLeft).toBeGreaterThan(100)
      up(890, 300)
    } finally {
      vi.useRealTimers()
    }
  })

  it('мышь: перенос внутрь своей колонки считает afterId/beforeId по зоне', () => {
    const props = renderBoard({ board: dndBoard })
    layout()
    const card = screen.getAllByTestId('task-card')[1]!
    down(card, 40, 200)
    move(40, 130)
    move(40, 104)
    up(40, 104)
    expect(props.onMoveTask).toHaveBeenCalledWith('t2', 'c1', null, 't1')
  })

  it('брошенная на своё же место карточка сервер не тревожит', () => {
    const props = renderBoard({ board: dndBoard })
    layout()
    const card = screen.getAllByTestId('task-card')[0]!
    down(card, 40, 130)
    move(40, 145)
    up(40, 145)
    expect(props.onMoveTask).not.toHaveBeenCalled()
  })

  it('палец: перенос начинается удержанием, короткий скролл его не запускает', () => {
    vi.useFakeTimers()
    try {
      const props = renderBoard({ board: dndBoard })
      layout()
      const card = screen.getAllByTestId('task-card')[1]!

      // Палец поехал раньше удержания — это скролл колонки, а не перенос.
      down(card, 40, 200, { pointerType: 'touch' })
      move(40, 160, { pointerType: 'touch' })
      act(() => vi.advanceTimersByTime(DRAG_HOLD_MS * 2))
      expect(screen.queryByTestId('drop-placeholder')).not.toBeInTheDocument()
      up(40, 160, { pointerType: 'touch' })
      expect(props.onMoveTask).not.toHaveBeenCalled()

      // Удержал на месте — карточка поднялась и переносится.
      down(card, 40, 200, { pointerType: 'touch' })
      act(() => vi.advanceTimersByTime(DRAG_HOLD_MS))
      expect(screen.getByTestId('drop-placeholder')).toBeInTheDocument()
      move(360, 175, { pointerType: 'touch' })
      up(360, 175, { pointerType: 'touch' })
      expect(props.onMoveTask).toHaveBeenCalledWith('t2', 'c2', 't3', null)
    } finally {
      vi.useRealTimers()
    }
  })

  it('палец с ручки захвата: перенос сразу, без удержания', () => {
    const props = renderBoard({ board: dndBoard })
    layout()
    const grip = screen.getAllByTestId('task-card')[0]!.querySelector('.jcard-grip')!
    down(grip, 20, 130, { pointerType: 'touch' })
    expect(screen.getByTestId('drop-placeholder')).toBeInTheDocument()
    move(360, 105, { pointerType: 'touch' })
    up(360, 105, { pointerType: 'touch' })
    expect(props.onMoveTask).toHaveBeenCalledWith('t1', 'c2', null, 't3')
  })

  it('Esc и pointercancel возвращают карточку на место, не обращаясь к серверу', () => {
    const props = renderBoard({ board: dndBoard })
    layout()
    const cards = screen.getAllByTestId('task-card')

    down(cards[0]!, 40, 130)
    move(360, 175)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(props.onMoveTask).not.toHaveBeenCalled()
    expect(document.querySelector('.vc-draglayer')).toBeNull()
    expect(screen.queryByTestId('drop-placeholder')).not.toBeInTheDocument()
    // Отпускание уже отменённого жеста ничего не двигает.
    up(360, 175)
    expect(props.onMoveTask).not.toHaveBeenCalled()

    down(cards[0]!, 40, 130)
    move(360, 175)
    fireEvent.pointerCancel(window, { clientX: 360, clientY: 175, pointerId: 1 })
    expect(props.onMoveTask).not.toHaveBeenCalled()
    expect(document.querySelector('.vc-draglayer')).toBeNull()
  })

  it('мышь: колонка перетаскивается за шапку — onReorderColumns с новым порядком', () => {
    const props = renderBoard({ board: dndBoard })
    layout()
    const heads = document.querySelectorAll<HTMLElement>('.jcol-head')
    down(heads[1]!, 320, 20)
    move(300, 20)
    move(40, 20)
    up(40, 20)
    expect(props.onReorderColumns).toHaveBeenCalledWith(['c2', 'c1'])
  })
})

describe('KanbanBoard — перенос с клавиатуры', () => {
  const live = (): HTMLElement => screen.getByTestId('kanban-live')

  it('Space берёт задачу, стрелки выбирают место, Enter кладёт', () => {
    const props = renderBoard({ board: dndBoard })
    const card = screen.getAllByTestId('task-card')[0]!
    card.focus()

    fireEvent.keyDown(card, { key: ' ' })
    expect(live()).toHaveTextContent('Задача «A» взята')
    expect(live()).toHaveTextContent('Колонка «To Do», позиция 1 из 2')
    expect(screen.getByTestId('drop-placeholder')).toBeInTheDocument()

    fireEvent.keyDown(card, { key: 'ArrowDown' })
    expect(live()).toHaveTextContent('Задача «A», колонка «To Do», позиция 2 из 2.')

    fireEvent.keyDown(card, { key: 'ArrowRight' })
    expect(live()).toHaveTextContent('Задача «A», колонка «In Progress», позиция 2 из 2.')

    fireEvent.keyDown(card, { key: 'Enter' })
    expect(props.onMoveTask).toHaveBeenCalledWith('t1', 'c2', 't3', null)
    expect(live()).toHaveTextContent('перенесена: колонка «In Progress», позиция 2')
    expect(screen.queryByTestId('drop-placeholder')).not.toBeInTheDocument()
  })

  it('стрелка вверх меняет порядок внутри колонки', () => {
    const props = renderBoard({ board: dndBoard })
    const card = screen.getAllByTestId('task-card')[1]!
    card.focus()
    fireEvent.keyDown(card, { key: ' ' })
    expect(live()).toHaveTextContent('позиция 2 из 2')
    fireEvent.keyDown(card, { key: 'ArrowUp' })
    fireEvent.keyDown(card, { key: 'Enter' })
    expect(props.onMoveTask).toHaveBeenCalledWith('t2', 'c1', null, 't1')
  })

  it('Esc отменяет перенос, а Enter на исходном месте не идёт на сервер', () => {
    const props = renderBoard({ board: dndBoard })
    const card = screen.getAllByTestId('task-card')[0]!
    card.focus()

    fireEvent.keyDown(card, { key: ' ' })
    fireEvent.keyDown(card, { key: 'ArrowRight' })
    fireEvent.keyDown(card, { key: 'Escape' })
    expect(live()).toHaveTextContent('Перенос задачи «A» отменён.')
    expect(props.onMoveTask).not.toHaveBeenCalled()
    expect(screen.queryByTestId('drop-placeholder')).not.toBeInTheDocument()

    fireEvent.keyDown(card, { key: ' ' })
    fireEvent.keyDown(card, { key: 'Enter' })
    expect(live()).toHaveTextContent('осталась на месте')
    expect(props.onMoveTask).not.toHaveBeenCalled()
  })

  it('за границы доски перенос не уезжает: крайняя колонка остаётся крайней', () => {
    const props = renderBoard({ board: dndBoard })
    const card = screen.getAllByTestId('task-card')[0]!
    card.focus()
    fireEvent.keyDown(card, { key: ' ' })
    fireEvent.keyDown(card, { key: 'ArrowLeft' })
    expect(live()).toHaveTextContent('Колонка «To Do»')
    fireEvent.keyDown(card, { key: 'ArrowUp' })
    fireEvent.keyDown(card, { key: 'Enter' })
    expect(props.onMoveTask).not.toHaveBeenCalled()
  })
})


describe('KanbanBoard — своя команда в реестре', () => {
  afterEach(() => resetCommands())

  it('регистрирует «Создать задачу», пока доска на экране', () => {
    const { unmount } = render(<KanbanBoardHarness />)
    const command = listCommands().find((c) => c.id === 'kanban.create-task')
    expect(command).toBeDefined()
    expect(command!.title).toBe('Создать задачу')
    // Подпись ведёт к колонке, в которую попадёт задача.
    expect(command!.hint).toContain('To Do')
    unmount()
    // Экран ушёл — команде в палитре делать нечего.
    expect(listCommands().find((c) => c.id === 'kanban.create-task')).toBeUndefined()
  })

  it('команда открывает композер первой видимой колонки', async () => {
    render(<KanbanBoardHarness />)
    const command = listCommands().find((c) => c.id === 'kanban.create-task')!
    act(() => command.run())
    expect(await screen.findByLabelText('Новая задача в «To Do»')).toBeInTheDocument()
  })

  it('пустая доска команду не даёт: колонки, куда создавать, нет', () => {
    render(<KanbanBoardHarness board={{ columns: [], tasks: [] }} />)
    expect(listCommands().find((c) => c.id === 'kanban.create-task')).toBeUndefined()
  })
})

/** Доска с обязательными пропсами — для проверок реестра команд. */
function KanbanBoardHarness(props: Partial<KanbanBoardProps> = {}): JSX.Element {
  return (
    <KanbanBoard
      projectName="P1"
      board={board}
      loading={false}
      members={[]}
      currentUser={null}
      onCreateColumn={vi.fn()}
      onUpdateColumn={vi.fn()}
      onSetColumnHidden={vi.fn()}
      onReorderColumns={vi.fn()}
      onDeleteColumn={vi.fn()}
      onCreateTask={vi.fn()}
      onUpdateTask={vi.fn()}
      onMoveTask={vi.fn()}
      onDeleteTask={vi.fn()}
      onOpenChat={vi.fn()}
      {...props}
    />
  )
}

describe('KanbanBoard — доступность', () => {
  it('без нарушений axe: доска, фильтры, колонки', async () => {
    renderBoard()
    await expectNoViolations()
    expectLabelledIconButtons()
  })

  it('без нарушений axe: пустая доска и ошибка загрузки', async () => {
    renderBoard({ board: { columns: [], tasks: [] } })
    await expectNoViolations()
  })
})

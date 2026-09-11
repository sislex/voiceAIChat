import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { MOBILE_QUERY } from '@voicechat/ui-foundation/lib/mediaQuery'
import { expectLabelledIconButtons, expectNoViolations } from '@voicechat/ui-foundation/test/a11y'
import { act, fireEvent, screen, within, waitFor, cleanup } from '@testing-library/react'
import { render } from '../../test/uiRender'
import userEvent from '@testing-library/user-event'
import { KanbanBoard, type KanbanBoardProps } from './KanbanBoard'
import type { Board, Task } from '@shared/projects'
import { DEFAULT_BOARD_VIEW } from '@shared/projects'
import type { CiRunSummary } from '@shared/ci'
import type { GenerateParams } from '../prompt-builder/PromptBuilder'
import { DRAG_HOLD_MS } from '@voicechat/ui-foundation/lib/dnd'
import { listCommands, resetCommands } from '@voicechat/ui-foundation/runtime'
import { createFakeCi } from '@voicechat/ui-foundation/test/fakeApi'

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

  it('показывает справку только для шести автоматизированных semantic type, независимо от названия', () => {
    const semanticTypes = ['preparation', 'development', 'component_qa', 'integration_tests', 'automated_qa', 'merge', 'backlog', 'ready', 'manual_qa', 'custom'] as const
    renderBoard({
      board: {
        columns: semanticTypes.map((semanticType, index) => ({ ...board.columns[0]!, id: `c-${semanticType}`, name: semanticType === 'development' ? 'Переименовано пользователем' : semanticType, semanticType, position: (index + 1) * 1024 })),
        tasks: []
      }
    })

    const buttons = screen.getAllByRole('button', { name: /Об автоматизации стадии/ })
    expect(buttons).toHaveLength(6)
    expect(screen.getByRole('button', { name: 'Об автоматизации стадии «Development / In progress»' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Backlog/ })).not.toBeInTheDocument()
  })

  it('открывает описание выбранной стадии и закрывает его кнопкой с возвратом фокуса', async () => {
    renderBoard({ board: { columns: [{ ...board.columns[0]!, name: 'Любое имя', semanticType: 'component_qa' }], tasks: [] } })
    const opener = screen.getByRole('button', { name: 'Об автоматизации стадии «Component QA»' })
    await userEvent.click(opener)

    const dialog = screen.getByRole('dialog', { name: 'Component QA' })
    expect(within(dialog).getByRole('heading', { name: 'Когда запускается' })).toBeInTheDocument()
    expect(within(dialog).getByText(/component_qa_runs/)).toBeInTheDocument()
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Закрыть справку об автоматизации' }))

    await userEvent.click(within(dialog).getByRole('button', { name: 'Закрыть справку об автоматизации' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(document.activeElement).toBe(opener))
  })

  it('Escape закрывает справку, возвращает фокус и кнопка не начинает перенос колонки', async () => {
    const props = renderBoard({ board: { columns: [{ ...board.columns[0]!, semanticType: 'merge' }], tasks: [] } })
    const opener = screen.getByRole('button', { name: 'Об автоматизации стадии «Merge»' })
    fireEvent.pointerDown(opener, { pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 10 })
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100 })
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100 })
    await userEvent.click(opener)
    expect(screen.getByRole('dialog', { name: 'Merge' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(document.activeElement).toBe(opener))
    expect(props.onReorderColumns).not.toHaveBeenCalled()
  })

  it('WIP-шкалы показывают запас, предел и превышение независимо от фильтров', async () => {
    const columns = [
      { ...board.columns[0]!, id: 'available', name: 'Есть место', wipLimit: 3, position: 1024 },
      { ...board.columns[0]!, id: 'full', name: 'На пределе', wipLimit: 2, position: 2048 },
      { ...board.columns[0]!, id: 'over', name: 'Переполнена', wipLimit: 2, position: 3072 },
      { ...board.columns[0]!, id: 'unlimited', name: 'Без лимита', wipLimit: null, position: 4096 }
    ]
    renderBoard({
      board: {
        columns,
        tasks: [
          task({ id: 'a1', columnId: 'available', flagged: true }),
          task({ id: 'f1', columnId: 'full' }), task({ id: 'f2', columnId: 'full' }),
          task({ id: 'o1', columnId: 'over' }), task({ id: 'o2', columnId: 'over' }), task({ id: 'o3', columnId: 'over' })
        ]
      }
    })

    const available = screen.getByRole('progressbar', { name: 'Заполнение WIP колонки «Есть место»' })
    expect(available).toHaveAttribute('aria-valuenow', '1')
    expect(available).toHaveAttribute('aria-valuemax', '3')
    expect(available).toHaveAttribute('aria-valuetext', 'WIP: 1 из 3, свободно 2 места')
    expect(available.firstElementChild).toHaveStyle({ width: '33%' })

    const full = screen.getByRole('progressbar', { name: 'Заполнение WIP колонки «На пределе»' })
    expect(full).toHaveAttribute('aria-valuetext', 'WIP-лимит заполнен: 2 из 2')
    expect(full.closest('.jcol-head')).toHaveClass('jcol-head--full')

    const over = screen.getByRole('progressbar', { name: 'Заполнение WIP колонки «Переполнена»' })
    expect(over).toHaveAttribute('aria-valuenow', '2')
    expect(over).toHaveAttribute('aria-valuetext', 'WIP-лимит превышен: 3 из 2, превышение на 1 задача')
    expect(over.firstElementChild).toHaveStyle({ width: '100%' })
    expect(screen.queryByRole('progressbar', { name: /Без лимита/ })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'С флагом' }))
    expect(available).toHaveAttribute('aria-valuetext', 'WIP: 1 из 3, свободно 2 места')
    expect(full).toHaveAttribute('aria-valuetext', 'WIP-лимит заполнен: 2 из 2')
  })

  // @testCase TC-REG-1
  it('открытие и закрытие legacy-карточки сохраняет общую вертикальную позицию доски', async () => {
    renderBoard()
    const surface = screen.getByTestId('kanban-board')
    surface.scrollTop = 240

    await userEvent.click(screen.getByText('A'))
    expect(await screen.findByTestId('task-modal')).toBeInTheDocument()
    expect(surface.scrollTop).toBe(240)

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('task-modal')).not.toBeInTheDocument())
    expect(surface.scrollTop).toBe(240)
  })

  it('«Подробнее» подготовки открывает модалку сразу на preparation-вкладке', async () => {
    const preparationBoard: Board = {
      columns: [{ ...board.columns[0]!, name: 'Подготовка к разработке', semanticType: 'preparation' }],
      tasks: [task({ id: 't1', title: 'A', taskPreparationRunId: 'prep-1', taskPreparationStatus: 'failed' })]
    }
    renderBoard({ board: preparationBoard, loadPreparationRuns: async () => [{ id: 'prep-1', projectId: 'p1', taskId: 't1', status: 'failed', attempt: 1, maxAttempts: 2, log: 'Лента', error: 'Ошибка', readiness: null, gateReasons: [], createdAt: 1, finishedAt: 2, canRetry: true, canCancel: false }] })

    await userEvent.click(screen.getByRole('button', { name: 'Подробнее' }))

    expect(await screen.findByTestId('task-modal')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Подготовка к разработке' })).toHaveAttribute('aria-selected', 'true')
  })

  it('восстанавливает обе оси после замены scroll-контейнера и не переносит их на другой проект', () => {
    const view = render(<KanbanBoardHarness scrollScopeId="p1" board={dndBoard} />)
    const surface = screen.getByTestId('kanban-board')
    surface.scrollLeft = 180
    surface.scrollTop = 120
    fireEvent.scroll(surface)

    view.rerender(<KanbanBoardHarness scrollScopeId="p1" board={{ ...dndBoard, tasks: [...dndBoard.tasks] }} />)
    expect(screen.getByTestId('kanban-board')).toBe(surface)
    expect(surface.scrollLeft).toBe(180)
    expect(surface.scrollTop).toBe(120)

    view.rerender(<KanbanBoardHarness scrollScopeId="p1" board={null} loading />)
    expect(screen.queryByTestId('kanban-board')).not.toBeInTheDocument()

    view.rerender(<KanbanBoardHarness scrollScopeId="p1" board={{ ...dndBoard, tasks: [...dndBoard.tasks] }} />)
    const restored = screen.getByTestId('kanban-board')
    expect(restored).not.toBe(surface)
    expect(restored.scrollLeft).toBe(180)
    expect(restored.scrollTop).toBe(120)

    view.rerender(<KanbanBoardHarness scrollScopeId="p2" board={{
      columns: dndBoard.columns.map((column) => ({ ...column, projectId: 'p2' })),
      tasks: dndBoard.tasks.map((item) => ({ ...item, projectId: 'p2' }))
    }} />)
    const otherProject = screen.getByTestId('kanban-board')
    expect(otherProject.scrollLeft).toBe(0)
    expect(otherProject.scrollTop).toBe(0)
  })

  it('чекбокс «скрытые» в панели фильтров показывает скрытые колонки', async () => {
    renderBoard()
    expect(screen.getAllByTestId('kanban-column')).toHaveLength(1)
    const filters = screen.getByTestId('board-filters')
    await userEvent.click(within(filters).getByRole('checkbox', { name: /скрытые/ }))
    expect(screen.getAllByTestId('kanban-column')).toHaveLength(2)
    expect(screen.getByText('Скрытая')).toBeInTheDocument()
  })

  it('ищет по содержимому, меткам и исполнителю и показывает количество результатов', async () => {
    renderBoard({
      board: {
        columns: [board.columns[0]!],
        tasks: [
          task({ id: 'title', title: 'Уникальный заголовок' }),
          task({ id: 'description', title: 'Описание', description: 'Содержит webhook' }),
          task({ id: 'criteria', title: 'Критерий', acceptanceCriteria: 'Должен пройти smoke' }),
          task({ id: 'meta', title: 'Метаданные', labels: ['payments'], assignee: 'alexey' })
        ]
      }
    })
    const search = screen.getByRole('searchbox', { name: 'Поиск на доске' })
    const count = screen.getByTestId('board-result-count')
    expect(count).toHaveTextContent('Показано 4 из 4')
    expect(count).toHaveAttribute('role', 'status')

    await userEvent.type(search, 'webhook')
    expect(screen.getAllByTestId('task-card')).toHaveLength(1)
    expect(screen.getByText('Описание')).toBeInTheDocument()

    await userEvent.clear(search)
    await userEvent.type(search, 'smoke')
    expect(screen.getByText('Критерий')).toBeInTheDocument()

    await userEvent.clear(search)
    await userEvent.type(search, 'payments')
    expect(screen.getByText('Метаданные')).toBeInTheDocument()

    await userEvent.clear(search)
    await userEvent.type(search, 'alexey')
    expect(count).toHaveTextContent('Показано 1 из 4')
    expect(screen.getByText('Метаданные')).toBeInTheDocument()
  })

  it('сводит метрики видимых задач и пересчитывает их после фильтра и обновления доски', async () => {
    const columns = [
      board.columns[0]!,
      { ...board.columns[0]!, id: 'done', name: 'Готово', semanticType: 'done' as const, position: 2048 }
    ]
    const tasks = [
      task({ id: 'first', title: 'Первая', storyPoints: 3, dueDate: Date.now() - 2 * 86_400_000, flagged: true }),
      task({ id: 'second', title: 'Вторая', storyPoints: 5, dueDate: Date.now() + 2 * 86_400_000, assignee: 'bob' }),
      task({ id: 'complete', title: 'Завершённая', columnId: 'done', storyPoints: 2, dueDate: Date.now() - 2 * 86_400_000, assignee: 'bob' })
    ]
    const props: KanbanBoardProps = {
      projectName: 'P1', board: { columns, tasks }, loading: false, members: [],
      onCreateColumn: vi.fn(), onUpdateColumn: vi.fn(), onSetColumnHidden: vi.fn(),
      onReorderColumns: vi.fn(), onDeleteColumn: vi.fn(), onCreateTask: vi.fn(),
      onUpdateTask: vi.fn(), onMoveTask: vi.fn(), onDeleteTask: vi.fn()
    }
    const view = render(<KanbanBoard {...props} />)
    const summary = screen.getByRole('region', { name: 'Сводка доски' })

    expect(within(summary).getByLabelText('Видно: 3 задачи')).toHaveTextContent('3 задачи')
    expect(within(summary).getByLabelText('Оценка: 10 SP')).toHaveTextContent('10 SP')
    expect(within(summary).getByLabelText('Просрочено: 1 задача')).toHaveTextContent('1 задача')
    expect(within(summary).getByLabelText('Без исполнителя: 1 задача')).toHaveTextContent('1 задача')
    expect(within(summary).getByLabelText('С флагом: 1 задача')).toHaveTextContent('1 задача')
    expect(within(summary).getByLabelText('Завершено: 1 задача')).toHaveTextContent('1 задача')

    const search = screen.getByRole('searchbox', { name: 'Поиск на доске' })
    await userEvent.type(search, 'Вторая')
    expect(within(summary).getByLabelText('Видно: 1 задача')).toBeInTheDocument()
    expect(within(summary).getByLabelText('Оценка: 5 SP')).toBeInTheDocument()
    expect(within(summary).getByLabelText('Просрочено: 0 задач')).toBeInTheDocument()

    await userEvent.clear(search)
    view.rerender(<KanbanBoard {...props} board={{ columns, tasks: [...tasks, task({ id: 'live', title: 'Живое обновление', storyPoints: 2 })] }} />)
    expect(within(summary).getByLabelText('Видно: 4 задачи')).toBeInTheDocument()
    expect(within(summary).getByLabelText('Оценка: 12 SP')).toBeInTheDocument()
    expect(within(summary).getByLabelText('Без исполнителя: 2 задачи')).toBeInTheDocument()
  })

  it('метрики включают синхронные быстрые срезы, chips и общий сброс', async () => {
    const columns = [
      board.columns[0]!,
      { ...board.columns[0]!, id: 'done', name: 'Готово', semanticType: 'done' as const, position: 2048 }
    ]
    const onShowCompletedChange = vi.fn()
    renderBoard({
      board: {
        columns,
        tasks: [
          task({ id: 'late', title: 'Просроченная', dueDate: Date.now() - 2 * 86_400_000, flagged: true }),
          task({ id: 'assigned', title: 'Назначенная', assignee: 'bob' }),
          task({ id: 'complete', title: 'Завершённая', columnId: 'done', assignee: 'bob' })
        ]
      },
      showCompleted: false,
      onShowCompletedChange
    })
    const summary = screen.getByRole('region', { name: 'Сводка доски' })

    const overdue = within(summary).getByRole('button', { name: 'Просрочено: 1 задача' })
    await userEvent.click(overdue)
    expect(overdue).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByTestId('task-card')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Удалить фильтр: Просрочено' })).toBeInTheDocument()
    await userEvent.click(overdue)

    const unassigned = within(summary).getByRole('button', { name: 'Без исполнителя: 1 задача' })
    await userEvent.click(unassigned)
    expect(unassigned).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Удалить фильтр: Исполнитель: не назначено' })).toBeInTheDocument()
    await userEvent.click(unassigned)

    const flagged = within(summary).getByRole('button', { name: 'С флагом: 1 задача' })
    await userEvent.click(flagged)
    expect(flagged).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'С флагом' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(flagged)

    await userEvent.click(within(summary).getByRole('button', { name: 'Завершено: 1 задача' }))
    expect(onShowCompletedChange).toHaveBeenCalledWith(true)
    expect(screen.getAllByTestId('kanban-column')).toHaveLength(1)
    expect(screen.getByText('Готово')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Удалить фильтр: Завершено' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Сбросить все' }))
    expect(screen.getAllByTestId('kanban-column')).toHaveLength(2)
    expect(within(summary).getByRole('button', { name: 'Завершено: 1 задача' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('фокусирует поиск по /, очищает его по Escape и отдельной кнопкой', async () => {
    renderBoard()
    const search = screen.getByRole('searchbox', { name: 'Поиск на доске' })
    expect(search).toHaveAttribute('aria-keyshortcuts', '/')

    fireEvent.keyDown(document.body, { key: '/' })
    expect(document.activeElement).toBe(search)

    await userEvent.type(search, 'нет')
    await userEvent.keyboard('{Escape}')
    expect(search).toHaveValue('')
    expect(document.activeElement).toBe(search)

    await userEvent.type(search, 'другой')
    const clear = screen.getByRole('button', { name: 'Очистить поиск на доске' })
    expect(clear).toHaveAttribute('title', 'Очистить поиск')
    await userEvent.click(clear)
    expect(search).toHaveValue('')
    expect(document.activeElement).toBe(search)
  })

  it('объясняет нулевой результат и сбрасывает все фильтры одним действием', async () => {
    renderBoard()
    await userEvent.type(screen.getByRole('searchbox', { name: 'Поиск на доске' }), 'ничего не найдено')

    const empty = screen.getByTestId('kanban-filter-empty')
    expect(empty).toHaveTextContent('По выбранным фильтрам задач не найдено')
    expect(screen.getByTestId('board-result-count')).toHaveTextContent('Показано 0 из 1')

    await userEvent.click(within(empty).getByRole('button', { name: 'Сбросить все фильтры' }))
    expect(screen.queryByTestId('kanban-filter-empty')).not.toBeInTheDocument()
    expect(screen.getByTestId('board-result-count')).toHaveTextContent('Показано 1 из 1')
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('показывает все виды активных фильтров и снимает их по одному или вместе', async () => {
    const filteredView = {
      ...DEFAULT_BOARD_VIEW,
      search: 'needle',
      assignees: ['alexey'],
      types: ['story' as const],
      priorities: ['high' as const],
      labels: ['ui'],
      epics: ['epic-1'],
      onlyMine: true,
      flaggedOnly: true,
      recentOnly: true,
      columnAssignees: { c1: { assigneeIds: ['bob'], unassigned: true } }
    }
    renderBoard({
      currentUserId: 'alexey',
      members: [
        { username: 'alexey', role: 'member', active: true, addedAt: 1 },
        { username: 'bob', role: 'member', active: true, addedAt: 1 }
      ],
      view: filteredView,
      board: {
        columns: [board.columns[0]!],
        tasks: [
          task({ id: 'epic-1', type: 'epic', title: 'Платежи' }),
          task({ id: 'story-1', type: 'story', parentId: 'epic-1', title: 'needle', labels: ['ui'], priority: 'high', assignee: 'alexey', flagged: true, updatedAt: Date.now() })
        ]
      }
    })

    const strip = await screen.findByRole('region', { name: 'Активные фильтры' })
    const expected = [
      'Поиск: needle',
      'Исполнитель: alexey',
      'Тип: История',
      'Приоритет: Высокий',
      'Метка: ui',
      'Эпик: Платежи',
      'Только мои задачи',
      'С флагом',
      'Обновлены за сутки',
      'Колонка «To Do»: bob, без исполнителя'
    ]
    for (const label of expected) {
      expect(within(strip).getByRole('button', { name: `Удалить фильтр: ${label}` })).toBeInTheDocument()
    }

    await userEvent.click(within(strip).getByRole('button', { name: 'Удалить фильтр: Поиск: needle' }))
    expect(within(strip).queryByRole('button', { name: 'Удалить фильтр: Поиск: needle' })).not.toBeInTheDocument()
    expect(within(strip).getByRole('button', { name: 'Удалить фильтр: Исполнитель: alexey' })).toBeInTheDocument()

    await userEvent.click(within(strip).getByRole('button', { name: 'Удалить фильтр: Колонка «To Do»: bob, без исполнителя' }))
    expect(within(strip).queryByText(/Колонка «To Do»/)).not.toBeInTheDocument()

    await userEvent.click(within(strip).getByRole('button', { name: 'Сбросить все' }))
    expect(screen.queryByTestId('active-filters')).not.toBeInTheDocument()
  })

  it('прокручивает сфокусированную доску стрелками и переходит к краям по Home и End', () => {
    renderBoard({
      board: {
        columns: [
          { ...board.columns[0]!, id: 'c1', name: 'Первая', position: 1024 },
          { ...board.columns[0]!, id: 'c2', name: 'Вторая', position: 2048 },
          { ...board.columns[0]!, id: 'c3', name: 'Третья', position: 3072 }
        ],
        tasks: [task({ id: 't1', columnId: 'c1' })]
      }
    })
    const surface = screen.getByRole('region', { name: /Канбан-доска проекта «P1»/ })
    const column = screen.getAllByTestId('kanban-column')[0]!
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 300, height: 400, top: 0, right: 300, bottom: 400, left: 0, toJSON: () => ({})
    })
    Object.defineProperty(surface, 'scrollWidth', { configurable: true, value: 1400 })
    surface.focus()

    fireEvent.keyDown(surface, { key: 'ArrowRight' })
    expect(surface.scrollLeft).toBe(308)
    expect(screen.getByTestId('kanban-live')).toHaveTextContent('Колонка «Вторая», задач нет')
    expect(screen.getByRole('combobox', { name: 'Перейти к колонке' })).toHaveValue('c2')

    fireEvent.keyDown(surface, { key: 'ArrowLeft' })
    expect(surface.scrollLeft).toBe(0)
    fireEvent.keyDown(surface, { key: 'End' })
    expect(surface.scrollLeft).toBe(1400)
    expect(screen.getByRole('combobox', { name: 'Перейти к колонке' })).toHaveValue('c3')
    fireEvent.keyDown(surface, { key: 'Home' })
    expect(surface.scrollLeft).toBe(0)
    expect(screen.getByRole('combobox', { name: 'Перейти к колонке' })).toHaveValue('c1')
    expect(surface).toHaveAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight Home End')
  })

  it('переходит между видимыми колонками, фокусирует заголовок и обновляет список скрытых', async () => {
    renderBoard({
      board: {
        columns: [
          { ...board.columns[0]!, id: 'c1', name: 'Первая', position: 1024 },
          { ...board.columns[0]!, id: 'c2', name: 'Скрытая', hidden: true, position: 2048 },
          { ...board.columns[0]!, id: 'c3', name: 'Третья', position: 3072 }
        ],
        tasks: [task({ id: 't1', columnId: 'c3', title: 'В третьей' })]
      }
    })
    const select = screen.getByRole('combobox', { name: 'Перейти к колонке' })
    const previous = screen.getByRole('button', { name: 'Перейти к предыдущей колонке' })
    const next = screen.getByRole('button', { name: 'Перейти к следующей колонке' })
    expect(within(select).getAllByRole('option')).toHaveLength(2)
    expect(select).toHaveValue('c1')
    expect(previous).toBeDisabled()
    expect(next).toBeEnabled()

    const thirdHeader = document.querySelector<HTMLElement>('[data-column-nav-target="c3"]')!
    thirdHeader.scrollIntoView = vi.fn()
    await userEvent.click(next)
    expect(select).toHaveValue('c3')
    expect(thirdHeader.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest', inline: 'start' })
    expect(document.activeElement).toBe(thirdHeader)
    expect(screen.getByTestId('kanban-live')).toHaveTextContent('Колонка «Третья», 1 задача')
    expect(next).toBeDisabled()

    await userEvent.click(previous)
    expect(select).toHaveValue('c1')
    await userEvent.click(screen.getByRole('checkbox', { name: /скрытые/ }))
    expect(within(select).getAllByRole('option')).toHaveLength(3)
    expect(select).toHaveValue('c1')

    const hiddenHeader = document.querySelector<HTMLElement>('[data-column-nav-target="c2"]')!
    hiddenHeader.scrollIntoView = vi.fn()
    await userEvent.selectOptions(select, 'c2')
    expect(document.activeElement).toBe(hiddenHeader)
    expect(screen.getByTestId('kanban-live')).toHaveTextContent('Колонка «Скрытая», задач нет, скрыта')
  })

  it('использует тот же навигатор в раскладке со свимлейнами', async () => {
    renderBoard({
      defaultSwimlane: 'assignee',
      members: [{ username: 'alexey', role: 'member', active: true, addedAt: 1 }],
      board: {
        columns: [
          { ...board.columns[0]!, id: 'c1', name: 'Первая', position: 1024 },
          { ...board.columns[0]!, id: 'c2', name: 'Вторая', position: 2048 }
        ],
        tasks: [task({ id: 't1', columnId: 'c2', assignee: 'alexey' })]
      }
    })
    const secondHeader = document.querySelector<HTMLElement>('[data-column-nav-target="c2"]')!
    secondHeader.scrollIntoView = vi.fn()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Перейти к колонке' }), 'c2')

    expect(document.activeElement).toBe(secondHeader)
    expect(screen.getByTestId('kanban-live')).toHaveTextContent('Колонка «Вторая», 1 задача')
  })

  it('стрелка использует полный порядок, включая скрытую колонку, и позицию в конце цели', async () => {
    const onMoveTask = vi.fn(async () => {})
    const orderedBoard: Board = {
      columns: [
        { ...board.columns[0]!, id: 'c1', name: 'Ready', semanticType: 'ready', hidden: false, position: 1024 },
        { ...board.columns[0]!, id: 'c2', name: 'Скрытая обязательная', semanticType: 'development', hidden: true, position: 2048 },
        { ...board.columns[0]!, id: 'c3', name: 'Component QA', semanticType: 'component_qa', hidden: false, position: 3072 }
      ],
      tasks: [
        task({ id: 'moving', columnId: 'c1', title: 'Двигаем', position: 10 }),
        task({ id: 'target-first', columnId: 'c2', title: 'Первый', position: 100 }),
        task({ id: 'target-last', columnId: 'c2', title: 'Последний', position: 900 })
      ]
    }
    renderBoard({ board: orderedBoard, onMoveTask })

    const card = screen.getByText('Двигаем').closest('[data-testid="task-card"]')!
    const right = within(card as HTMLElement).getByRole('button', { name: /вправо.*Скрытая обязательная/ })
    expect(right).toHaveAttribute('title', expect.stringContaining('Скрытая обязательная'))
    await userEvent.click(right)

    expect(onMoveTask).toHaveBeenCalledWith('moving', 'c2', 'target-last', null)
    expect(screen.getByTestId('kanban-live')).toHaveTextContent('Скрытая обязательная')
  })

  it('не объявляет успех при серверном или сетевом отказе', async () => {
    const rejectedBoard: Board = {
      columns: [
        { ...board.columns[0]!, id: 'c1', name: 'Ready', semanticType: 'ready', hidden: false },
        { ...board.columns[0]!, id: 'c2', name: 'Development', semanticType: 'development', hidden: false }
      ],
      tasks: [task({ id: 'moving', columnId: 'c1', title: 'Остаётся' })]
    }
    renderBoard({ board: rejectedBoard, onMoveTask: vi.fn(async () => false) })

    const card = screen.getByText('Остаётся').closest('[data-testid="task-card"]')!
    await userEvent.click(within(card as HTMLElement).getByRole('button', { name: /вправо.*Development/ }))

    expect(screen.getByTestId('kanban-live')).toBeEmptyDOMElement()
    expect(screen.getByText('Остаётся').closest('[data-testid="task-card"]')).toHaveAttribute('data-task-id', 'moving')
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
      id: `run-${taskId}`, taskId, status: 'running', error: null,
      slotProgress: { done: 1, total: 4, phase: 'Модель работает' },
      durationMs: null, modelActive: false, awaitingInput: false, ...over
    })
    renderBoard({
      board: { columns: [{ ...board.columns[0]!, id: 'development', name: 'Development', semanticType: 'development' }], tasks: [task({ id: 't1', columnId: 'development', title: 'A' }), task({ id: 't2', columnId: 'development', title: 'B' }), task({ id: 't3', columnId: 'development', title: 'C' })] },
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

describe('KanbanBoard — очередь «Улучшения»', () => {
  const improvement = {
    id: 'imp-1', taskId: 't1', projectId: 'p1', runId: 'run-1', stepId: 'step-1', source: 'development' as const,
    status: 'new' as const, title: 'Стабилизировать: npm test', description: '## Проблема\n\nШаг падал.',
    acceptanceCriteria: 'Шаг проходит с первой попытки.\nПовторный авторан подтверждает исправление.',
    createdTaskId: null, fingerprint: 'fp', evidence: ['Статус шага: failed'], files: ['apps/server/src/turns.ts'],
    occurrences: 2, suggestedAction: 'create_chatai_task' as const, isNew: true, createdAt: 1, updatedAt: 1,
    taskTitle: 'A', taskSeq: 1, taskColumnId: 'c1'
  }
  const created = { created: true, preparationStarted: false, preparationError: null, task: task({ id: 't-new', title: 'Стабилизировать: npm test', sourceTaskId: 't1' }), improvement: { ...improvement, status: 'implemented' as const, createdTaskId: 't-new', isNew: false } }
  afterEach(() => { window.ci = undefined })

  function withCi(over: Partial<NonNullable<typeof window.ci>> = {}): NonNullable<typeof window.ci> {
    const ci = createFakeCi()
    ci.listProjectImprovements = vi.fn(async () => [improvement])
    ci.createTaskFromImprovement = vi.fn(async () => created)
    ci.deleteImprovement = vi.fn(async () => ({ ok: true }))
    Object.assign(ci, over)
    window.ci = ci
    return ci
  }

  /** Доска очередь не грузит: список приезжает по нажатию «Показать». */
  async function openImprovements(): Promise<void> {
    await userEvent.click(await screen.findByTestId('kanban-improvements-open'))
  }

  it('не ходит за очередью, пока её не попросили, и грузит по нажатию', async () => {
    const ci = withCi()
    renderBoard()
    await screen.findByTestId('kanban-improvements-column')
    // Открытие доски — это про задачи; очередь предложений смотрят отдельно.
    expect(ci.listProjectImprovements).not.toHaveBeenCalled()
    expect(screen.queryByTestId('improvement-card')).not.toBeInTheDocument()

    await openImprovements()
    await waitFor(() => expect(ci.listProjectImprovements).toHaveBeenCalledWith('p1'))
    expect(await screen.findByTestId('improvement-card')).toBeInTheDocument()
  })

  it('рисует карточку на каждое предложение и открывает его подробности', async () => {
    withCi()
    renderBoard()
    const column = await screen.findByTestId('kanban-improvements-column')
    await openImprovements()
    const card = await within(column).findByTestId('improvement-card')
    expect(card).toHaveTextContent('Стабилизировать: npm test')
    expect(card).toHaveTextContent('из P1-1 · A')
    await userEvent.click(card)
    const modal = await screen.findByTestId('improvement-modal')
    expect(within(modal).getByTestId('improvement-source-task')).toHaveTextContent('P1-1 · A')
    expect(within(modal).getByTestId('improvement-criteria')).toHaveTextContent('Шаг проходит с первой попытки.')
    expect(within(modal).getByTestId('improvement-files')).toHaveTextContent('apps/server/src/turns.ts')
    expect(screen.getByTestId('improvement-modal-actions')).toBeInTheDocument()
  })

  it('«Создать задачу» создаёт без выбора колонки и открывает новую карточку; «Создать и подготовить» просит подготовку', async () => {
    const ci = withCi()
    const onOpenTaskChange = vi.fn()
    renderBoard({ openTaskId: null, onOpenTaskChange })
    await openImprovements()
    await userEvent.click(await screen.findByTestId('improvement-card'))
    await userEvent.click(await screen.findByTestId('improvement-create'))
    await waitFor(() => expect(ci.createTaskFromImprovement).toHaveBeenCalledWith('imp-1', { startPreparation: false }))
    expect(onOpenTaskChange).toHaveBeenCalledWith('t-new', undefined)
    await waitFor(() => expect(screen.queryByTestId('improvement-modal')).not.toBeInTheDocument())

    ci.createTaskFromImprovement = vi.fn(async () => ({ ...created, preparationStarted: true }))
    await userEvent.click(await screen.findByTestId('improvement-card'))
    await userEvent.click(await screen.findByTestId('improvement-create-prepare'))
    await waitFor(() => expect(ci.createTaskFromImprovement).toHaveBeenCalledWith('imp-1', { startPreparation: true }))
    expect(onOpenTaskChange).toHaveBeenLastCalledWith('t-new', 'preparation')
  })

  it('ошибка подготовки не скрывает созданную задачу: окно остаётся с текстом ошибки', async () => {
    withCi({ createTaskFromImprovement: vi.fn(async () => ({ ...created, preparationError: 'Не настроена колонка preparation' })) })
    renderBoard()
    await openImprovements()
    await userEvent.click(await screen.findByTestId('improvement-card'))
    await userEvent.click(await screen.findByTestId('improvement-create-prepare'))
    expect(await screen.findByTestId('improvement-modal-error')).toHaveTextContent('Не настроена колонка preparation')
  })

  it('«Отменить» удаляет предложение только со второго нажатия и убирает карточку', async () => {
    const ci = withCi()
    renderBoard()
    await openImprovements()
    await userEvent.click(await screen.findByTestId('improvement-card'))
    const remove = await screen.findByTestId('improvement-delete')
    expect(remove).toHaveTextContent('Отменить')
    await userEvent.click(remove)
    expect(ci.deleteImprovement).not.toHaveBeenCalled()
    expect(remove).toHaveTextContent('Точно удалить предложение?')
    await userEvent.click(remove)
    await waitFor(() => expect(ci.deleteImprovement).toHaveBeenCalledWith('imp-1'))
    await waitFor(() => expect(screen.queryByTestId('improvement-modal')).not.toBeInTheDocument())
    // Колонка остаётся на месте (её список грузится по кнопке), но пустеет.
    expect(screen.queryByTestId('improvement-card')).not.toBeInTheDocument()
  })
})

describe('KanbanBoard — догрузка полной задачи', () => {
  beforeEach(() => { window.ci = undefined })

  it('перерендер хоста не перезапрашивает открытую карточку и не мигает описанием', async () => {
    // `loadFullTask` хост передаёт инлайновой стрелкой, и её идентичность
    // менялась на каждом рендере приложения — а рендерит его каждый WS-кадр
    // активного рана. Эффект перезапускался, обнулял загруженную задачу и снова
    // дёргал `GET tasks/:id`.
    const full = task({ id: 't1', title: 'A', description: 'Полное описание с сервера' })
    const calls: string[] = []
    const props: KanbanBoardProps = {
      projectName: 'P1', board, loading: false, members: [],
      onCreateColumn: vi.fn(), onUpdateColumn: vi.fn(), onSetColumnHidden: vi.fn(),
      onReorderColumns: vi.fn(), onDeleteColumn: vi.fn(), onCreateTask: vi.fn(),
      onUpdateTask: vi.fn(), onMoveTask: vi.fn(), onDeleteTask: vi.fn(),
      openTaskId: 't1',
      loadFullTask: async (id) => { calls.push(id); return full }
    }
    const { rerender } = render(<KanbanBoard {...props} />)
    expect(await screen.findByTestId('task-desc-view')).toHaveTextContent('Полное описание с сервера')
    expect(calls).toEqual(['t1'])

    // Новая стрелка на каждом рендере — ровно то, что делает хост.
    rerender(<KanbanBoard {...props} loadFullTask={async (id) => { calls.push(id); return full }} />)
    rerender(<KanbanBoard {...props} loadFullTask={async (id) => { calls.push(id); return full }} />)

    expect(calls).toEqual(['t1'])
    expect(screen.getByTestId('task-desc-view')).toHaveTextContent('Полное описание с сервера')
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
    const surface = screen.getByTestId('kanban-board')
    const bodies = document.querySelectorAll<HTMLElement>('[data-drop-body]')
    surface.scrollLeft = 120
    surface.scrollTop = 75
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
    expect(surface.scrollLeft).toBe(120)
    expect(surface.scrollTop).toBe(75)
    expect(bodies[0]!.scrollTop).toBe(0)
    expect(bodies[1]!.scrollTop).toBe(0)
  })

  it('мышь: у нижнего края прокручивается общая поверхность, а не тела колонок', () => {
    vi.useFakeTimers()
    try {
      renderBoard({ board: dndBoard })
      layout()
      const surface = screen.getByTestId('kanban-board')
      const bodies = document.querySelectorAll<HTMLElement>('[data-drop-body]')
      surface.scrollTop = 100
      const card = screen.getAllByTestId('task-card')[0]!

      down(card, 40, 130)
      move(40, 590)
      act(() => vi.advanceTimersByTime(20))

      expect(surface.scrollTop).toBeGreaterThan(100)
      expect(bodies[0]!.scrollTop).toBe(0)
      expect(bodies[1]!.scrollTop).toBe(0)
      up(40, 590)
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

      // Палец поехал раньше удержания — это общий скролл доски, а не перенос.
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

  it('перенос колонки автоскроллит только горизонтальную ось доски', () => {
    vi.useFakeTimers()
    try {
      renderBoard({ board: dndBoard })
      layout()
      const surface = screen.getByTestId('kanban-board')
      const bodies = document.querySelectorAll<HTMLElement>('[data-drop-body]')
      surface.scrollLeft = 100
      surface.scrollTop = 25

      down(document.querySelectorAll<HTMLElement>('.jcol-head')[0]!, 40, 20)
      move(890, 590)
      act(() => vi.advanceTimersByTime(20))

      expect(surface.scrollLeft).toBeGreaterThan(100)
      expect(surface.scrollTop).toBe(25)
      expect(bodies[0]!.scrollTop).toBe(0)
      expect(bodies[1]!.scrollTop).toBe(0)
      up(890, 590)
    } finally {
      vi.useRealTimers()
    }
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

describe('KanbanBoard — фильтры исполнителей', () => {
  beforeEach(() => localStorage.clear())

  const filteredBoard: Board = {
    columns: [
      { ...board.columns[0]!, id: 'c1', name: 'To Do' },
      { ...board.columns[0]!, id: 'c2', name: 'Doing', position: 2048 }
    ],
    tasks: [
      task({ id: 'mine', columnId: 'c1', title: 'Моя', assignee: 'alice', position: 1 }),
      task({ id: 'other', columnId: 'c1', title: 'Чужая', assignee: 'bob', position: 2 }),
      task({ id: 'unassigned', columnId: 'c2', title: 'Без исполнителя', assignee: null, position: 1 })
    ]
  }

  it('глобальный чекбокс фильтрует по устойчивому id и скрывает без исполнителя', async () => {
    renderBoard({ board: filteredBoard, currentUserId: 'alice', currentUser: 'Отображаемое имя', members: [{ username: 'alice', role: 'member', addedAt: 1 }, { username: 'bob', role: 'member', addedAt: 1 }] })
    await userEvent.click(screen.getByRole('checkbox', { name: 'Показывать только мои задачи' }))
    expect(screen.getByText('Моя')).toBeInTheDocument()
    expect(screen.queryByText('Чужая')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('task-card').map((card) => card.textContent).join(' ')).not.toContain('Без исполнителя')
  })

  // Пустой экран колонки под фильтром обещал кнопку сброса, но она не
  // рендерилась: `EmptyState` принимает `actionLabel`/`onAction`, а сюда
  // передавали несуществующий `action` — проверка лишних свойств у спреда не
  // работает, и tsc молчал.
  it('под фильтром пустая колонка даёт кнопку сброса, и она работает', async () => {
    renderBoard({ board: filteredBoard, currentUserId: 'alice', currentUser: 'Отображаемое имя', members: [{ username: 'alice', role: 'member', addedAt: 1 }, { username: 'bob', role: 'member', addedAt: 1 }] })
    await userEvent.click(screen.getByRole('checkbox', { name: 'Показывать только мои задачи' }))

    // Пусто из-за фильтра доски, а не колонки — значит и сброс предлагается
    // тот, который действительно вернёт задачи.
    const empty = screen.getByText('Нет задач под фильтром').closest('.vc-state')!
    const reset = within(empty as HTMLElement).getByRole('button', { name: 'Сбросить фильтры доски' })
    await userEvent.click(reset)
    expect(screen.getAllByTestId('task-card').some((card) => card.textContent?.includes('Без исполнителя'))).toBe(true)
  })

  it('выбирает нескольких исполнителей по ИЛИ и показывает badge', async () => {
    renderBoard({ board: filteredBoard, currentUserId: 'filter-user', members: [{ username: 'alice', role: 'member', addedAt: 1 }, { username: 'bob', role: 'member', addedAt: 1 }] })
    const button = screen.getByRole('button', { name: /Фильтр исполнителей колонки «To Do»/ })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const popover = screen.getByRole('dialog', { name: 'Фильтр исполнителей колонки «To Do»' })
    await userEvent.click(within(popover).getByRole('checkbox', { name: 'alice' }))
    expect(screen.getByText('Моя')).toBeInTheDocument()
    expect(screen.queryByText('Чужая')).not.toBeInTheDocument()
    await userEvent.click(within(popover).getByRole('checkbox', { name: 'bob' }))
    expect(screen.getByText('Моя')).toBeInTheDocument()
    expect(screen.getByText('Чужая')).toBeInTheDocument()
    expect(button).toHaveTextContent('2')
    expect(button).toHaveAttribute('title', 'alice, bob')
  })

  it('комбинирует пользователя с задачами без исполнителя и снимает отдельное условие', async () => {
    const sameColumn = { ...filteredBoard, tasks: filteredBoard.tasks.map((item) => ({ ...item, columnId: 'c1' })) }
    renderBoard({ board: sameColumn, currentUserId: 'filter-user', members: [{ username: 'alice', role: 'member', addedAt: 1 }, { username: 'bob', role: 'member', addedAt: 1 }] })
    await userEvent.click(screen.getByRole('button', { name: /Фильтр исполнителей колонки «To Do»/ }))
    const popover = screen.getByRole('dialog')
    await userEvent.click(within(popover).getByRole('checkbox', { name: 'alice' }))
    await userEvent.click(within(popover).getByRole('checkbox', { name: 'Без исполнителя' }))
    expect(screen.getByText('Моя')).toBeInTheDocument()
    expect(screen.getAllByTestId('task-card').map((card) => card.textContent).join(' ')).toContain('Без исполнителя')
    expect(screen.queryByText('Чужая')).not.toBeInTheDocument()
    await userEvent.click(within(popover).getByRole('button', { name: /alice, снять выбор/ }))
    expect(screen.queryByText('Моя')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('task-card').map((card) => card.textContent).join(' ')).toContain('Без исполнителя')
  })

  it('поддерживает выбрать всех, сброс и Escape без изменения выбора', async () => {
    renderBoard({ board: filteredBoard, currentUserId: 'filter-user', members: [{ username: 'alice', role: 'member', addedAt: 1 }, { username: 'bob', role: 'member', addedAt: 1 }] })
    const button = screen.getByRole('button', { name: /Фильтр исполнителей колонки «To Do»/ })
    await userEvent.click(button)
    await userEvent.click(screen.getByRole('button', { name: 'Выбрать всех' }))
    expect(button).toHaveTextContent('3')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(button).toHaveTextContent('3')
    await userEvent.click(button)
    await userEvent.click(screen.getByRole('button', { name: 'Сбросить выбор' }))
    expect(button).not.toHaveTextContent('3')
    expect(screen.getByRole('checkbox', { name: 'Все исполнители' })).toBeChecked()
  })

  it('общий режим временно приоритетен, а локальный выбор сохраняется и восстанавливается', async () => {
    renderBoard({ board: filteredBoard, currentUserId: 'alice', members: [{ username: 'alice', role: 'member', addedAt: 1 }, { username: 'bob', role: 'member', addedAt: 1 }] })
    const button = screen.getByRole('button', { name: /Фильтр исполнителей колонки «To Do»/ })
    await userEvent.click(button)
    await userEvent.click(screen.getByRole('checkbox', { name: 'bob' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Показывать только мои задачи' }))
    expect(screen.getByText('Моя')).toBeInTheDocument()
    expect(screen.queryByText('Чужая')).not.toBeInTheDocument()
    await userEvent.click(button)
    expect(screen.getByText(/Локальный выбор сохранён/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Показывать только мои задачи' }))
    expect(screen.queryByText('Моя')).not.toBeInTheDocument()
    expect(screen.getByText('Чужая')).toBeInTheDocument()
  })

  // Вид доски раньше жил только в памяти: после перезагрузки (а на проде — после
  // каждого деплоя) свимлейны и «скрытые» возвращались к исходным.
  it('свимлейны и показ скрытых колонок переживают перезагрузку', async () => {
    const props = { board: filteredBoard, currentUserId: 'view-user', members: [{ username: 'alice', role: 'member' as const, addedAt: 1 }] }
    const view = render(<KanbanBoardHarness {...props} />)
    await userEvent.selectOptions(screen.getByLabelText('Свимлейны'), 'assignee')
    await userEvent.click(screen.getByRole('checkbox', { name: 'скрытые' }))
    await waitFor(() => expect(localStorage.getItem('voicechat.kanban.filters.v3.view-user.p1')).toContain('"swimlane":"assignee"'))
    view.unmount()

    render(<KanbanBoardHarness {...props} />)

    await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>('Свимлейны').value).toBe('assignee'))
    expect(screen.getByRole('checkbox', { name: 'скрытые' })).toBeChecked()
  })

  // Вид доски переехал на сервер: доска, настроенная на одном компьютере,
  // обязана открыться такой же на другом — браузер больше не источник истины.
  it('серверный вид применяется, а изменения уходят наверх патчем', async () => {
    const onViewChange = vi.fn()
    const props = { board: filteredBoard, currentUserId: 'view-server', members: [{ username: 'alice', role: 'member' as const, addedAt: 1 }] }
    render(<KanbanBoardHarness {...props} view={{ ...DEFAULT_BOARD_VIEW, swimlane: 'assignee', onlyMine: true }} onViewChange={onViewChange} />)

    await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>('Свимлейны').value).toBe('assignee'))
    expect(screen.getByRole('checkbox', { name: 'Показывать только мои задачи' })).toBeChecked()

    await userEvent.click(screen.getByRole('checkbox', { name: 'скрытые' }))

    await waitFor(() => expect(onViewChange).toHaveBeenCalled())
    expect(onViewChange.mock.calls.at(-1)?.[0]).toMatchObject({ showHidden: true, swimlane: 'assignee', onlyMine: true })
    // В браузере вид больше не оседает: источник — сервер.
    expect(localStorage.getItem('voicechat.kanban.filters.v3.view-server.p1')).toBeNull()
  })

  it('прежний вид из браузера переносится на сервер один раз', async () => {
    const onViewChange = vi.fn()
    const props = { board: filteredBoard, currentUserId: 'migrate-user', members: [{ username: 'alice', role: 'member' as const, addedAt: 1 }] }
    const key = 'voicechat.kanban.filters.v3.migrate-user.p1'
    localStorage.setItem(key, JSON.stringify({ onlyMine: true, swimlane: 'epic', showHidden: true }))

    render(<KanbanBoardHarness {...props} view={{ ...DEFAULT_BOARD_VIEW }} onViewChange={onViewChange} />)

    await waitFor(() => expect(onViewChange).toHaveBeenCalled())
    expect(onViewChange.mock.calls[0]?.[0]).toMatchObject({ onlyMine: true, swimlane: 'epic', showHidden: true })
    expect(localStorage.getItem(key)).toBeNull() // перенесли — и убрали, чтобы не переносить снова
  })

  // У людей с настроенной доской запись уже лежит под старым ключом (с именем
  // проекта): без переноса переход на устойчивый ключ выглядел бы как сброс.
  it('переносит вид, сохранённый под прежним ключом с именем проекта', async () => {
    const props = { board: filteredBoard, currentUserId: 'legacy-user', members: [{ username: 'alice', role: 'member' as const, addedAt: 1 }] }
    const legacyKey = 'voicechat.kanban.filters.v3.legacy-user.' + encodeURIComponent('Проект')
    localStorage.setItem(legacyKey, JSON.stringify({ onlyMine: true, swimlane: 'epic' }))

    render(<KanbanBoardHarness {...props} projectName="Проект" />)

    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Показывать только мои задачи' })).toBeChecked())
    expect(localStorage.getItem('voicechat.kanban.filters.v3.legacy-user.p1')).toContain('"swimlane":"epic"')
    expect(localStorage.getItem(legacyKey)).toBeNull()
  })

  it('восстанавливает массив после перезагрузки и реагирует на обновление назначения', async () => {
    const members = [{ username: 'alice', role: 'member' as const, addedAt: 1 }, { username: 'bob', role: 'member' as const, addedAt: 1 }]
    const props = { board: filteredBoard, currentUserId: 'persist-user', members }
    const view = render(<KanbanBoardHarness {...props} />)
    await userEvent.click(screen.getByRole('button', { name: /Фильтр исполнителей колонки «To Do»/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'alice' }))
    await waitFor(() => expect(localStorage.getItem('voicechat.kanban.filters.v3.persist-user.p1')).toContain('assigneeIds'))
    view.unmount()
    const restored = render(<KanbanBoardHarness {...props} />)
    await waitFor(() => expect(screen.getByText('Моя')).toBeInTheDocument())
    expect(screen.queryByText('Чужая')).not.toBeInTheDocument()
    const updatedBoard = { ...filteredBoard, tasks: filteredBoard.tasks.map((item) => item.id === 'other' ? { ...item, assignee: 'alice' } : item) }
    restored.rerender(<KanbanBoardHarness {...props} board={updatedBoard} />)
    expect(await screen.findByText('Чужая')).toBeInTheDocument()
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

/** Ширина экрана: доска смотрит на matchMedia, дефолт тестов — десктоп. */
function setMobileViewport(mobile: boolean): void {
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

describe('KanbanBoard — фильтры на телефоне', () => {
  afterEach(() => setMobileViewport(false))

  it('на широком экране фильтры развёрнуты, на телефоне свёрнуты в один пункт', async () => {
    renderBoard()
    expect(screen.getByTestId('board-filters')).toBeInTheDocument()
    expect(screen.queryByTestId('board-filters-shell')).not.toBeInTheDocument()
    cleanup()

    setMobileViewport(true)
    renderBoard()
    const shell = screen.getByTestId('board-filters-shell')
    // Развёрнутыми фильтры занимали пол-экрана до первой карточки.
    expect(shell).not.toHaveAttribute('open')
    expect(within(shell).getByText('Фильтры')).toBeInTheDocument()
  })

  it('число активных фильтров видно в свёрнутом виде', async () => {
    setMobileViewport(true)
    renderBoard()
    const shell = screen.getByTestId('board-filters-shell') as HTMLDetailsElement
    // jsdom не раскрывает details по клику на summary — открываем напрямую.
    shell.open = true
    const [firstFilter] = within(shell).getAllByRole('checkbox')
    await userEvent.click(firstFilter)
    // Иначе непонятно, почему на доске мало карточек.
    expect(within(shell.querySelector('summary')!).getByText('1')).toBeInTheDocument()
  })

  it('оставляет активные фильтры видимыми снаружи свёрнутой панели', async () => {
    setMobileViewport(true)
    renderBoard({ currentUserId: 'mobile-user', view: { ...DEFAULT_BOARD_VIEW, search: 'A' } })
    const shell = screen.getByTestId('board-filters-shell')
    const strip = await screen.findByTestId('active-filters')

    expect(shell).not.toHaveAttribute('open')
    expect(shell).not.toContainElement(strip)
    expect(within(strip).getByRole('button', { name: 'Удалить фильтр: Поиск: A' })).toBeInTheDocument()
  })
})

describe('KanbanBoard — догрузка полной карточки', () => {
  it('ререндер с новой функцией loadFullTask не перезапрашивает задачу', async () => {
    const calls: string[] = []
    const view = (): JSX.Element => (
      // Как в App.tsx: колбэк — inline-стрелка, новая на каждый рендер родителя.
      <KanbanBoard
        projectName="P1" board={board} loading={false} members={[]}
        openTaskId="t1"
        loadFullTask={async (taskId) => { calls.push(taskId); return task({ id: taskId, description: 'Полное описание' }) }}
        onCreateColumn={vi.fn()} onUpdateColumn={vi.fn()} onSetColumnHidden={vi.fn()} onReorderColumns={vi.fn()}
        onDeleteColumn={vi.fn()} onCreateTask={vi.fn()} onUpdateTask={vi.fn()} onMoveTask={vi.fn()} onDeleteTask={vi.fn()}
      />
    )
    const { rerender } = render(view())
    await waitFor(() => expect(calls).toEqual(['t1']))

    rerender(view())
    rerender(view())
    await act(async () => { await Promise.resolve() })

    expect(calls).toEqual(['t1'])
    // Описание не пропадает от повторных загрузок — карточка не мигает.
    expect(screen.getByTestId('task-desc-view')).toHaveTextContent('Полное описание')
  })
})

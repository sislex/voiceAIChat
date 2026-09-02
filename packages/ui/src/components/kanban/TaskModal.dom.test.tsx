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
import { ALL_PROJECT_FEATURES, NO_PROJECT_FEATURES } from '@shared/projectTypes'

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


/** Открыть «Ход выполнения»: отчёты по рану и БЗ грузятся с первого её показа. */
const openProgress = async (): Promise<void> => {
  await userEvent.click(screen.getByRole('tab', { name: 'Ход выполнения' }))
}
describe('TaskModal — синхронизация полных данных задачи', () => {
  it('подставляет поздно загруженные описание и критерии для того же task.id', () => {
    const { rerender } = render(<TaskModal {...props()} />)

    rerender(<TaskModal {...props({
      task: mkTask({ description: 'Описание с сервера', acceptanceCriteria: 'Первый критерий' })
    })} />)

    expect(screen.getByTestId('task-desc-view')).toHaveTextContent('Описание с сервера')
    expect(screen.getByTestId('task-criteria-view')).toHaveTextContent('Первый критерий')
  })

  it('не перезаписывает черновик изменённого поля и независимо синхронизирует второе', async () => {
    const { rerender } = render(<TaskModal {...props()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Редактировать описание' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Описание задачи' }), { target: { value: 'Локальный черновик' } })

    rerender(<TaskModal {...props({
      task: mkTask({ description: 'Позднее описание', acceptanceCriteria: 'Поздний критерий' })
    })} />)

    expect(screen.getByRole('textbox', { name: 'Описание задачи' })).toHaveValue('Локальный черновик')
    expect(screen.getByTestId('task-criteria-view')).toHaveTextContent('Поздний критерий')
  })

  it('сохраняет черновик критериев и независимо синхронизирует описание', async () => {
    const { rerender } = render(<TaskModal {...props()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Редактировать критерии приёмки' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Критерии приёмки' }), { target: { value: 'Локальный критерий' } })

    rerender(<TaskModal {...props({
      task: mkTask({ description: 'Позднее описание', acceptanceCriteria: 'Поздний критерий' })
    })} />)

    expect(screen.getByRole('textbox', { name: 'Критерии приёмки' })).toHaveValue('1. Локальный критерий')
    expect(screen.getByTestId('task-desc-view')).toHaveTextContent('Позднее описание')
  })

  it('сохраняет оба поля через onUpdate и показывает серверные значения после повторного открытия', async () => {
    const onUpdate = vi.fn()
    const view = render(<TaskModal {...props({ onUpdate })} />)

    await userEvent.click(screen.getByRole('button', { name: 'Редактировать описание' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Описание задачи' }), { target: { value: 'Сохранённое описание' } })
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await userEvent.click(screen.getByRole('button', { name: 'Редактировать критерии приёмки' }))
    const criteriaField = screen.getByRole('textbox', { name: 'Критерии приёмки' })
    fireEvent.change(criteriaField, { target: { value: 'Сохранённый критерий' } })
    fireEvent.blur(criteriaField)

    expect(onUpdate).toHaveBeenCalledWith('t1', { description: 'Сохранённое описание' })
    expect(onUpdate).toHaveBeenCalledWith('t1', { acceptanceCriteria: '1. Сохранённый критерий' })

    view.unmount()
    render(<TaskModal {...props({
      task: mkTask({ description: 'Сохранённое описание', acceptanceCriteria: '1. Сохранённый критерий' })
    })} />)

    expect(screen.getByTestId('task-desc-view')).toHaveTextContent('Сохранённое описание')
    expect(screen.getByTestId('task-criteria-view')).toHaveTextContent('Сохранённый критерий')
  })

  it('полностью переинициализирует поля и режимы редактирования при смене task.id', async () => {
    const { rerender } = render(<TaskModal {...props()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Редактировать описание' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Описание задачи' }), { target: { value: 'Черновик старой задачи' } })
    await userEvent.click(screen.getByRole('button', { name: 'Редактировать критерии приёмки' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Критерии приёмки' }), { target: { value: 'Черновик критерия' } })

    rerender(<TaskModal {...props({
      task: mkTask({ id: 't2', title: 'Задача B', description: 'Описание B', acceptanceCriteria: 'Критерий B' })
    })} />)

    expect(screen.queryByRole('textbox', { name: 'Описание задачи' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Критерии приёмки' })).not.toBeInTheDocument()
    expect(screen.getByTestId('task-desc-view')).toHaveTextContent('Описание B')
    expect(screen.getByTestId('task-criteria-view')).toHaveTextContent('Критерий B')
  })
})

function mkSummary(over: Partial<CiRunSummary> = {}): CiRunSummary {
  return { id: 'run-1', taskId: 't1', status: 'running', error: null, slotProgress: { done: 1, total: 4, phase: 'Модель работает' }, durationMs: null, modelActive: true, awaitingInput: false, ...over }
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
    // Улучшения появляются только после рана — карточка без единого рана их и
    // не запрашивает, поэтому сводка рана здесь обязательна.
    render(<TaskModal {...props({ ciSummary: mkSummary() })} />)
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
    render(<TaskModal {...props({ ciSummary: mkSummary() })} />)
    await userEvent.click(screen.getByRole('tab', { name: /Улучшения/ }))
    expect(await screen.findAllByRole('button', { name: 'Принять' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Отклонить' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Реализовано' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Создать задачу ChatAI' })).toHaveLength(2)
  })

  // Строка улучшения печатала сырые `new` и `development` — в русской карточке
  // это читалось как отладочный вывод, а не как состояние ленты.
  it('подписывает статус и источник по-русски и метит их тоном ленты', async () => {
    const ci = createFakeCi()
    ci.listTaskImprovements = vi.fn(async () => [improvement])
    window.ci = ci
    render(<TaskModal {...props({ ciSummary: mkSummary() })} />)
    await userEvent.click(screen.getByRole('tab', { name: /Улучшения/ }))
    const row = (await screen.findByText('Улучшить ретраи')).closest('details')!
    expect(within(row).getByText('Новое')).toHaveClass('vc-feed-status')
    expect(within(row).getByText(/Разработка/)).toBeInTheDocument()
    expect(row.querySelector('.vc-feed-dot--progress')).not.toBeNull()
    expect(within(row).queryByText(/development/)).not.toBeInTheDocument()
  })

  it('пустой список улучшений показывает общий пустой экран карточки', async () => {
    const ci = createFakeCi()
    ci.listTaskImprovements = vi.fn(async () => [])
    window.ci = ci
    render(<TaskModal {...props({ ciSummary: mkSummary() })} />)
    await userEvent.click(screen.getByRole('tab', { name: /Улучшения/ }))
    const empty = await screen.findByTestId('task-improvements-empty')
    expect(empty).toHaveClass('vc-state--empty')
    expect(within(empty).getByText('Улучшений пока нет')).toBeInTheDocument()
  })
})

describe('TaskModal — черновик новой задачи', () => {
  beforeEach(() => { window.ci = createFakeCi() })

  // Поле названия стояло пустым и без подписи: сверху карточки был просто
  // отступ, и куда вводить название — непонятно.
  it('подписывает поле названия и подсказывает пример', () => {
    render(<TaskModal {...props({ draft: true, task: mkTask({ title: '' }) })} />)
    const title = screen.getByRole('textbox', { name: 'Заголовок задачи' })

    expect(title).toHaveAttribute('placeholder')
    expect(title.closest('label')).toHaveClass('jmodal-title-field')
    expect(within(title.closest('label')!).getByText('Название')).toBeInTheDocument()
  })

  it('не показывает панель CI-рана: задачи ещё нет', () => {
    render(<TaskModal {...props({ draft: true, onStartCi: vi.fn(), ciSummary: mkSummary() })} />)
    expect(screen.queryByTestId('task-modal-ci')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'В очередь' })).not.toBeInTheDocument()
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

describe('TaskModal — что грузится при открытии карточки', () => {
  // Открытая карточка тратила 3–4 запроса до того, как пользователь что-либо
  // открыл: улучшения, использование БЗ, отчёт по рану и панели QA. Всё это
  // живёт на вкладках, которые могут не открываться вовсе.
  const spies = (): { ci: NonNullable<typeof window.ci>; calls: () => Record<string, number> } => {
    const ci = createFakeCi()
    ci.listTaskImprovements = vi.fn(async () => [])
    // Содержимое отчётов здесь неважно — считаем только число обращений.
    ci.getTaskKbUsage = vi.fn(async () => null as unknown as KbTaskUsageReport)
    ci.getTaskReport = vi.fn(async () => null as unknown as CiTaskReport)
    window.ci = ci as typeof window.ci
    return {
      ci: ci as NonNullable<typeof window.ci>,
      calls: () => ({
        improvements: (ci.listTaskImprovements as ReturnType<typeof vi.fn>).mock.calls.length,
        kb: (ci.getTaskKbUsage as ReturnType<typeof vi.fn>).mock.calls.length,
        report: (ci.getTaskReport as ReturnType<typeof vi.fn>).mock.calls.length
      })
    }
  }

  it('на «Общем» не запрашивает ни улучшения, ни отчёты', async () => {
    const { calls } = spies()
    render(<TaskModal {...props()} />)
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Общее' })).toHaveAttribute('aria-selected', 'true'))
    expect(calls()).toEqual({ improvements: 0, kb: 0, report: 0 })
  })

  it('отчёты грузятся с первого открытия «Хода выполнения» и не перезапрашиваются при возврате', async () => {
    const { calls } = spies()
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }) })} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Ход выполнения' }))
    await waitFor(() => expect(calls().kb).toBe(1))
    expect(calls().report).toBe(1)

    await userEvent.click(screen.getByRole('tab', { name: 'Общее' }))
    await userEvent.click(screen.getByRole('tab', { name: 'Ход выполнения' }))
    expect(calls()).toMatchObject({ kb: 1, report: 1 })
  })

  it('улучшения запрашиваются только у задачи, у которой был ран', async () => {
    const { calls } = spies()
    const { unmount } = render(<TaskModal {...props()} />)
    await userEvent.click(screen.getByRole('tab', { name: /Улучшения/ }))
    expect(calls().improvements).toBe(0)
    unmount()

    render(<TaskModal {...props({ ciSummary: mkSummary() })} />)
    await waitFor(() => expect(calls().improvements).toBe(1))
  })

  it('QA-этапы не опрашиваются у задачи, у которой не было ни одного рана', async () => {
    // Три запроса (по одному на этап) уходили при каждом открытии любой задачи —
    // даже в проекте без QA. Раны этапов создаёт сам этап, поэтому «рана не
    // было» означает и «QA-ранов нет».
    window.ci = createFakeCi()
    const listStageRuns = vi.fn(async () => [])
    window.qa = { listStageRuns } as unknown as typeof window.qa
    const { unmount } = render(<TaskModal {...props()} />)
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Общее' })).toHaveAttribute('aria-selected', 'true'))
    expect(listStageRuns).not.toHaveBeenCalled()
    unmount()

    render(<TaskModal {...props({ ciSummary: mkSummary() })} />)
    await waitFor(() => expect(listStageRuns).toHaveBeenCalledTimes(3))
  })

  it('панель Component QA молчит и не заводит опрос, пока её вкладку не открыли', async () => {
    // У панели внутри `setInterval` на 2 секунды: раньше он запускался у любой
    // открытой карточки, стоявшей на QA-этапе, даже если вкладку не смотрели.
    window.ci = createFakeCi()
    const getComponent = vi.fn(async () => null)
    window.qa = { getComponent } as unknown as typeof window.qa
    // Колонка «Ручное QA»: пройденные этапы остаются вкладками, но карточка
    // открывается на «Общем» — именно этот случай и тратил запрос впустую.
    const qaBoard: Board = { ...board, columns: [{ ...board.columns[0]!, name: 'Ручное QA', semanticType: 'manual_qa' }] }
    render(<TaskModal {...props({ board: qaBoard })} />)
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Общее' })).toHaveAttribute('aria-selected', 'true'))
    expect(getComponent).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('tab', { name: 'Component QA' }))
    await waitFor(() => expect(getComponent).toHaveBeenCalledTimes(1))
  })
})

describe('TaskModal — подзадачи и активность на «Общем»', () => {
  const parentBoard: Board = {
    columns: [
      { id: 'c0', projectId: 'p1', name: 'Бэклог', semanticType: 'backlog', position: 512, hidden: false, wipLimit: null, createdAt: 1 },
      board.columns[0]!,
      { id: 'c9', projectId: 'p1', name: 'Готово', semanticType: 'done', position: 4096, hidden: false, wipLimit: null, createdAt: 1 }
    ],
    tasks: [
      mkTask({ id: 'k1', parentId: 'e1', title: 'Первая', columnId: 'c9', seq: 2 }),
      mkTask({ id: 'k2', parentId: 'e1', title: 'Вторая', columnId: 'c1', seq: 3 })
    ]
  }
  const epic = mkTask({ id: 'e1', type: 'epic', title: 'Эпик' })

  it('показывает готовность подзадач полосой прогресса', () => {
    render(<TaskModal {...props({ task: epic, board: parentBoard })} />)

    expect(screen.getByText('1 из 2')).toBeInTheDocument()
    const bar = screen.getByRole('progressbar', { name: 'Готовность подзадач' })
    expect(bar).toHaveAttribute('aria-valuenow', '1')
    expect(bar).toHaveAttribute('aria-valuemax', '2')
  })

  it('добавляет подзадачу в первую видимую колонку с типом потомка', async () => {
    // У эпика потомок — стори, у стори — задача: тип задан моделью, а не выбором.
    const onCreateSubtask = vi.fn()
    render(<TaskModal {...props({ task: epic, board: parentBoard, onCreateSubtask })} />)

    await userEvent.click(screen.getByRole('button', { name: /Добавить подзадачу/ }))
    await userEvent.type(screen.getByLabelText('Название подзадачи'), 'Новая часть')
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))

    expect(onCreateSubtask).toHaveBeenCalledWith('c0', { title: 'Новая часть', type: 'story', parentId: 'e1' })
    // Форма закрылась — повторный ввод начинается с чистого листа.
    expect(screen.queryByLabelText('Название подзадачи')).not.toBeInTheDocument()
  })

  it('у обычной задачи подзадачу завести нельзя — потомков в модели нет', () => {
    render(<TaskModal {...props({ board: parentBoard, onCreateSubtask: vi.fn() })} />)
    expect(screen.queryByRole('button', { name: /Добавить подзадачу/ })).not.toBeInTheDocument()
  })

  it('без onCreateSubtask кнопки нет: во вложенной карточке создавать некуда', () => {
    render(<TaskModal {...props({ task: epic, board: parentBoard })} />)
    expect(screen.queryByRole('button', { name: /Добавить подзадачу/ })).not.toBeInTheDocument()
  })

  it('активность собирается из уже загруженных полей, без нового запроса', () => {
    // window.ci здесь не задан: если бы лента ходила в сеть, тест бы упал.
    render(<TaskModal {...props({
      task: mkTask({ createdAt: Date.parse('2026-08-28T10:00:00Z'), latestRunResult: { id: 'r1', kind: 'merge', status: 'finished', outcome: 'failure', createdAt: Date.parse('2026-08-29T10:00:00Z'), finishedAt: Date.parse('2026-08-29T10:05:00Z') } })
    })} />)

    const feed = screen.getByTestId('task-activity')
    expect(feed).toHaveTextContent('Merge: ошибка')
    expect(feed).toHaveTextContent('Задача создана')
    expect(feed.querySelector('.vc-feed-dot--danger')).not.toBeNull()
  })

  it('в черновике активности нет: событий у несозданной задачи не бывает', () => {
    render(<TaskModal {...props({ draft: true })} />)
    expect(screen.queryByTestId('task-activity')).not.toBeInTheDocument()
  })
})

describe('TaskModal — название и текущее состояние в шапке', () => {
  beforeEach(() => { window.ci = createFakeCi() })

  it('показывает ключ, редактируемое название и этап единственный раз', () => {
    render(<TaskModal {...props()} />)

    const heading = screen.getByTestId('task-modal-heading')
    // Ключ и этап — надстрочной строкой, название — крупным полем под ней.
    expect(heading).toHaveTextContent('PROJ-1')
    expect(within(heading).getByLabelText('Заголовок задачи')).toHaveValue('Задача A')
    expect(heading).toHaveTextContent('Разработка')
    expect(screen.getAllByText('PROJ-1', { exact: true })).toHaveLength(1)
    expect(screen.getAllByLabelText('Заголовок задачи')).toHaveLength(1)
    expect(screen.queryByText(/Последний запуск:/)).not.toBeInTheDocument()
  })

  it('добавляет фазу активного development-рана и обновляется по новым props', () => {
    const { rerender } = render(<TaskModal {...props()} />)
    expect(screen.getByTestId('task-modal-heading')).toHaveTextContent('Разработка')

    rerender(<TaskModal {...props({ ciSummary: mkSummary() })} />)
    expect(screen.getByTestId('task-modal-heading')).toHaveTextContent('Разработка · Модель работает')
  })

  it('после успешного рана показывает только новый этап', () => {
    const qaBoard: Board = { ...board, columns: [{ ...board.columns[0]!, name: 'Ручное QA', semanticType: 'manual_qa' }] }
    render(<TaskModal {...props({
      board: qaBoard,
      ciSummary: mkSummary({ status: 'success', modelActive: false, slotProgress: { done: 4, total: 4, phase: 'Готово' } })
    })} />)

    expect(screen.getByTestId('task-modal-heading')).toHaveTextContent('Ручное QA')
    expect(screen.getByTestId('task-modal-heading')).not.toHaveTextContent('Готово')
  })

  it('показывает актуальный ошибочный итог вместе с этапом', () => {
    const errorBoard: Board = { ...board, columns: [{ ...board.columns[0]!, name: 'Ошибка' }] }
    render(<TaskModal {...props({
      board: errorBoard,
      ciSummary: mkSummary({ status: 'failed', modelActive: false, slotProgress: { done: 2, total: 4, phase: 'Проверки не пройдены' } })
    })} />)

    expect(screen.getByTestId('task-modal-heading')).toHaveTextContent('Ошибка · Проверки не пройдены')
  })

  it('активный merge отображается той же надстрочной строкой', () => {
    render(<TaskModal {...props({ task: mkTask({ activeMergeRunId: 'merge-1' }) })} />)
    expect(screen.getByTestId('task-modal-heading')).toHaveTextContent('Разработка · Мерж выполняется')
  })

  it('точка состояния берёт тон у рана и не заменяет собой текст этапа', () => {
    // Цветом одним состояние не сообщают: точка стоит рядом с подписью этапа и
    // скрыта от скринридера, который читает саму подпись.
    const { rerender } = render(<TaskModal {...props()} />)
    const dot = (): Element | null => screen.getByTestId('task-modal-heading').querySelector('.task-modal-heading__dot')
    expect(dot()).toHaveClass('task-modal-heading__dot--neutral')
    expect(dot()).toHaveAttribute('aria-hidden', 'true')

    rerender(<TaskModal {...props({ ciSummary: mkSummary({ status: 'failed' }) })} />)
    expect(dot()).toHaveClass('task-modal-heading__dot--removed')
  })
})

describe('TaskModal — панель CI-рана', () => {
  beforeEach(() => { window.ci = createFakeCi() })

  it('показывает статус и ведёт в ленту рана', () => {
    const onOpenCiRun = vi.fn()
    const onStartCi = vi.fn()
    render(<TaskModal {...props({ ciSummary: mkSummary(), onOpenCiRun, onStartCi })} />)
    // Идущий ран открывает карточку на «Ленте рана»; панель CI живёт в колонке
    // деталей вкладки «Общее», и до неё надо дойти — теперь у панели вкладки
    // есть `hidden`, и скрытое содержимое недоступно ни мыши, ни читалке.
    fireEvent.click(screen.getByRole('tab', { name: 'Общее' }))

    const panel = screen.getByTestId('task-modal-ci')
    expect(panel).toHaveTextContent('выполняется')
    expect(panel).toHaveTextContent('Модель работает 1/4')

    fireEvent.click(screen.getByRole('button', { name: 'Лента рана' }))
    expect(onOpenCiRun).toHaveBeenCalledWith('run-1')
    // Ран идёт — повторный запуск недоступен.
    expect(screen.queryByRole('button', { name: 'В очередь' })).not.toBeInTheDocument()
    expect(onStartCi).not.toHaveBeenCalled()
  })

  it('для queued-рана показывает только «Параллельно», а running и awaiting_input защищены', () => {
    const onStartCiParallel = vi.fn()
    const view = render(<TaskModal {...props({
      ciSummary: mkSummary({ status: 'queued', modelActive: false }),
      onStartCi: vi.fn(),
      onStartCiParallel
    })} />)
    expect(screen.queryByRole('button', { name: 'В очередь' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Параллельно' }))
    expect(onStartCiParallel).toHaveBeenCalledWith('t1')

    for (const status of ['running', 'awaiting_input'] as const) {
      view.rerender(<TaskModal {...props({
        ciSummary: mkSummary({ status, awaitingInput: status === 'awaiting_input' }),
        onStartCi: vi.fn(),
        onStartCiParallel
      })} />)
      expect(screen.queryByRole('button', { name: 'Параллельно' })).not.toBeInTheDocument()
    }
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
    fireEvent.click(screen.getByRole('tab', { name: 'Общее' }))
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

  // Раскрытие в карточке выглядит одинаково: «Подробности» на телефоне брали
  // текстовые ▾/▸, ленты — свой шеврон.
  it('раскрывает «Подробности» тем же шевроном, что и ленты', () => {
    setMobile(true)
    render(<TaskModal {...props()} />)
    const toggle = screen.getByRole('button', { name: /Подробности/ })

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle.querySelector('.vc-feed-caret')).not.toBeNull()
    expect(toggle.textContent).not.toMatch(/[▾▸]/)
  })

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

    // В шапке из подписанных кнопок — только ⋯ и закрытие. Проверяем именно
    // шапку: чат теперь есть и в секции «Активность» на вкладке «Общее».
    const head = document.querySelector('.mdhead') as HTMLElement
    expect(within(head).queryByLabelText('Удалить задачу')).not.toBeInTheDocument()
    expect(within(head).queryByRole('button', { name: /Открыть чат|Создать чат/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Действия с задачей'))
    fireEvent.click(within(document.querySelector('.jmodal-menu') as HTMLElement).getByRole('button', { name: /Создать чат/ }))
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
    fireEvent.click(screen.getByRole('tab', { name: 'Общее' }))

    expect(screen.queryByTestId('task-modal-details')).not.toBeInTheDocument()
    expect(screen.getByTestId('task-modal-ci')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Лента рана' })).toBeInTheDocument()
  })

  it('на десктопе — правая панель раскрыта, действия в том же ⋯-меню', () => {
    // По макету в шапке стоят только «ещё» и крестик: три подписанные кнопки
    // ломали её на три строки при длинном названии.
    render(<TaskModal {...props({ onOpenChat: vi.fn() })} />)

    expect(screen.getByTestId('task-modal-details')).toBeInTheDocument()
    expect(screen.getByLabelText('Приоритет')).toBeInTheDocument()
    expect(screen.getByLabelText('Статус')).toBeInTheDocument()
    expect(screen.queryByTestId('task-modal-quick')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Удалить задачу')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Действия с задачей')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Подробности/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Действия с задачей'))
    expect(screen.getByRole('button', { name: /Удалить задачу/ })).toBeInTheDocument()
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
      'Общее', 'Временная шкала', 'Настройки', 'Ход выполнения', 'Улучшения', 'Ручное QA', 'Код', 'Merge', 'Лента рана'
    ])
  })

  // `role="tablist"` без `role="tabpanel"` — полуфабрикат: скринридер видит
  // вкладки, но не знает, что именно они открыли.
  it('связывает вкладку с её панелью и водит по полосе стрелками', async () => {
    render(<TaskModal {...props()} />)
    const timeline = screen.getByRole('tab', { name: 'Временная шкала' })
    const panel = screen.getByTestId('task-timeline-panel')

    expect(panel).toHaveAttribute('role', 'tabpanel')
    expect(timeline).toHaveAttribute('aria-controls', panel.id)
    expect(panel).toHaveAttribute('aria-labelledby', timeline.id)
    // У «Общего» панель тоже есть: две его колонки лежат в `.jmodal-general`.
    const general = screen.getByRole('tab', { name: 'Общее' })
    const generalPanel = document.getElementById(general.getAttribute('aria-controls')!)
    expect(generalPanel).toHaveClass('jmodal-general')
    expect(generalPanel).toHaveAttribute('role', 'tabpanel')
    expect(generalPanel).not.toHaveAttribute('hidden')
    expect(panel).toHaveAttribute('hidden')
    // Внутрь полосы Tab заводит один раз: у невыбранных вкладок tabIndex=-1.
    expect(screen.getByRole('tab', { name: 'Общее' })).toHaveAttribute('tabindex', '0')
    expect(timeline).toHaveAttribute('tabindex', '-1')

    screen.getByRole('tab', { name: 'Общее' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(timeline).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Лента рана' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Общее' })).toHaveAttribute('aria-selected', 'true')
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
      'Общее', 'Временная шкала', 'Подготовка к разработке', 'Настройки', 'Ход выполнения', 'Улучшения', 'Ручное QA', 'Код', 'Merge', 'Лента рана'
    ])
    unmount()

    const manualQaBoard: Board = { ...board, columns: [{ ...board.columns[0]!, name: 'Ручное QA', semanticType: 'manual_qa' }] }
    render(<TaskModal {...props({ board: manualQaBoard })} />)
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Общее', 'Временная шкала', 'Настройки', 'Ход выполнения', 'Улучшения', 'Component QA', 'Интеграционные тесты', 'Automated QA', 'Ручное QA', 'Код', 'Merge', 'Лента рана'
    ])
  })

  it('переключает восемь вкладок без закрытия и сохраняет черновик', async () => {
    const onClose = vi.fn()
    render(<TaskModal {...props({ onClose })} />)
    expect(screen.getAllByRole('tab')).toHaveLength(9)
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать критерии приёмки' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Редактировать критерии приёмки' }))
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
    await openProgress()
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

    await openProgress()
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

    await openProgress()
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

    await openProgress()
    const tile = await screen.findByTestId('task-modal-report-context')
    // (12 000 входа + 180 000 чтения кэша + 24 000 записи) / 24 запроса = 9 000.
    expect(text(tile)).toContain('9 000')
    expect(text(tile)).toContain('макс 12 000')
    expect(text(tile)).toContain('запросов к API 24')
  })

  it('контекст на запрос без данных CLI — прочерк с объяснением, а не ноль', async () => {
    withReport(makeTaskReport([makeRunReport({ totals: makeUsageTotals({ apiRequests: 0, maxContextPerRequest: 0 }) })]))
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }) })} />)

    await openProgress()
    const tile = await screen.findByTestId('task-modal-report-context')
    expect(text(tile)).toContain('—')
    expect(text(tile)).toContain('CLI не сообщил число запросов')
  })

  it('показывает объём ответов инструментов и три самых тяжёлых ответа', async () => {
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }) })} />)

    await openProgress()
    const tools = await screen.findByTestId('task-modal-report-tools')
    expect(text(tools)).toContain('ответами 290k симв.')
    expect(text(tools)).toContain('bash 148k')

    await openProgress()
    const heaviest = await screen.findByTestId('task-modal-report-heaviest')
    expect(text(heaviest)).toContain('npm ci')
    expect(text(heaviest)).toContain('20k симв.')
    // Обрезка видна вместе с исходным объёмом: сколько лимит сэкономил.
    expect(text(heaviest)).toContain('обрезано из 243k')
  })

  it('у рана без тяжёлых ответов строки самых тяжёлых нет', async () => {
    withReport(makeTaskReport([makeRunReport({ toolResponses: [] })]))
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }) })} />)

    await openProgress()
    await screen.findByTestId('task-modal-report')
    expect(screen.queryByTestId('task-modal-report-heaviest')).not.toBeInTheDocument()
  })

  it('без отказов приписки в строке инструментов нет', async () => {
    withReport(makeTaskReport([makeRunReport({
      toolCalls: { bash: 1, read: 2, grep: 0, edit: 0, kb: 0, other: 0, denied: 0 }
    })]))
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }) })} />)

    await openProgress()
    const tools = await screen.findByTestId('task-modal-report-tools')
    expect(text(tools)).not.toContain('отказов')
  })

  it('время работы модели без данных CLI — прочерк, а не «0мс»', async () => {
    withReport(makeTaskReport([makeRunReport({ totals: makeUsageTotals({ modelActiveMs: 0 }) })]))
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }) })} />)

    await openProgress()
    const tile = await screen.findByTestId('task-modal-report-model-time')
    expect(text(tile)).toContain('—')
  })

  it('у рана без счётчика вызовов строки инструментов нет (а не «0»)', async () => {
    withReport(makeTaskReport([makeRunReport({ toolCalls: null })]))
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }) })} />)

    await openProgress()
    await screen.findByTestId('task-modal-report')
    expect(screen.queryByTestId('task-modal-report-tools')).not.toBeInTheDocument()
  })

  it('итог с ходами без прайса помечен заниженным, а не просто оценкой', async () => {
    withReport(makeTaskReport([makeRunReport({
      totals: makeUsageTotals({ costUsd: 0.9, costEstimated: true, costUnderstated: true })
    })]))
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }) })} />)

    await openProgress()
    const cost = await screen.findByTestId('task-modal-report-cost')
    expect(text(cost)).toContain('≈ $0.90')
    expect(text(cost)).toContain('итог занижен')
  })

  it('показывает попадание БЗ рядом с расходом завершённого рана', async () => {
    withReport(makeTaskReport([makeRunReport({
      kbHit: { sectionsDelivered: 5, sectionsHit: 3, hitRatio: 0.6 }
    })]))
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }) })} />)

    await openProgress()
    const hit = await screen.findByTestId('task-modal-report-kb-hit')
    expect(text(hit)).toContain('БЗ: выдано 5 разделов, пригодились 3 (60%')
  })

  it('стоимость без данных CLI помечена «≈»', async () => {
    withReport(makeTaskReport([makeRunReport({ totals: makeUsageTotals({ costUsd: 2.07, costEstimated: true }) })]))
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }) })} />)

    await openProgress()
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

    await openProgress()
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

    await openProgress()
    const block = await screen.findByTestId('task-modal-report')
    expect(text(within(block).getByTestId('task-modal-report-cost'))).toContain('—')
    expect(within(block).getByRole('rowheader', { name: /npm ci/, hidden: true })).toBeInTheDocument()
    // Стадий у рана до фичи расхода нет — таблицы тоже нет, а не пустая шапка.
    expect(within(block).queryByTestId('task-modal-report-stages')).not.toBeInTheDocument()
  })

  it('стадии рана показывают модель, которой каждая посчитана', async () => {
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }) })} />)

    await openProgress()
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
    // Модель попытки теперь стоит подписанной строкой сводки, а не лозенгой.
    expect(await within(await screen.findByTestId('task-preparation-summary')).findByText('codex · gpt-5.6-sol')).toBeInTheDocument()
    expect(await screen.findByTestId('task-preparation-feed')).toHaveTextContent('Уточняю критерии')
  })

  it('показывает имя машины и использует agentId для пустого имени', async () => {
    window.ci!.getTaskMachines = vi.fn(async () => ({
      machines: [
        { agentId: 'm1', name: 'MacBook', online: true, canUse: true, personal: true, project: true, projectDefault: true },
        { agentId: 'm2', name: '', online: true, canUse: true, personal: true, project: true, projectDefault: false },
        { agentId: 'm3', name: '   ', online: true, canUse: true, personal: true, project: true, projectDefault: false }
      ],
      selectedAgentId: null, unavailableSelection: null, effectiveAgentId: 'm1'
    }))
    render(<TaskModal {...props({ board: preparationBoard, initialTab: 'preparation', onStartPreparation: vi.fn() })} llmAccess={[]} llmEngines={[]} />)

    const select = await screen.findByLabelText('Машина подготовки')
    const options = within(select).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual(['MacBook', 'm2', 'm3'])
    expect(options.map((option) => option.getAttribute('value'))).toEqual(['m1', 'm2', 'm3'])
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
    expect(await screen.findByTestId('status-pill')).toHaveTextContent(label)
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
    expect(await screen.findByTestId('status-pill')).toHaveTextContent('успешно')
    await act(async () => { resolveOld([run('failed', { id: 'prep-old' })]); await oldRequest })
    expect(screen.getByTestId('status-pill')).toHaveTextContent('успешно')
    expect(screen.getByTestId('status-pill')).not.toHaveTextContent('ошибка')
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
    const loadOne = vi.fn(async (id: string) => run('running', { id }))
    const view = render(<TaskModal {...props({
      board: preparationBoard,
      initialTab: 'preparation',
      task: mkTask({ taskPreparationRunId: 'prep-waiting_for_answer', taskPreparationStatus: 'waiting_for_answer' }),
      loadPreparationRuns: load,
      loadPreparationRun: loadOne
    })} />)
    await waitFor(() => expect(screen.getByTestId('status-pill')).toHaveTextContent('ожидает ответа'))
    expect(load).toHaveBeenCalledTimes(1) // список — один раз при открытии
    expect(loadOne).not.toHaveBeenCalled()

    vi.useFakeTimers()
    try {
      // Чужие проект/задача игнорируются; события своего рана коалесятся в
      // точечные догрузки (loadRun), а весь список НЕ перезапрашивается.
      act(() => {
        preparationUpdated?.({ projectId: 'other', taskId: 't1', runId: 'foreign-project' })
        preparationUpdated?.({ projectId: 'p1', taskId: 'other', runId: 'foreign-task' })
        preparationUpdated?.({ projectId: 'p1', taskId: 't1', runId: 'prep-1' })
        preparationUpdated?.({ projectId: 'p1', taskId: 't1', runId: 'prep-2' })
        vi.advanceTimersByTime(500)
      })
      await act(async () => { await Promise.resolve() })
      expect(load).toHaveBeenCalledTimes(1)
      expect(loadOne).toHaveBeenCalledWith('prep-1')
      expect(loadOne).toHaveBeenCalledWith('prep-2')

      // Reconnect — полная сверка списка (мог пропустить события).
      await act(async () => { reconnected?.(); await Promise.resolve() })
      expect(load).toHaveBeenCalledTimes(2)

      // Позднее событие после unmount ничего не догружает, обработчики сняты.
      act(() => preparationUpdated?.({ projectId: 'p1', taskId: 't1', runId: 'late' }))
      view.unmount()
      act(() => vi.advanceTimersByTime(500))
      expect(loadOne).toHaveBeenCalledTimes(2)
      expect(load).toHaveBeenCalledTimes(2)
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

describe('TaskModal — вкладки по возможностям типа проекта', () => {
  const tabNames = (): string[] => screen.getAllByRole('tab').map((tab) => tab.textContent ?? '')

  it('без возможностей типа остаются только вкладки, не зависящие от подсистем', () => {
    render(<TaskModal {...props({ projectFeatures: NO_PROJECT_FEATURES })} />)
    expect(tabNames()).toEqual(['Общее', 'Временная шкала', 'Настройки', 'Ход выполнения'])
  })

  it('с полным набором возвращаются CI, QA и merge', () => {
    render(<TaskModal {...props({ projectFeatures: ALL_PROJECT_FEATURES })} />)
    const tabs = tabNames()
    expect(tabs).toContain('Ручное QA')
    expect(tabs).toContain('Merge')
    expect(tabs).toContain('Лента рана')
  })

  it('только QA: merge и лента рана скрыты, ручное QA на месте', () => {
    render(<TaskModal {...props({ projectFeatures: { ...NO_PROJECT_FEATURES, qa: true } })} />)
    const tabs = tabNames()
    expect(tabs).toContain('Ручное QA')
    expect(tabs).not.toContain('Merge')
    expect(tabs).not.toContain('Лента рана')
  })

  it('скрытая вкладка не выбирается по умолчанию', () => {
    // Активный ран обычно открывает «Ленту рана»; без CI такой вкладки нет.
    render(<TaskModal {...props({ projectFeatures: NO_PROJECT_FEATURES, ciSummary: mkSummary() })} />)
    expect(screen.getByRole('tab', { name: 'Общее' })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('TaskModal — создание чата задачи', () => {
  it('просит чат один раз на задачу, даже если родитель ререндерится с новым колбэком', async () => {
    const calls: string[] = []
    // Как в App.tsx: onEnsureChat — inline-стрелка, новая на каждый рендер.
    const view = (): JSX.Element => <TaskModal {...props({ onEnsureChat: (taskId: string) => { calls.push(taskId) } })} />
    const { rerender } = render(view())
    expect(calls).toEqual(['t1'])

    rerender(view())
    rerender(view())

    expect(calls).toEqual(['t1'])
  })
})

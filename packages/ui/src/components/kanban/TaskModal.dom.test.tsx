import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectLabelledIconButtons, expectNoViolations } from '../../test/a11y'
import { screen, fireEvent, within, waitFor } from '@testing-library/react'
import { render } from '../../test/uiRender'
import userEvent from '@testing-library/user-event'
import type { Board, Task } from '@shared/projects'
import type { CiRunSummary, CiTaskReport } from '@shared/ci'
import { EMPTY_CI_USAGE_TOTALS } from '@shared/ci'
import { TaskModal, type TaskModalProps } from './TaskModal'
import { createFakeCi } from '../../test/fakeApi'
import { makeReportStep, makeRunReport, makeTaskReport, makeUsageTotals } from '../../test/fixtures'
import type { KbTaskUsageReport } from '@shared/kb'
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
    expect(within(block).getByRole('link', { name: /CI-раннер/ })).toHaveAttribute('href', '#/kb/ci-runner')
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
    expect(within(steps).getByRole('rowheader', { name: /npm ci/ })).toBeInTheDocument()
    expect(within(steps).getByRole('rowheader', { name: /Установить зависимости/ })).toBeInTheDocument()
    expect(within(steps).getByRole('rowheader', { name: /Работа модели/ })).toBeInTheDocument()
    expect(within(steps).getAllByText('9м 00с').length).toBeGreaterThan(0)
  })


  it('показывает вызовы инструментов рана с разбивкой', async () => {
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }) })} />)

    const tools = await screen.findByTestId('task-modal-report-tools')
    // 12 bash + 31 read + 9 grep + 14 edit + 3 kb + 1 прочий = 70 вызовов.
    expect(text(tools)).toContain('Инструменты: 70 вызовов, из них чтений 31, правок 14')
    expect(text(tools)).toContain('bash 12')
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
    expect(text(hit)).toContain('БЗ: выдано 5 разделов, задето 3 файлов из них')
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
    await userEvent.click(within(block).getByRole('button', { name: 'Итог по задаче' }))
    expect(text(within(block).getByTestId('task-modal-report-cost'))).toContain('$2.34')
    expect(within(block).getByTestId('task-modal-report-runs')).toBeInTheDocument()
  })

  it('у старого рана без расхода отчёт открывается: шаги есть, деньги прочерком', async () => {
    withReport(makeTaskReport([makeRunReport({ totals: { ...EMPTY_CI_USAGE_TOTALS }, steps: [makeReportStep()] })]))
    render(<TaskModal {...props({ ciSummary: mkSummary({ status: 'success', modelActive: false }) })} />)

    const block = await screen.findByTestId('task-modal-report')
    expect(text(within(block).getByTestId('task-modal-report-cost'))).toContain('—')
    expect(within(block).getByRole('rowheader', { name: /npm ci/ })).toBeInTheDocument()
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

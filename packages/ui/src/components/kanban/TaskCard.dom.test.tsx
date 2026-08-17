import { describe, it, expect, vi } from 'vitest'
import { useEffect, useState } from 'react'
import { act, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/uiRender'
import type { Task } from '@shared/projects'
import type { CiRun, CiRunSummary } from '@shared/ci'
import { createFakeCi } from '../../test/fakeApi'
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
    dragging: false, ...over
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

describe('TaskCard feature-preview', () => {
  it('пульсирует только при серверном признаке готового окружения', () => {
    const { rerender } = render(<TaskCard {...props({ task: mkTask({ previewReady: true }) })} />)
    expect(screen.getByTestId('task-card').className).toContain('jcard--preview-running')
    rerender(<TaskCard {...props({ task: mkTask({ previewReady: false }) })} />)
    expect(screen.getByTestId('task-card').className).not.toContain('jcard--preview-running')
  })
})

describe('TaskCard CI-панель', () => {
  it('кнопка «В очередь» вызывает onStartCi', () => {
    const onStartCi = vi.fn()
    render(<TaskCard {...props({ onStartCi })} />)
    fireEvent.click(screen.getByRole('button', { name: 'В очередь' }))
    expect(onStartCi).toHaveBeenCalledWith('t1')
  })

  it('блокирует повторный запуск и показывает состояние постановки в очередь', async () => {
    let finish!: () => void
    const onStartCi = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    render(<TaskCard {...props({ onStartCi, onStartCiParallel: vi.fn() })} />)

    const queue = screen.getByRole('button', { name: 'В очередь' })
    expect(queue).toHaveAttribute('title', 'Добавить задачу в очередь выполнения. Если свободный слот есть, выполнение начнётся сразу')
    fireEvent.click(queue)
    fireEvent.click(queue)

    expect(onStartCi).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Добавляем в очередь…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Параллельно' })).toBeDisabled()
    finish()
    await waitFor(() => expect(screen.getByRole('button', { name: 'В очередь' })).toBeEnabled())
  })

  it('кнопка «Параллельно» запускает мимо очереди и скрыта при активном ране', () => {
    const onStartCiParallel = vi.fn()
    const { rerender } = render(<TaskCard {...props({ onStartCi: vi.fn(), onStartCiParallel })} />)
    const parallel = screen.getByRole('button', { name: 'Параллельно' })
    expect(parallel).toHaveAttribute('title', 'Запустить задачу сразу, минуя общую очередь. Машина будет выбрана автоматически с учётом загрузки')
    fireEvent.click(parallel)
    expect(onStartCiParallel).toHaveBeenCalledWith('t1')

    rerender(<TaskCard {...props({ ciSummary: mkSummary({ status: 'queued' }), onStartCi: vi.fn(), onStartCiParallel })} />)
    expect(screen.queryByRole('button', { name: 'Параллельно' })).not.toBeInTheDocument()
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

  it('даёт убрать из очереди только queued-ран после подтверждения', async () => {
    const onDequeueCiRun = vi.fn()
    const { rerender } = render(<TaskCard {...props({ ciSummary: mkSummary({ status: 'queued' }), onDequeueCiRun })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Убрать из очереди' }))
    const dialog = await screen.findByTestId('confirm-dialog')
    expect(dialog).toHaveTextContent('Ожидающий ран будет отменён, а задача вернётся в TODO.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Убрать из очереди' }))
    await waitFor(() => expect(onDequeueCiRun).toHaveBeenCalledWith('run-1'))

    rerender(<TaskCard {...props({ ciSummary: mkSummary({ status: 'running' }), onDequeueCiRun })} />)
    expect(screen.queryByRole('button', { name: 'Убрать из очереди' })).not.toBeInTheDocument()
  })

  it('пока ран идёт, «В очередь» недоступна — остаётся только лента', () => {
    for (const status of ['queued', 'running', 'awaiting_input'] as const) {
      const ciSummary = mkSummary({ status, awaitingInput: status === 'awaiting_input' })
      const { unmount } = render(<TaskCard {...props({ ciSummary, onOpenCiRun: vi.fn(), onStartCi: vi.fn() })} />)
      expect(screen.queryByRole('button', { name: 'В очередь' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: status === 'awaiting_input' ? 'Ответить модели' : 'Лента рана' })).toBeInTheDocument()
      unmount()
    }
  })

  it('ручное завершение убирает старую ошибку с карточки, сохраняя ленту', () => {
    render(
      <TaskCard
        {...props({
          task: mkTask({ columnId: 'done' }),
          doneColumnIds: new Set(['done']),
          ciSummary: mkSummary({ status: 'failed', modelActive: false }),
          onOpenCiRun: vi.fn(),
          onStartCi: vi.fn()
        })}
      />
    )
    expect(screen.queryByText('ошибка')).not.toBeInTheDocument()
    expect(screen.getByTestId('task-card').className).not.toContain('jcard--ci-failed')
    expect(screen.getByRole('button', { name: 'Лента рана' })).toBeInTheDocument()
  })

  it('у завершённого рана кнопка запуска есть при любом исходе', () => {
    // Успех, падение, отмена, таймаут — ран закончен, повторный запуск разрешён.
    for (const status of ['success', 'failed', 'cancelled', 'timeout'] as const) {
      const onStartCi = vi.fn()
      const { unmount } = render(<TaskCard {...props({ ciSummary: mkSummary({ status }), onOpenCiRun: vi.fn(), onStartCi })} />)
      fireEvent.click(screen.getByRole('button', { name: 'В очередь' }))
      expect(onStartCi).toHaveBeenCalledWith('t1')
      unmount()
    }
  })
})

/**
 * Карточка, подключённая к фейковому `window.ci` так же, как её подключает стор:
 * «В очередь» зовёт `startRun`, сводка обновляется ответом api и кадром `ci.done`.
 * Проверяем не только видимость кнопки, но и что клик действительно заводит
 * новый ран, а не переоткрывает прошлый.
 */
function toSummary(run: CiRun): CiRunSummary {
  return {
    id: run.id,
    taskId: run.taskId,
    status: run.status,
    slotProgress: run.slotProgress,
    durationMs: run.durationMs,
    modelActive: false,
    awaitingInput: run.status === 'awaiting_input'
  }
}

function CardWithFakeCi({ initial }: { initial?: CiRunSummary }): JSX.Element {
  const [summary, setSummary] = useState<CiRunSummary | undefined>(initial)
  useEffect(() => window.ci?.onDone(({ run }) => setSummary(toSummary(run))), [])
  return (
    <TaskCard
      {...props({
        ciSummary: summary,
        onOpenCiRun: vi.fn(),
        onStartCi: (taskId) => {
          void window.ci?.startRun('p1', taskId).then((run) => setSummary(toSummary(run)))
        }
      })}
    />
  )
}

describe('TaskCard CI-панель с фейковым api', () => {
  it('на выполненной задаче «В очередь» стартует новый ран, кнопка уходит на время рана и возвращается после', async () => {
    const ci = createFakeCi()
    window.ci = ci
    const startRun = vi.spyOn(ci, 'startRun')
    render(<CardWithFakeCi initial={mkSummary({ id: 'run-old', status: 'success', durationMs: 12_000 })} />)
    expect(screen.getByText('успех')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'В очередь' }))

    expect(startRun).toHaveBeenCalledWith('p1', 't1')
    const started = (await startRun.mock.results[0]!.value) as CiRun
    expect(started.id).not.toBe('run-old')
    // Ран в очереди — активен, значит запускать нечего: остаётся только лента.
    await waitFor(() => expect(screen.getByText('в очереди')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'В очередь' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Лента рана' })).toBeInTheDocument()

    // Кадр `ci.done` приходит из сервера — в тесте досылаем его руками.
    act(() => ci._emitDone({ ...started, status: 'success', finishedAt: (started.startedAt ?? 0) + 1000, durationMs: 1000 }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'В очередь' })).toBeInTheDocument())
    expect(screen.getByText('успех')).toBeInTheDocument()
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

describe('TaskCard: следов прошлого рана не остаётся', () => {
  it('после успешного повтора нет ни лозенга «ошибка», ни красной пульсации, ни фазы упавшего рана', () => {
    const failed = mkSummary({ id: 'run-1', status: 'failed', slotProgress: { done: 2, total: 4, phase: 'Финальные команды (1/2)' }, modelActive: false })
    const { rerender } = render(<TaskCard {...props({ ciSummary: failed, onOpenCiRun: vi.fn(), onStartCi: vi.fn() })} />)
    expect(screen.getByText('ошибка')).toBeInTheDocument()
    expect(screen.getByTestId('task-card').className).toContain('jcard--ci-failed')

    // Новый ран той же задачи завершился успехом — карточка обязана это показать.
    const success = mkSummary({ id: 'run-2', status: 'success', slotProgress: { done: 4, total: 4, phase: 'Готово' }, durationMs: 1000, modelActive: false })
    rerender(<TaskCard {...props({ ciSummary: success, onOpenCiRun: vi.fn(), onStartCi: vi.fn() })} />)

    expect(screen.queryByText('ошибка')).not.toBeInTheDocument()
    expect(screen.queryByText(/Финальные команды/)).not.toBeInTheDocument()
    expect(screen.getByText('успех')).toBeInTheDocument()
    const card = screen.getByTestId('task-card')
    expect(card.className).not.toContain('jcard--ci-failed')
    expect(card.className).toContain('jcard--ci-done')
  })

  it('после отмены и нового рана карточка показывает идущий ран, а не «отменён»', () => {
    const cancelled = mkSummary({ id: 'run-1', status: 'cancelled', slotProgress: { done: 1, total: 4, phase: 'Ран отменён' } })
    const { rerender } = render(<TaskCard {...props({ ciSummary: cancelled, onOpenCiRun: vi.fn(), onStartCi: vi.fn() })} />)
    expect(screen.getByText('отменён')).toBeInTheDocument()

    rerender(<TaskCard {...props({ ciSummary: mkSummary({ id: 'run-2', status: 'running', slotProgress: { done: 0, total: 4, phase: 'Подготовка (1/2)' } }), onOpenCiRun: vi.fn(), onStartCi: vi.fn() })} />)
    expect(screen.queryByText('отменён')).not.toBeInTheDocument()
    expect(screen.queryByText(/Ран отменён/)).not.toBeInTheDocument()
    expect(screen.getByText('выполняется')).toBeInTheDocument()
    expect(screen.getByTestId('task-card').className).toContain('jcard--ci-running')
  })
})

describe('TaskCard — подготовка к разработке', () => {
  it('в TODO показывает только запуск подготовки, без development-кнопок', () => {
    const onStartPreparation = vi.fn()
    render(<TaskCard {...props({ columnSemanticType: 'backlog', onStartPreparation, onStartCi: vi.fn(), onStartCiParallel: vi.fn() })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Начать подготовку задачи' }))
    expect(onStartPreparation).toHaveBeenCalledWith('t1')
    expect(screen.queryByRole('button', { name: 'В очередь' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Параллельно' })).not.toBeInTheDocument()
  })

  it('в preparation открывает deep-link вкладки подготовки и не показывает development-действия', () => {
    const onOpen = vi.fn()
    render(<TaskCard {...props({ onOpen, columnSemanticType: 'preparation', task: mkTask({ taskPreparationStatus: 'failed', taskPreparationError: 'Гейт не пройден' }), onStartPreparation: vi.fn(), onStartCi: vi.fn(), onStartCiParallel: vi.fn() })} />)
    expect(screen.getByTestId('task-preparation-panel')).toHaveTextContent('Гейт не пройден')
    fireEvent.click(screen.getByRole('button', { name: 'Лента подготовки' }))
    expect(onOpen).toHaveBeenCalledWith('t1', 'preparation')
    expect(screen.queryByRole('button', { name: 'В очередь' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Параллельно' })).not.toBeInTheDocument()
  })
})

describe('TaskCard — переход между этапами', () => {
  it('показывает disabled-состояния первой, средней и последней колонок', () => {
    const move = vi.fn()
    const { rerender } = render(<TaskCard {...props({ previousColumn: null, nextColumn: { id: 'c2', name: 'Development' }, onMoveToColumn: move })} />)
    expect(screen.getByRole('button', { name: /влево/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /вправо.*Development/ })).toBeEnabled()

    rerender(<TaskCard {...props({ previousColumn: { id: 'c1', name: 'Ready' }, nextColumn: { id: 'c3', name: 'Component QA' }, onMoveToColumn: move })} />)
    expect(screen.getByRole('button', { name: /влево.*Ready/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /вправо.*Component QA/ })).toBeEnabled()

    rerender(<TaskCard {...props({ previousColumn: { id: 'c2', name: 'Merge' }, nextColumn: null, onMoveToColumn: move })} />)
    expect(screen.getByRole('button', { name: /влево.*Merge/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /вправо/ })).toBeDisabled()
  })

  it('не открывает карточку и блокирует обе стрелки до завершения одного запроса', async () => {
    let finish!: () => void
    const onMoveToColumn = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const onOpen = vi.fn()
    render(<TaskCard {...props({ onOpen, previousColumn: { id: 'c0', name: 'Backlog' }, nextColumn: { id: 'c2', name: 'Development' }, onMoveToColumn })} />)

    const right = screen.getByRole('button', { name: /вправо.*Development/ })
    await act(async () => { fireEvent.click(right); fireEvent.click(right) })
    expect(onMoveToColumn).toHaveBeenCalledTimes(1)
    expect(onMoveToColumn).toHaveBeenCalledWith('t1', 'c1', 'c2')
    expect(screen.getByRole('button', { name: /влево.*Backlog/ })).toBeDisabled()
    expect(right).toBeDisabled()
    expect(onOpen).not.toHaveBeenCalled()

    await act(async () => finish())
    expect(right).toBeEnabled()
  })
})

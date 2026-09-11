import { describe, it, expect, vi } from 'vitest'
import { useEffect, useState } from 'react'
import { act, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/uiRender'
import type { Task } from '@shared/projects'
import type { CiRun, CiRunSummary } from '@shared/ci'
import { createFakeCi } from '@voicechat/ui-foundation/test/fakeApi'
import { expectNoViolations } from '@voicechat/ui-foundation/test/a11y'
import { TaskCard, type TaskCardProps, updatedPresentation } from './TaskCard'

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

describe('TaskCard — клавиатура и меню действий', () => {
  it('описывает карточку и открывает её Enter, оставляя Space переносу', () => {
    const onOpen = vi.fn()
    const onCardKeys = vi.fn()
    render(<TaskCard {...props({ onOpen, onCardKeys })} />)
    const card = screen.getByTestId('task-card')
    expect(card).toHaveAttribute('role', 'article')
    expect(card).toHaveAttribute('aria-keyshortcuts', 'Enter Space Shift+F10')
    expect(card).toHaveAccessibleDescription('Enter — открыть; Пробел — перенести; Shift+F10 — открыть действия.')

    fireEvent.keyDown(card, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith('t1')
    expect(onCardKeys).not.toHaveBeenCalled()
    fireEvent.keyDown(card, { key: ' ' })
    expect(onCardKeys).toHaveBeenCalledTimes(1)
  })

  it('Shift+F10 открывает именованное меню, фокусирует первый пункт и ходит стрелками', async () => {
    render(<TaskCard {...props()} />)
    const card = screen.getByTestId('task-card')
    card.focus()
    fireEvent.keyDown(card, { key: 'F10', shiftKey: true })
    const menu = await screen.findByRole('menu', { name: 'Действия с «Задача A»' })
    const items = within(menu).getAllByRole('menuitem')
    await waitFor(() => expect(items[0]).toHaveFocus())

    await userEvent.keyboard('{ArrowDown}')
    expect(items[1]).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(items.at(-1)).toHaveFocus()
    await userEvent.keyboard('{Home}')
    expect(items[0]).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(items.at(-1)).toHaveFocus()
  })

  it('Escape закрывает меню и возвращает фокус карточке', async () => {
    render(<TaskCard {...props()} />)
    const card = screen.getByTestId('task-card')
    fireEvent.keyDown(card, { key: 'ContextMenu' })
    const menu = await screen.findByRole('menu')
    await waitFor(() => expect(within(menu).getAllByRole('menuitem')[0]).toHaveFocus())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    await waitFor(() => expect(card).toHaveFocus())
  })

  it('кнопка и правый клик раскрывают одно меню с полным aria-контрактом', async () => {
    render(<TaskCard {...props()} />)
    const card = screen.getByTestId('task-card')
    const trigger = screen.getByRole('button', { name: 'Действия с «Задача A»' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(trigger)
    const menu = await screen.findByRole('menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveAttribute('aria-controls', menu.id)
    await userEvent.keyboard('{Escape}')
    fireEvent.contextMenu(card)
    expect(await screen.findByRole('menu')).toBeInTheDocument()
  })

  it('клавиши внутренних кнопок не открывают карточку и не запускают перенос', async () => {
    const onOpen = vi.fn()
    const onOpenChat = vi.fn()
    const onCardKeys = vi.fn()
    render(<TaskCard {...props({ onOpen, onOpenChat, onCardKeys })} />)
    const chat = screen.getByRole('button', { name: 'Связанный чат' })
    chat.focus()
    await userEvent.keyboard('{Enter}')
    expect(onOpenChat).toHaveBeenCalledWith('t1')
    expect(onOpen).not.toHaveBeenCalled()
    expect(onCardKeys).not.toHaveBeenCalled()
  })

  it('Enter у уже взятой карточки передаётся доске для завершения переноса', () => {
    const onOpen = vi.fn()
    const onCardKeys = vi.fn()
    render(<TaskCard {...props({ grabbed: true, onOpen, onCardKeys })} />)
    const card = screen.getByTestId('task-card')
    fireEvent.keyDown(card, { key: 'Enter' })
    expect(onOpen).not.toHaveBeenCalled()
    expect(onCardKeys).toHaveBeenCalledTimes(1)
  })
})

describe('TaskCard — объяснение результатов поиска', () => {
  it('подсвечивает все совпадения без учёта регистра, сохраняя доступное имя карточки', () => {
    render(<TaskCard {...props({ task: mkTask({ title: 'Alpha alpha', labels: ['Alpha-team'] }), searchQuery: 'ALPHA' })} />)
    const card = screen.getByTestId('task-card')
    expect(card.querySelectorAll('mark.jcard-search-hit')).toHaveLength(3)
    expect(Array.from(card.querySelectorAll('mark')).map((mark) => mark.textContent)).toEqual(['Alpha', 'alpha', 'Alpha'])
    expect(card).toHaveAccessibleName(/Alpha alpha/)
  })

  it('показывает источник совпадения в скрытых полях и безопасно принимает спецсимволы', () => {
    const task = mkTask({
      assignee: 'alice',
      labels: ['one', 'two', 'three', 'release[1]'],
      description: 'Префикс с искомым [value] и продолжением описания',
      acceptanceCriteria: 'Ответ содержит [value]'
    })
    const { rerender } = render(<TaskCard {...props({ task, searchQuery: 'ALICE' })} />)
    expect(screen.getByLabelText('Совпадения поиска')).toHaveTextContent('Исполнитель: alice')
    expect(screen.getByLabelText('Совпадения поиска').querySelectorAll('mark')).toHaveLength(1)

    rerender(<TaskCard {...props({ task, searchQuery: '[value]' })} />)
    const context = screen.getByLabelText('Совпадения поиска')
    expect(context).toHaveTextContent('Описание:')
    expect(context).toHaveTextContent('Критерии:')
    expect(context.querySelectorAll('mark')).toHaveLength(2)
  })

  it('не добавляет разметку подсветки для пустого запроса', () => {
    render(<TaskCard {...props({ searchQuery: '   ' })} />)
    expect(screen.getByTestId('task-card').querySelector('mark')).toBeNull()
    expect(screen.queryByLabelText('Совпадения поиска')).not.toBeInTheDocument()
  })
})

describe('TaskCard — прогресс подзадач', () => {
  const parent = mkTask({ id: 'parent', title: 'Родитель', columnId: 'development' })
  const first = mkTask({ id: 'child-1', parentId: 'parent', columnId: 'done' })
  const second = mkTask({ id: 'child-2', parentId: 'parent', columnId: 'development' })

  it('показывает прогресс на любом этапе с числовым и текстовым aria-контрактом', () => {
    render(<TaskCard {...props({
      task: parent,
      allTasks: [parent, first, second],
      doneColumnIds: new Set(['done']),
      columnSemanticType: 'development'
    })} />)

    const progress = screen.getByRole('progressbar', { name: 'Прогресс подзадач' })
    expect(progress).toHaveAttribute('aria-valuemin', '0')
    expect(progress).toHaveAttribute('aria-valuemax', '2')
    expect(progress).toHaveAttribute('aria-valuenow', '1')
    expect(progress).toHaveAttribute('aria-valuetext', 'Выполнено 1 из 2, осталось 1, 50%')
    expect(progress).toHaveTextContent('50%1/2осталось 1')
    expect(progress.querySelector('.jcard-progress-fill')).toHaveStyle({ width: '50%' })
  })

  it('различает нулевой и полный прогресс и не рисует его без подзадач', () => {
    const { rerender } = render(<TaskCard {...props({ task: parent, allTasks: [parent, second], columnSemanticType: 'ready' })} />)
    let progress = screen.getByRole('progressbar')
    expect(progress).toHaveClass('jcard-progress--empty')
    expect(progress).toHaveTextContent('0%0/1осталось 1')

    rerender(<TaskCard {...props({ task: parent, allTasks: [parent, first], doneColumnIds: new Set(['done']), columnSemanticType: 'manual_qa' })} />)
    progress = screen.getByRole('progressbar')
    expect(progress).toHaveClass('jcard-progress--complete')
    expect(progress).toHaveTextContent('100%1/1готово')

    rerender(<TaskCard {...props({ task: parent, allTasks: [parent] })} />)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })
})

describe('TaskCard — время последнего обновления', () => {
  const now = new Date(2026, 8, 11, 18, 0).getTime()

  it('выбирает короткие состояния от текущего момента до старой даты', () => {
    expect(updatedPresentation(now - 20_000, now)).toMatchObject({ short: 'сейчас', state: 'fresh' })
    expect(updatedPresentation(now - 5 * 60_000, now)).toMatchObject({ short: '5 мин', state: 'fresh' })
    expect(updatedPresentation(now - 2 * 3_600_000, now)).toMatchObject({ short: '2 ч', state: 'fresh' })
    expect(updatedPresentation(new Date(2026, 8, 11, 7).getTime(), now)).toMatchObject({ short: 'сегодня', state: 'fresh' })
    expect(updatedPresentation(new Date(2026, 8, 10, 18).getTime(), now)).toMatchObject({ short: 'вчера', state: 'recent' })
    expect(updatedPresentation(new Date(2026, 8, 6, 18).getTime(), now)).toMatchObject({ short: '5 дн', state: 'recent' })
    expect(updatedPresentation(new Date(2026, 7, 20, 18).getTime(), now)).toMatchObject({ short: '20.08', state: 'stale' })
  })

  it('рендерит точное машинное и доступное время вместе с состоянием свежести', () => {
    const updatedAt = Date.now() - 5 * 60_000
    const expected = updatedPresentation(updatedAt)
    render(<TaskCard {...props({ task: mkTask({ updatedAt }) })} />)
    const time = screen.getByLabelText(expected.label)
    expect(time).toHaveAttribute('dateTime', new Date(updatedAt).toISOString())
    expect(time).toHaveAttribute('title', expected.label)
    expect(time).toHaveClass('jcard-updated--fresh')
    expect(time).toHaveTextContent('5 мин')
  })
})


function mkSummary(over: Partial<CiRunSummary> = {}): CiRunSummary {
  return { id: 'run-1', taskId: 't1', status: 'running', error: null, slotProgress: { done: 1, total: 4, phase: 'Модель работает' }, durationMs: null, modelActive: true, awaitingInput: false, ...over }
}

describe('TaskCard связанный чат', () => {
  // Палитра эпиков яркая: как подпись такой цвет не проходит по контрасту
  // (`#00a3bf` давал на карточке 2.6:1 при норме 4.5). Цвет носит только точка.
  it('красит генерируемым цветом точку эпика, а не его подпись', () => {
    const epic = mkTask({ id: 'ep1', type: 'epic', title: 'Платёжная система' })
    render(<TaskCard {...props({ task: mkTask({ parentId: 'ep1' }), allTasks: [epic] })} />)

    const chip = screen.getByTitle('Эпик: Платёжная система')
    expect(chip.style.color).toBe('')
    expect(chip.querySelector('.jcard-epic-dot')!.getAttribute('style')).toMatch(/background/)
  })

  // The visible relative state stays compact while the tooltip preserves the exact date.
  it('подсказка срока показывает полную дату', () => {
    render(<TaskCard {...props({ task: mkTask({ dueDate: Date.UTC(2026, 7, 29, 9) }) })} />)
    expect(screen.getByTitle(/^Срок \d{2}\.\d{2}\.\d{4}\. Просрочено на \d+ /)).toBeInTheDocument()
  })

  it('объясняет срок и метаданные карточки без открытия модалки', () => {
    const now = Date.now()
    render(<TaskCard {...props({
      columnSemanticType: 'development',
      task: mkTask({
        title: 'Проверить платёж',
        priority: 'high',
        assignee: 'alexey.rozhnov',
        storyPoints: 8,
        dueDate: now,
        labels: ['payments', 'ui', 'critical', 'release', 'frontend']
      })
    })} />)

    const card = screen.getByTestId('task-card')
    expect(card).toHaveAttribute('aria-label', expect.stringContaining('PROJ-1. Задача. Проверить платёж'))
    expect(card).toHaveAttribute('aria-label', expect.stringContaining('Приоритет: Высокий'))
    expect(card).toHaveAttribute('aria-label', expect.stringContaining('Исполнитель: alexey.rozhnov'))
    expect(card).toHaveAttribute('aria-label', expect.stringContaining('Срок сегодня'))
    expect(screen.getByRole('img', { name: 'Приоритет: Высокий' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Исполнитель: alexey.rozhnov' })).toBeInTheDocument()
    expect(screen.getByLabelText('Оценка: 8 story points')).toHaveTextContent('8 SP')

    const labels = screen.getByRole('list', { name: 'Метки задачи: payments, ui, critical, release, frontend' })
    expect(within(labels).getAllByRole('listitem')).toHaveLength(4)
    expect(within(labels).getByText('payments')).toBeInTheDocument()
    const more = within(labels).getByLabelText('Ещё 2 метки: release, frontend')
    expect(more).toHaveTextContent('+2')
    expect(more).toHaveAttribute('title', 'Все метки: payments, ui, critical, release, frontend')
    expect(screen.getByLabelText(/^Срок сегодня,/)).toHaveTextContent('Сегодня')
  })

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

  it('кнопка «Параллельно» запускает новый или продвигает queued-ран, блокируя повторный клик', async () => {
    let finish!: () => void
    const onStartCiParallel = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const { rerender } = render(<TaskCard {...props({
      ciSummary: mkSummary({ status: 'queued' }),
      onStartCi: vi.fn(),
      onStartCiParallel
    })} />)
    const parallel = screen.getByRole('button', { name: 'Параллельно' })
    expect(parallel).toHaveAttribute('title', 'Запустить задачу сразу, минуя общую очередь. Машина будет выбрана автоматически с учётом загрузки')
    expect(screen.queryByRole('button', { name: 'В очередь' })).not.toBeInTheDocument()
    fireEvent.click(parallel)
    fireEvent.click(parallel)
    expect(onStartCiParallel).toHaveBeenCalledTimes(1)
    expect(onStartCiParallel).toHaveBeenCalledWith('t1')
    expect(screen.getByRole('button', { name: 'Параллельно' })).toBeDisabled()
    finish()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Параллельно' })).toBeEnabled())

    rerender(<TaskCard {...props({ ciSummary: mkSummary({ status: 'running' }), onStartCi: vi.fn(), onStartCiParallel })} />)
    expect(screen.queryByRole('button', { name: 'Параллельно' })).not.toBeInTheDocument()
  })

  it('показывает сводку рана и открывает ленту', () => {
    const onOpenCiRun = vi.fn()
    const ciSummary: CiRunSummary = { id: 'run-1', taskId: 't1', status: 'running', error: null, slotProgress: { done: 1, total: 4, phase: 'до модели' }, durationMs: null, modelActive: false, awaitingInput: false }
    render(<TaskCard {...props({ ciSummary, onOpenCiRun, onStartCi: vi.fn() })} />)
    expect(screen.getByText('выполняется')).toBeInTheDocument()
    expect(screen.getByText(/до модели · шаг 1 из 4/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Лента рана' }))
    expect(onOpenCiRun).toHaveBeenCalledWith('run-1')
  })

  it('показывает на карточке короткую причину упавшего рана', () => {
    render(<TaskCard {...props({ ciSummary: mkSummary({ status: 'failed', error: 'Машина выполнения офлайн.' }), onOpenCiRun: vi.fn(), onStartCi: vi.fn() })} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Машина выполнения офлайн.')
  })

  it('не выводит на карточке движок и модель', () => {
    render(<TaskCard {...props({ ciSummary: mkSummary({ executionLlm: {
      source: 'stage', stage: 'model_work', llmEngineId: null, provider: 'codex', model: 'gpt-5.6-sol',
      base: { llmEngineId: null, provider: 'codex', model: 'gpt-5.6-luna' }
    } }), onOpenCiRun: vi.fn(), onStartCi: vi.fn() })} />)
    expect(screen.queryByText(/Codex|gpt-5\.6/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Выполняется на|Базовая модель/)).not.toBeInTheDocument()
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

  it('ручное завершение убирает старую ошибку и CI-панель с карточки', () => {
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
    expect(screen.queryByRole('button', { name: 'Лента рана' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('task-ci-panel')).not.toBeInTheDocument()
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
    error: run.error,
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

describe('TaskCard: нормализованная ошибка последнего этапа', () => {
  // @testCase TC-UI-TASK-ERROR-CHAT-DRAFT
  // @testCase TC-REG-NO-GENERAL-CHAT
  it('открывает встроенный AI-чат с диагностическим черновиком, а не общий чат', () => {
    const onOpen = vi.fn()
    const onOpenChat = vi.fn()
    render(<TaskCard {...props({
      onOpen, onOpenChat, ciSummary: mkSummary({ status: 'failed', error: 'Ошибка компиляции', modelActive: false }),
      task: mkTask({ latestRunResult: { id: 'qa-1', kind: 'automated_qa', status: 'blocked', outcome: 'failure', createdAt: 10, finishedAt: 20 } })
    })} />)
    const card = screen.getByTestId('task-card')
    expect(card.className).toContain('jcard--latest-failed')
    const indicator = screen.getByRole('button', { name: 'Последний этап завершился с ошибкой. Открыть AI-чат задачи' })
    expect(indicator).toHaveTextContent('Последний этап завершился с ошибкой')
    fireEvent.click(indicator)
    expect(onOpen).toHaveBeenCalledWith('t1', 'chat', 'Найди в чем причина ошибки по задаче: "Ошибка компиляции"')
    expect(onOpenChat).not.toHaveBeenCalled()
  })

  it.each(['active', 'success', 'cancelled', 'skipped'] as const)('не подсвечивает outcome=%s', (outcome) => {
    render(<TaskCard {...props({ task: mkTask({ latestRunResult: { id: 'run-1', kind: 'development', status: outcome, outcome, createdAt: 10, finishedAt: null } }) })} />)
    expect(screen.getByTestId('task-card').className).not.toContain('jcard--latest-failed')
    expect(screen.queryByText('Последний этап завершился с ошибкой')).not.toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: 'Начать подготовку' }))
    expect(onStartPreparation).toHaveBeenCalledWith('t1')
    expect(screen.queryByRole('button', { name: 'В очередь' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Параллельно' })).not.toBeInTheDocument()
  })

  it('в preparation открывает deep-link вкладки подготовки и не показывает development-действия', () => {
    const onOpen = vi.fn()
    render(<TaskCard {...props({ onOpen, columnSemanticType: 'preparation', task: mkTask({ taskPreparationStatus: 'failed', taskPreparationError: 'Гейт не пройден' }), onStartPreparation: vi.fn(), onStartCi: vi.fn(), onStartCiParallel: vi.fn() })} />)
    expect(screen.getByTestId('task-preparation-panel')).toHaveTextContent('Гейт не пройден')
    fireEvent.click(screen.getByRole('button', { name: 'Подробнее' }))
    expect(onOpen).toHaveBeenCalledWith('t1', 'preparation')
    expect(screen.queryByRole('button', { name: 'В очередь' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Параллельно' })).not.toBeInTheDocument()
  })
})

describe('TaskCard — содержимое по стадиям', () => {
  it('в ready показывает навыки, машину и очередь, но не прошлый ран', () => {
    render(<TaskCard {...props({
      columnSemanticType: 'ready',
      task: mkTask({ skills: ['storybook'], agentId: 'machine-1' }),
      ciSummary: mkSummary({ status: 'success' }),
      onStartCi: vi.fn()
    })} />)
    expect(screen.getByText('storybook')).toBeInTheDocument()
    expect(screen.getByText('Машина: machine-1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'В очередь' })).toBeInTheDocument()
    expect(screen.queryByText('успех')).not.toBeInTheDocument()
  })

  it.each([
    ['component_qa', 'Component QA'],
    ['integration_tests', 'Интеграционные тесты'],
    ['automated_qa', 'Automated QA'],
    ['manual_qa', 'Ручное QA']
  ] as const)('в %s показывает только проверку и вердикт', (columnSemanticType, label) => {
    const { unmount } = render(<TaskCard {...props({
      columnSemanticType,
      task: mkTask({ latestRunResult: { id: 'qa-1', kind: columnSemanticType === 'manual_qa' ? 'manual_qa' : columnSemanticType, status: 'success', outcome: 'success', createdAt: 1, finishedAt: 2 } }),
      ciSummary: mkSummary({ status: 'running' }),
      onStartCi: vi.fn(),
      onStartCiParallel: vi.fn()
    })} />)
    expect(screen.getByTestId('task-qa-run-panel')).toHaveTextContent(label)
    expect(screen.getByText('Пройдено')).toBeInTheDocument()
    expect(screen.queryByTestId('task-ci-panel')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'В очередь' })).not.toBeInTheDocument()
    unmount()
  })

  it('в merge показывает ветку и не показывает запуск разработки', () => {
    render(<TaskCard {...props({
      columnSemanticType: 'merge',
      task: mkTask({ mergeSourceBranch: 'feature/CHAT-375', activeMergeRunId: 'merge-1' }),
      onStartCi: vi.fn(),
      onStartCiParallel: vi.fn()
    })} />)
    expect(screen.getByTestId('task-merge-status')).toHaveTextContent('feature/CHAT-375')
    expect(screen.getByText('Мерж выполняется')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'В очередь' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Параллельно' })).not.toBeInTheDocument()
  })

  it('в Done оставляет одну строку результата и компактную карточку', () => {
    render(<TaskCard {...props({
      columnSemanticType: 'done',
      doneColumnIds: new Set(['done']),
      task: mkTask({
        columnId: 'done',
        title: 'Очень длинный заголовок '.repeat(8),
        mergeSourceBranch: 'feature/CHAT-375',
        doneAt: Date.UTC(2026, 7, 29),
        latestRunResult: { id: 'run-1', kind: 'development', status: 'success', outcome: 'success', createdAt: 1, finishedAt: 2 }
      }),
      ciSummary: mkSummary({ status: 'success', progress: undefined }),
      onStartCi: vi.fn(),
      onStartCiParallel: vi.fn()
    })} />)
    const card = screen.getByTestId('task-card')
    expect(card).toHaveClass('jcard--compact')
    expect(screen.getByTestId('task-done-summary')).toHaveTextContent('feature/CHAT-375')
    expect(screen.getByText(/Очень длинный/)).toHaveAttribute('title')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('task-ci-panel')).not.toBeInTheDocument()
    expect(screen.queryByText(/Текущий этап|Выполняется на|ETA:/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'В очередь' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Переход между этапами')).not.toBeInTheDocument()
  })

  it.each([
    ['cancelled', 'Выполнение остановлено пользователем'],
    ['decision_required', 'Нужен выбор стратегии миграции']
  ] as const)('в %s показывает только причину остановки', (columnSemanticType, reason) => {
    const { unmount } = render(<TaskCard {...props({
      columnSemanticType,
      task: mkTask({ taskPreparationError: reason }),
      ciSummary: mkSummary(),
      onStartCi: vi.fn(),
      onStartCiParallel: vi.fn()
    })} />)
    expect(screen.getByTestId('task-stop-reason')).toHaveTextContent(reason)
    expect(screen.queryByTestId('task-ci-panel')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Переход между этапами')).not.toBeInTheDocument()
    unmount()
  })

  it('остаётся доступной для скринридера', async () => {
    const { container } = render(<TaskCard {...props({ columnSemanticType: 'done', doneColumnIds: new Set(['c1']) })} />)
    await expectNoViolations(container)
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

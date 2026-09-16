// Новая карточка целиком: вкладки отдают панели старой карточки, а доработки
// ходят в мосты черновиков. Представление проверено отдельно
// (`NewTaskCardView.dom.test.tsx`) — здесь именно связка с API.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { render } from '../../test/uiRender'
import { createFakeApi, createFakeCi, type FakeApi } from '@voicechat/ui-foundation/test/fakeApi'
import { makeBoard, makeDefaultColumns, makeTask } from './fixtures'
import { TaskCardContainer } from './TaskCardContainer'
import type { TaskCardContainerProps } from './TaskCardContainer'

let api: FakeApi

function props(over: Partial<TaskCardContainerProps> = {}): TaskCardContainerProps {
  const columns = makeDefaultColumns()
  const column = columns.find((item) => item.semanticType === 'component_qa')!
  // Доработка доступна только после успешной разработки — иначе кнопки нет.
  const task = makeTask({
    id: 'task-1', projectId: 'p1', columnId: column.id, title: 'Голосовые сообщения',
    latestRunResult: { id: 'run-1', kind: 'development', outcome: 'success', status: 'success', createdAt: 1, finishedAt: 2 }
  })
  return {
    task, board: makeBoard(columns, [task]), projectName: 'CHAT', members: [],
    initialVersion: 'new',
    onUpdate: vi.fn(), onDelete: vi.fn(), onMoveToColumn: vi.fn(), onOpenTask: vi.fn(), onClose: vi.fn(),
    ...over
  } as unknown as TaskCardContainerProps
}

beforeEach(() => {
  api = createFakeApi([])
  window.api = api
  window.ci = createFakeCi()
})

describe('TaskCardContainer — новая карточка', () => {
  // @testCase TC3
  it('passes inline statement changes to the existing task update callback', async () => {
    const p = props()
    render(<TaskCardContainer {...p} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Изменить' }))
    fireEvent.change(screen.getByLabelText('Описание'), { target: { value: 'New statement' } })
    fireEvent.change(screen.getByLabelText('Критерии приёмки'), { target: { value: 'New criteria' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(p.onUpdate).toHaveBeenCalledWith(p.task.id, { description: 'New statement', acceptanceCriteria: 'New criteria' }))
  })

  // @testCase TC4
  it('opens and saves the existing draft with unavailable Make paths and attachments intact', async () => {
    const p = props()
    const input = { description: 'Existing draft', criteria: ['Criterion'], makeSources: [{ conversationId: 'design', mode: 'files' as const, paths: ['missing.tsx'] }], uploadIds: [] }
    const raw = await api['tasks:createReworkDraft']({ projectId: p.task.projectId, taskId: p.task.id, input })
    const cycle = { ...raw, makeSources: [{ ...input.makeSources[0]!, id: 'design', title: 'Design', paths: [{ path: 'missing.tsx', available: false }] }], attachments: [{ id: 'attachment-id', taskId: p.task.id, scope: 'rework_draft' as const, checksum: 'checksum', createdBy: 'alex', createdAt: 1, name: 'brief.pdf', size: 12, mimeType: 'application/pdf', status: 'ready' as const }] }
    const save = vi.spyOn(api, 'tasks:updateReworkDraft')
    const files = vi.spyOn(api, 'tasks:reworkMakeFiles').mockResolvedValue([])
    vi.spyOn(api, 'projects:designSources').mockResolvedValue([{ conversationId: 'design', title: 'Design', owner: 'me', own: true, updatedAt: 1 }])
    render(<TaskCardContainer {...p} reworkCycles={[cycle]} loadReworkCycles={async () => [{ ...raw, attachments: cycle.attachments }]} />)
    fireEvent.click(await screen.findByRole('tab', { name: /Доработки/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Изменить' }))
    expect(screen.getByLabelText('Описание доработки')).toHaveValue('Existing draft')
    expect(await screen.findByLabelText('missing.tsx')).toBeChecked()
    expect(screen.getByText('brief.pdf')).toBeInTheDocument()
    expect(files).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ cycleId: cycle.id, input: { ...input, uploadIds: ['attachment-id'] } })))
  })

  // @testCase TC5
  it('opens the feed and announces cancellation only after the confirmed request resolves', async () => {
    const p = props({ ciSummary: { id: 'active', taskId: 'task-1', status: 'running', error: null, slotProgress: { phase: 'model', done: 0, total: 1 }, durationMs: null, modelActive: true, awaitingInput: false } })
    let resolve!: () => void
    const cancel = vi.spyOn(window.ci!, 'cancelRun').mockImplementation(() => new Promise<{ ok: boolean }>((done) => { resolve = () => done({ ok: true }) }))
    render(<TaskCardContainer {...p} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть ленту' }))
    expect(screen.getByRole('tab', { name: /Лента рана/ })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getAllByRole('button', { name: 'Остановить ран' })[0]!)
    fireEvent.click(await screen.findByRole('button', { name: 'Отмена' }))
    expect(cancel).not.toHaveBeenCalled()
    expect(screen.queryByText('Ран остановлен')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'Остановить ран' })[0]!)
    fireEvent.click(await screen.findByRole('button', { name: 'Остановить' }))
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('active'))
    expect(screen.queryByText('Ран остановлен')).toBeNull()
    resolve()
    expect(await screen.findByText('Ран остановлен')).toBeInTheDocument()
  })

  // @testCase TC6
  it('does not announce a rejected cancellation as success', async () => {
    vi.spyOn(window.ci!, 'cancelRun').mockRejectedValue(new Error('Cancel failed'))
    render(<TaskCardContainer {...props({ ciSummary: { id: 'active', taskId: 'task-1', status: 'running', error: null, slotProgress: { phase: 'model', done: 0, total: 1 }, durationMs: null, modelActive: true, awaitingInput: false } })} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Остановить ран' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Остановить' }))
    await waitFor(() => expect(window.ci!.cancelRun).toHaveBeenCalledOnce())
    expect(screen.queryByText('Ран остановлен')).toBeNull()
  })

  it('вкладки отдают панели старой карточки', async () => {
    render(<TaskCardContainer {...props()} />)
    fireEvent.click(await screen.findByRole('tab', { name: /Настройки/ }))
    // Панель настроек — тот же CiTaskSettings, что и в старой карточке.
    expect(await screen.findByLabelText('Машина выполнения')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Ход выполнения/ }))
    // Ход выполнения — рейка development-циклов; без ранов первый этап ждёт.
    expect(await screen.findByText('Этапы выполнения')).toBeInTheDocument()
    expect(screen.getByText('Development-ран этого этапа ещё не запускался.')).toBeInTheDocument()
    // Временная шкала старой карточки доступна разделом.
    fireEvent.click(screen.getByRole('button', { name: 'Временная шкала' }))
    expect(await screen.findByText('Этапов пока нет')).toBeInTheDocument()
  })

  it('запоминает выбранную версию карточки в браузере', async () => {
    window.localStorage.removeItem('vc.taskCard.version')
    const { unmount } = render(<TaskCardContainer {...props({ initialVersion: undefined })} />)
    // Без сохранённого выбора открывается старая карточка.
    expect(await screen.findByTestId('task-modal')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Новая' }))
    expect(await screen.findByRole('tab', { name: 'Общее' })).toBeInTheDocument()
    expect(window.localStorage.getItem('vc.taskCard.version')).toBe('new')
    unmount()
    render(<TaskCardContainer {...props({ initialVersion: undefined })} />)
    expect(await screen.findByRole('tab', { name: 'Общее' })).toBeInTheDocument()
    window.localStorage.removeItem('vc.taskCard.version')
  })

  it('связывает Make-дизайн из карточки и обновляет задачу', async () => {
    const link = vi.spyOn(api, 'tasks:linkDesign')
    vi.spyOn(api, 'projects:designSources').mockResolvedValue([{ conversationId: 'make-19', title: 'Проект 19', owner: 'me', own: true, updatedAt: 1 }])
    const p = props()
    render(<TaskCardContainer {...p} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Связать дизайн' }))
    await screen.findByLabelText('Make-проект')
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить связь' }))
    await waitFor(() => expect(link).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task-1', mode: 'whole_project', paths: [] })))
    await waitFor(() => expect(p.onUpdate).toHaveBeenCalledWith('task-1', {}))
  })

  it('отправляет несколько черновиков одним циклом: слияние, удаление лишних, отправка', async () => {
    const update = vi.spyOn(api, 'tasks:updateReworkDraft')
    const remove = vi.spyOn(api, 'tasks:deleteReworkDraft')
    const submit = vi.spyOn(api, 'tasks:submitReworkDraft')
    render(<TaskCardContainer {...props()} />)
    for (const text of ['Первая правка', 'Вторая правка']) {
      fireEvent.click((await screen.findAllByRole('button', { name: /На доработку/ }))[0]!)
      fireEvent.change(screen.getByLabelText('Описание доработки'), { target: { value: text } })
      fireEvent.click(screen.getByRole('button', { name: 'Сохранить как черновик' }))
      await waitFor(() => expect(screen.queryByLabelText('Описание доработки')).toBeNull())
    }
    fireEvent.click(screen.getByRole('tab', { name: /Доработки/ }))
    fireEvent.click(await screen.findByLabelText('Выбрать все доступные'))
    fireEvent.click(screen.getByRole('button', { name: 'Отправить выбранные на доработку' }))
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ description: expect.stringContaining('Вторая правка') }) }))
    expect(remove).toHaveBeenCalledTimes(1)
    // Один цикл в истории, очередь пуста.
    await waitFor(() => expect(screen.getByText('1 цикл')).toBeInTheDocument())
  })

  // @testCase TC-REG-TASK-CHAT-LEGACY-NEW
  it('рендерит task-chat surface с docked-композером в новой карточке', async () => {
    window.api = {
      ...api,
      'tasks:openChat': vi.fn(async () => ({ id: 'chat-1' } as never)),
      'conversations:get': vi.fn(async () => ({ conversation: { id: 'chat-1' }, messages: [] })) as never
    }
    render(<TaskCardContainer {...props()} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'AI-чат' }))
    expect(await screen.findByTestId('task-chat-surface')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Поле ввода сообщения' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Прикрепить файл' })).toBeInTheDocument()
  })

  // @testCase TC-REG-NON-TASK-SURFACES
  it('оставляет вкладку настроек задач отдельной от task-чата', async () => {
    render(<TaskCardContainer {...props()} />)
    fireEvent.click(await screen.findByRole('tab', { name: /Настройки/ }))
    expect(await screen.findByLabelText('Машина выполнения')).toBeInTheDocument()
    expect(screen.queryByTestId('task-chat-surface')).not.toBeInTheDocument()
  })

  it('сохраняет черновик доработки, показывает его во вкладке и отправляет', async () => {
    const create = vi.spyOn(api, 'tasks:createReworkDraft')
    const submit = vi.spyOn(api, 'tasks:submitReworkDraft')
    render(<TaskCardContainer {...props()} />)

    // Форма доработки: описание → сохранение черновика.
    fireEvent.click((await screen.findAllByRole('button', { name: /На доработку/ }))[0]!)
    fireEvent.change(screen.getByLabelText('Описание доработки'), { target: { value: 'Починить статус синхронизации' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить как черновик' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-1', input: expect.objectContaining({ description: 'Починить статус синхронизации' })
    })))

    // Черновик виден на своей вкладке вместе со счётчиком.
    fireEvent.click(screen.getByRole('tab', { name: /Доработки/ }))
    const row = await screen.findByText('Починить статус синхронизации')
    expect(within(row.closest('article')!).getByText('Черновик')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Отправить на доработку' }))
    await waitFor(() => expect(submit).toHaveBeenCalled())
    // После отправки цикл неизменяем: действий у строки больше нет.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Отправить на доработку' })).toBeNull())
  })

  it('удаляет черновик через мост', async () => {
    const remove = vi.spyOn(api, 'tasks:deleteReworkDraft')
    render(<TaskCardContainer {...props()} />)
    fireEvent.click((await screen.findAllByRole('button', { name: /На доработку/ }))[0]!)
    fireEvent.change(screen.getByLabelText('Описание доработки'), { target: { value: 'Лишняя доработка' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить как черновик' }))
    fireEvent.click(await screen.findByRole('tab', { name: /Доработки/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(remove).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText('Лишняя доработка')).toBeNull())
  })
})

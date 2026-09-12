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
  // @testCase TC-UI-01
  it('opens independent settings and progress views through the container', async () => {
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

  // @testCase TC-REG-01
  it('запоминает выбранную версию карточки в браузере', async () => {
    window.localStorage.removeItem('vc.taskCard.version')
    const update = vi.spyOn(api, 'tasks:update')
    const options = props({ initialVersion: undefined })
    const { unmount } = render(<TaskCardContainer {...options} />)
    // Без сохранённого выбора открывается старая карточка.
    expect(await screen.findByTestId('task-modal')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Новая' }))
    expect(await screen.findByRole('tab', { name: 'Общее' })).toBeInTheDocument()
    expect(window.localStorage.getItem('vc.taskCard.version')).toBe('new')
    expect(update).not.toHaveBeenCalled()
    expect(options.onUpdate).not.toHaveBeenCalled()
    unmount()
    render(<TaskCardContainer {...props({ initialVersion: undefined })} />)
    expect(await screen.findByRole('tab', { name: 'Общее' })).toBeInTheDocument()
    window.localStorage.removeItem('vc.taskCard.version')
  })

  // @testCase TC-INT-01
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

  // @testCase TC-INT-01
  it('отправляет несколько черновиков одним циклом: слияние, удаление лишних, отправка', async () => {
    const update = vi.spyOn(api, 'tasks:updateReworkDraft')
    const remove = vi.spyOn(api, 'tasks:deleteReworkDraft')
    const submit = vi.spyOn(api, 'tasks:submitReworkDraft')
    render(<TaskCardContainer {...props()} />)
    for (const text of ['Первая правка', 'Вторая правка', 'Оставить в очереди']) {
      fireEvent.click((await screen.findAllByRole('button', { name: /На доработку/ }))[0]!)
      fireEvent.change(screen.getByLabelText('Описание доработки'), { target: { value: text } })
      fireEvent.click(screen.getByRole('button', { name: 'Сохранить как черновик' }))
      await waitFor(() => expect(screen.queryByLabelText('Описание доработки')).toBeNull())
    }
    fireEvent.click(screen.getByRole('tab', { name: /Доработки/ }))
    fireEvent.click(await screen.findByLabelText('Выбрать Первая правка'))
    fireEvent.click(screen.getByLabelText('Выбрать Вторая правка'))
    fireEvent.click(screen.getByRole('button', { name: 'Отправить выбранные на доработку' }))
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ description: expect.stringContaining('Вторая правка') }) }))
    expect(remove).toHaveBeenCalledTimes(1)
    // One submitted cycle; the unselected draft retains its own contents.
    await waitFor(() => expect(screen.getByText('1 цикл')).toBeInTheDocument())
    expect(screen.getByText('Оставить в очереди')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Отправить на доработку' })).toBeInTheDocument()
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

  // @testCase TC-INT-01
  it('validates Make files and persists exactly the selected paths', async () => {
    vi.spyOn(api, 'projects:designSources').mockResolvedValue([{ conversationId: 'make-19', title: 'Проект 19', owner: 'me', own: true, updatedAt: 1 }])
    vi.spyOn(api, 'tasks:reworkMakeFiles').mockResolvedValue([{ path: 'src/App.jsx' }, { path: 'styles.css' }] as never)
    const link = vi.spyOn(api, 'tasks:linkDesign')
    render(<TaskCardContainer {...props()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Связать дизайн' }))
    fireEvent.click(await screen.findByLabelText('Выбранные файлы'))
    expect(screen.getByRole('button', { name: 'Сохранить связь' })).toBeDisabled()
    fireEvent.click(await screen.findByLabelText('src/App.jsx'))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить связь' }))
    await waitFor(() => expect(link).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'make-19', mode: 'files', paths: ['src/App.jsx'] })))
  })

  // @testCase TC-NEG-01
  it('shows the actual Make links after unlink succeeds and replacement fails', async () => {
    const previous = { id: 'old-link', conversationId: 'old-make', label: 'Old Make', conversationTitle: 'Old Make', mode: 'whole_project', paths: [] }
    const designs = vi.spyOn(api, 'tasks:designs').mockResolvedValueOnce([previous] as never).mockResolvedValue([])
    vi.spyOn(api, 'projects:designSources').mockResolvedValue([{ conversationId: 'new-make', title: 'New Make', owner: 'me', own: true, updatedAt: 1 }])
    const unlink = vi.spyOn(api, 'tasks:unlinkDesign').mockResolvedValue([])
    const link = vi.spyOn(api, 'tasks:linkDesign').mockRejectedValue(new Error('409: Make replacement failed'))
    render(<TaskCardContainer {...props()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Заменить' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить связь' }))
    await waitFor(() => expect(link).toHaveBeenCalledTimes(1))
    expect(unlink).toHaveBeenCalledWith(expect.objectContaining({ linkId: 'old-link' }))
    await waitFor(() => expect(designs).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('409: Make replacement failed')).toBeInTheDocument()
    expect(screen.queryByText('Old Make')).toBeNull()
  })

  // @testCase TC-NEG-01
  it('reloads drafts after a partial batch failure without claiming submission', async () => {
    for (const description of ['Keep first', 'Keep second']) await api['tasks:createReworkDraft']({
      projectId: 'p1', taskId: 'task-1', input: { description, criteria: ['Preserve criteria'], makeSources: [], uploadIds: [] }
    })
    const remove = vi.spyOn(api, 'tasks:deleteReworkDraft').mockRejectedValue(new Error('Delete failed'))
    const submit = vi.spyOn(api, 'tasks:submitReworkDraft')
    const reload = vi.spyOn(api, 'tasks:reworkCycles')
    render(<TaskCardContainer {...props()} />)
    fireEvent.click(await screen.findByRole('tab', { name: /Доработки/ }))
    fireEvent.click(await screen.findByLabelText('Выбрать все доступные'))
    const send = screen.getByRole('button', { name: 'Отправить выбранные на доработку' })
    fireEvent.click(send); fireEvent.click(send)
    await screen.findByText('Delete failed')
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(2))
    expect(remove).toHaveBeenCalledTimes(1)
    expect(submit).not.toHaveBeenCalled()
    expect(screen.getByText('0 циклов')).toBeInTheDocument()
    expect(screen.getByText('Keep second')).toBeInTheDocument()
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

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
  it('вкладки отдают панели старой карточки', async () => {
    render(<TaskCardContainer {...props()} />)
    fireEvent.click(await screen.findByRole('tab', { name: /Настройки/ }))
    // Панель настроек — тот же CiTaskSettings, что и в старой карточке.
    expect(await screen.findByLabelText('Машина выполнения')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Ход выполнения/ }))
    // Панель хода выполнения — TaskTimeline: без данных он показывает пустое состояние.
    expect(await screen.findByText('Этапов пока нет')).toBeInTheDocument()
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
    fireEvent.click(await screen.findByRole('button', { name: /На доработку/ }))
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
    fireEvent.click(await screen.findByRole('button', { name: /На доработку/ }))
    fireEvent.change(screen.getByLabelText('Описание доработки'), { target: { value: 'Лишняя доработка' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить как черновик' }))
    fireEvent.click(await screen.findByRole('tab', { name: /Доработки/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(remove).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText('Лишняя доработка')).toBeNull())
  })
})

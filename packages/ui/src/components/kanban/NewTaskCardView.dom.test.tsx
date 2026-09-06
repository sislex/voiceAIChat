import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NewTaskCardView } from './NewTaskCardView'
import { render as renderWithProviders } from '../../test/uiRender'
import { TaskCardContainer, type TaskCardContainerProps } from './TaskCardContainer'
import type { TaskCardCallbacks, TaskCardViewModel, TaskReworkCycleViewModel, TaskReworkDraft } from './TaskCardViewModel'

const draft: TaskReworkDraft = { description: '', criteria: [], makeMode: 'whole_project', makePaths: [], attachments: [] }
const model: TaskCardViewModel = {
  taskId: 'task-1', taskKey: 'CHAT-19', projectName: 'Проект', title: 'Новая карточка',
  stage: { semanticType: 'component_qa', label: 'Component QA', fallback: false },
  priority: 'high', assignee: 'alex', description: 'Текущее описание', acceptanceCriteria: '1. Работает', labels: [],
  workflow: [{ id: 'development', semanticType: 'development', label: 'Разработка', state: 'passed' }, { id: 'component_qa', semanticType: 'component_qa', label: 'Component QA', state: 'current' }],
  runs: [{ id: 'run-1', title: 'Разработка', status: 'success', outcome: 'success', createdAt: 1, finishedAt: 2, canOpen: true, canCancel: false, canAnswer: false }],
  source: { description: 'Исходное ТЗ', acceptanceCriteria: '1. Исходный критерий', attachments: [] },
  makeSources: [{ id: 'make-1', title: 'Проект 19', conversationId: 'make-19', mode: 'files', paths: [{ path: 'src/App.jsx', available: true }, { path: 'missing.jsx', available: false, error: 'Удалён' }] }],
  cycles: [], loadState: 'ready',
  actions: { canRework: true, hasActiveRun: false, safeActiveRunActions: [] }
}
function callbacks(over: Partial<TaskCardCallbacks> = {}): TaskCardCallbacks {
  return { onClose: vi.fn(), onChangeTab: vi.fn(), onOpenRun: vi.fn(), onOpenMake: vi.fn(), onStartRework: vi.fn(), onChangeReworkDraft: vi.fn(), onSubmitRework: vi.fn(), onCancelRework: vi.fn(), ...over }
}

describe('NewTaskCardView', () => {
  it('работает только через view model и callbacks', () => {
    const cb = callbacks()
    render(<NewTaskCardView model={model} activeTab="overview" version="new" reworkOpen={false} reworkDraft={draft} onVersionChange={vi.fn()} callbacks={cb} />)
    expect(screen.getByText('Исходное ТЗ')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'На доработку' }))
    expect(cb.onStartRework).toHaveBeenCalledOnce()
  })
  // @testCase TC-UI-1
  it('передаёт заполненный черновик формы доработки', () => {
    const cb = callbacks()
    const { rerender } = render(<NewTaskCardView model={model} activeTab="overview" version="new" reworkOpen reworkDraft={draft} onVersionChange={vi.fn()} callbacks={cb} />)

    fireEvent.change(screen.getByLabelText('Описание доработки'), { target: { value: 'Исправить вложения' } })
    expect(cb.onChangeReworkDraft).toHaveBeenLastCalledWith({ ...draft, description: 'Исправить вложения' })

    const described = { ...draft, description: 'Исправить вложения' }
    rerender(<NewTaskCardView model={model} activeTab="overview" version="new" reworkOpen reworkDraft={described} onVersionChange={vi.fn()} callbacks={cb} />)
    fireEvent.change(screen.getByLabelText('Дополнительный критерий'), { target: { value: 'Файл отображается' } })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))
    expect(cb.onChangeReworkDraft).toHaveBeenLastCalledWith({ ...described, criteria: ['Файл отображается'] })

    const withCriterion = { ...described, criteria: ['Файл отображается'] }
    rerender(<NewTaskCardView model={model} activeTab="overview" version="new" reworkOpen reworkDraft={withCriterion} onVersionChange={vi.fn()} callbacks={cb} />)
    fireEvent.click(screen.getByLabelText('Отдельные файлы'))
    expect(cb.onChangeReworkDraft).toHaveBeenLastCalledWith({ ...withCriterion, makeMode: 'files' })
    expect(screen.getByRole('button', { name: 'Создать цикл' })).toBeEnabled()
  })

  // @testCase TC-UI-2
  it('показывает пустое состояние и типизированные вложения', () => {
    const { rerender } = render(<NewTaskCardView model={model} activeTab="files" version="new" reworkOpen={false} reworkDraft={draft} onVersionChange={vi.fn()} callbacks={callbacks()} />)
    expect(screen.getByText('Файлов пока нет')).toBeInTheDocument()

    const attachments = [
      { id: 'pdf', name: 'brief.pdf', mimeType: 'application/pdf', status: 'ready' as const },
      { id: 'png', name: 'screen.png', mimeType: 'image/png', status: 'uploading' as const },
      { id: 'txt', name: 'error.txt', mimeType: 'text/plain', status: 'error' as const, error: 'Не удалось прочитать' },
      { id: 'docx', name: 'missing.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', status: 'missing' as const }
    ]
    rerender(<NewTaskCardView model={{ ...model, source: { ...model.source, attachments } }} activeTab="files" version="new" reworkOpen reworkDraft={{ ...draft, attachments }} onVersionChange={vi.fn()} callbacks={callbacks()} />)
    for (const file of attachments) expect(screen.getAllByText(file.name).length).toBeGreaterThan(0)
    expect(screen.getAllByText('application/pdf').length).toBeGreaterThan(0)
    expect(screen.getAllByText('image/png').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Не удалось прочитать').length).toBeGreaterThan(0)
    expect(screen.getAllByText('application/vnd.openxmlformats-officedocument.wordprocessingml.document').length).toBeGreaterThan(0)
  })

  // @testCase TC-UI-3
  it('показывает пустую и заполненную историю циклов', () => {
    const cb = callbacks()
    const { rerender } = render(<NewTaskCardView model={model} activeTab="history" version="new" reworkOpen={false} reworkDraft={draft} onVersionChange={vi.fn()} callbacks={cb} />)
    expect(screen.getByText('Доработок пока не было')).toBeInTheDocument()

    const cycle = { id: 'cycle-2', sequence: 2, description: 'Уточнить мобильное поведение', criteria: [], makeSources: [], attachments: [], createdBy: 'alex', createdAt: Date.UTC(2026, 0, 2, 12), preparationRunId: null }
    rerender(<NewTaskCardView model={{ ...model, cycles: [cycle] }} activeTab="history" version="new" reworkOpen={false} reworkDraft={draft} onVersionChange={vi.fn()} callbacks={cb} />)
    expect(screen.getByText('Цикл 2')).toBeInTheDocument()
    expect(screen.getByText('Уточнить мобильное поведение')).toBeInTheDocument()
    expect(screen.getAllByText(/alex/).length).toBeGreaterThan(0)
  })

  // @testCase TC-NEG-1
  it('не подтверждает пустое описание или доработку при активном ране', () => {
    const submit = vi.fn()
    const cb = callbacks({ onSubmitRework: submit })
    const { rerender } = render(<NewTaskCardView model={model} activeTab="overview" version="new" reworkOpen reworkDraft={{ ...draft, description: '   ' }} onVersionChange={vi.fn()} callbacks={cb} />)
    expect(screen.getByRole('button', { name: 'Создать цикл' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Создать цикл' }))
    expect(submit).not.toHaveBeenCalled()

    rerender(<NewTaskCardView model={{ ...model, actions: { canRework: true, hasActiveRun: true, reworkBlockedReason: 'Ран активен', safeActiveRunActions: ['keep_running'] } }} activeTab="overview" version="new" reworkOpen reworkDraft={{ ...draft, description: 'Правка' }} onVersionChange={vi.fn()} callbacks={cb} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Ран активен')
    fireEvent.click(screen.getByRole('button', { name: 'Создать цикл' }))
    expect(submit).not.toHaveBeenCalled()
  })
})

function containerProps(over: Partial<TaskCardContainerProps> = {}): TaskCardContainerProps {
  const task = {
    id: 'task-1', projectId: 'project-1', columnId: 'component-qa', type: 'task', parentId: null,
    title: 'Карточка', description: 'Описание', acceptanceCriteria: 'Готово', priority: 'medium',
    assignee: 'alex', labels: [], skills: [], storyPoints: null, dueDate: null, flagged: false,
    seq: 1, position: 1024, createdAt: 1, updatedAt: 1,
    latestRunResult: { id: 'run-1', kind: 'development', outcome: 'success', status: 'success', createdAt: 1, finishedAt: 2 }
  }
  return {
    task,
    board: { id: 'board-1', projectId: 'project-1', tasks: [task], columns: [{ id: 'component-qa', name: 'Component QA', position: 1, semanticType: 'component_qa' }] },
    projectName: 'CHAT',
    members: [],
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    onMoveToColumn: vi.fn(),
    onOpenTask: vi.fn(),
    onClose: vi.fn(),
    initialVersion: 'new',
    ...over
  } as unknown as TaskCardContainerProps
}

const createdCycle: TaskReworkCycleViewModel = {
  id: 'cycle-1',
  sequence: 1,
  description: 'Исправить вложения',
  criteria: ['Файл отображается'],
  makeSources: [],
  attachments: [{ id: 'result-1', name: 'result.pdf', mimeType: 'application/pdf', status: 'ready' }],
  createdBy: 'alex',
  createdAt: Date.UTC(2026, 0, 2, 12),
  preparationRunId: null
}

function openAndDescribe(description = createdCycle.description): void {
  fireEvent.click(screen.getByRole('button', { name: 'На доработку' }))
  fireEvent.change(screen.getByLabelText('Описание доработки'), { target: { value: description } })
}

describe('TaskCardContainer rework orchestration', () => {
  // @testCase TC-API-1
  it('передаёт taskId, полный draft и idempotencyKey в callback создания', async () => {
    const onCreateReworkCycle = vi.fn().mockResolvedValue(createdCycle)
    renderWithProviders(<TaskCardContainer {...containerProps({ onCreateReworkCycle })} />)

    openAndDescribe()
    fireEvent.change(screen.getByLabelText('Дополнительный критерий'), { target: { value: 'Файл отображается' } })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))
    fireEvent.click(screen.getByLabelText('Отдельные файлы'))
    fireEvent.click(screen.getByRole('button', { name: 'Создать цикл' }))

    await waitFor(() => expect(onCreateReworkCycle).toHaveBeenCalledOnce())
    const [taskId, submittedDraft, key] = onCreateReworkCycle.mock.calls[0]!
    expect(taskId).toBe('task-1')
    expect(submittedDraft).toEqual({ description: 'Исправить вложения', criteria: ['Файл отображается'], makeMode: 'files', makePaths: [], attachments: [] })
    expect(key).toMatch(/^rework-task-1-\d+$/)
  })

  // @testCase TC-API-2
  it('дедуплицирует успешный результат и сбрасывает форму', async () => {
    const onCreateReworkCycle = vi.fn().mockResolvedValue(createdCycle)
    renderWithProviders(<TaskCardContainer {...containerProps({ onCreateReworkCycle })} />)

    openAndDescribe()
    fireEvent.click(screen.getByRole('button', { name: 'Создать цикл' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новый цикл доработки' })).not.toBeInTheDocument())

    openAndDescribe()
    fireEvent.click(screen.getByRole('button', { name: 'Создать цикл' }))
    await waitFor(() => expect(onCreateReworkCycle).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новый цикл доработки' })).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'История доработок' }))

    expect(screen.getAllByText('Цикл 1')).toHaveLength(1)
    openAndDescribe('Новый текст')
    expect(screen.getByLabelText('Описание доработки')).toHaveValue('Новый текст')
  })

  // @testCase TC-NEG-2
  it('оставляет форму открытой и сообщает об отсутствующем или упавшем callback', async () => {
    const { unmount } = renderWithProviders(<TaskCardContainer {...containerProps()} />)
    openAndDescribe()
    fireEvent.click(screen.getByRole('button', { name: 'Создать цикл' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Создание цикла пока недоступно')
    expect(screen.getByRole('dialog', { name: 'Новый цикл доработки' })).toBeInTheDocument()
    unmount()

    const rejected = vi.fn().mockRejectedValue(new Error('Сервис недоступен'))
    renderWithProviders(<TaskCardContainer {...containerProps({ onCreateReworkCycle: rejected })} />)
    openAndDescribe()
    fireEvent.click(screen.getByRole('button', { name: 'Создать цикл' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Сервис недоступен')
    expect(screen.getByRole('button', { name: 'Создать цикл' })).toBeEnabled()
    expect(screen.getByRole('dialog', { name: 'Новый цикл доработки' })).toBeInTheDocument()
  })

  // @testCase TC-INT-1
  it('локально добавляет созданный цикл с вложением без мутации Task', async () => {
    const input = containerProps({ onCreateReworkCycle: vi.fn().mockResolvedValue(createdCycle) })
    const snapshot = structuredClone(input.task)
    renderWithProviders(<TaskCardContainer {...input} />)

    openAndDescribe()
    fireEvent.click(screen.getByRole('button', { name: 'Создать цикл' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новый цикл доработки' })).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'История доработок' }))
    expect(screen.getByText('Цикл 1')).toBeInTheDocument()
    expect(screen.getByText('Исправить вложения')).toBeInTheDocument()
    expect(input.task).toEqual(snapshot)
  })

  // @testCase TC-REG-1
  it('переключает new и legacy локально, не меняя доменную задачу', () => {
    const onUpdate = vi.fn()
    const input = containerProps({ initialVersion: 'legacy', onUpdate })
    const snapshot = structuredClone(input.task)
    renderWithProviders(<TaskCardContainer {...input} />)

    fireEvent.click(screen.getByRole('button', { name: 'Новая' }))
    expect(screen.getByRole('dialog', { name: 'Задача CHAT-1' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Старая' }))
    expect(screen.getByTestId('task-modal')).toBeInTheDocument()
    expect(onUpdate).not.toHaveBeenCalled()
    expect(input.task).toEqual(snapshot)
  })
})

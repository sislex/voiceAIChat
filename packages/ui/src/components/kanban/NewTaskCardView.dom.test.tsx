import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NewTaskCardView } from './NewTaskCardView'
import type { TaskCardCallbacks, TaskCardViewModel, TaskReworkDraft } from './TaskCardViewModel'

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
  // @testCase TC-REG-1
  it('переключает представление без доменной мутации', () => {
    const change = vi.fn()
    render(<NewTaskCardView model={model} activeTab="overview" version="new" reworkOpen={false} reworkDraft={draft} onVersionChange={change} callbacks={callbacks()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Старая' }))
    expect(change).toHaveBeenCalledWith('legacy')
  })
  // @testCase TC-UI-1
  it('показывает loading, error с retry и empty для Make-источников', () => {
    const retry = vi.fn()
    const view = (state: 'loading' | 'error' | 'empty') => <NewTaskCardView model={model} activeTab="overview" version="new" reworkOpen reworkDraft={draft} makeSourcesState={{ state, items: [], ...(state === 'error' ? { error: 'Make недоступен' } : {}) }} onVersionChange={vi.fn()} callbacks={callbacks({ onRetryMakeSources: retry })} />
    const { rerender } = render(view('loading'))
    expect(screen.getByRole('status')).toHaveTextContent('Загружаем Make-проекты')
    rerender(view('error')); fireEvent.click(screen.getByRole('button', { name: 'Повторить' })); expect(retry).toHaveBeenCalledOnce()
    rerender(view('empty')); expect(screen.getByText('Нет доступных Make-проектов')).toBeTruthy()
  })

  // @testCase TC-UI-2
  it('собирает независимый выбор целого проекта и файлов', async () => {
    const change = vi.fn()
    const submit = vi.fn()
    const cb = callbacks({ onChangeReworkDraft: change, onSubmitRework: submit, onLoadMakeFiles: async () => ['src/App.tsx', 'src/styles.css'] })
    const sources = { state: 'ready' as const, items: [{ conversationId: 'a', title: 'A', owner: 'me', own: true, updatedAt: 1 }, { conversationId: 'b', title: 'B', owner: 'me', own: true, updatedAt: 1 }] }
    const view = (value: TaskReworkDraft) => <NewTaskCardView model={model} activeTab="overview" version="new" reworkOpen reworkDraft={value} makeSourcesState={sources} onVersionChange={vi.fn()} callbacks={cb} />
    const { rerender } = render(view(draft))
    fireEvent.click(screen.getByLabelText('A'))
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ makeSources: [{ conversationId: 'a', mode: 'whole_project', paths: [] }] }))

    const whole = { ...draft, description: 'Правка', makeSources: [{ conversationId: 'a', mode: 'whole_project' as const, paths: [] }, { conversationId: 'b', mode: 'whole_project' as const, paths: [] }] }
    rerender(view(whole))
    fireEvent.click(screen.getAllByLabelText('Отдельные файлы')[1]!)
    const onePath = { ...whole, makeSources: [whole.makeSources[0]!, { conversationId: 'b', mode: 'files' as const, paths: [] }] }
    rerender(view(onePath))
    expect(await screen.findByLabelText('src/App.tsx')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('src/App.tsx'))
    const twoPaths = { ...onePath, makeSources: [onePath.makeSources[0]!, { conversationId: 'b', mode: 'files' as const, paths: ['src/App.tsx'] }] }
    rerender(view(twoPaths))
    fireEvent.click(screen.getByLabelText('src/styles.css'))
    const ready = { ...twoPaths, makeSources: [twoPaths.makeSources[0]!, { conversationId: 'b', mode: 'files' as const, paths: ['src/App.tsx', 'src/styles.css'] }] }
    rerender(view(ready))
    fireEvent.click(screen.getByRole('button', { name: 'Создать цикл' }))
    expect(submit).toHaveBeenCalledWith(ready, expect.stringMatching(/^rework-task-1-/))
  })

  // @testCase TC-UI-3
  it('загружает и удаляет вложения задачи и черновика', () => {
    const upload = vi.fn(); const remove = vi.fn()
    render(<NewTaskCardView model={{ ...model, source: { ...model.source, attachments: [{ id: 'old', name: 'brief.pdf', status: 'ready' }] } }} activeTab="overview" version="new" reworkOpen reworkDraft={{ ...draft, attachments: [{ id: 'draft', name: 'shot.png', status: 'ready' }] }} makeSourcesState={{ state: 'empty', items: [] }} onVersionChange={vi.fn()} callbacks={callbacks({ onUploadAttachment: upload, onDeleteAttachment: remove })} />)
    fireEvent.change(screen.getByLabelText('Добавить вложение цикла'), { target: { files: [new File(['x'], 'new.png', { type: 'image/png' })] } })
    expect(upload).toHaveBeenCalledWith('rework_draft', expect.objectContaining({ name: 'new.png' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Удалить' })[0]!); expect(remove).toHaveBeenCalled()
  })

  // @testCase TC-NEG-1
  it('при активном ране не подтверждает доработку', () => {
    const submit = vi.fn()
    render(<NewTaskCardView model={{ ...model, actions: { canRework: true, hasActiveRun: true, reworkBlockedReason: 'Ран активен', safeActiveRunActions: ['keep_running'] } }} activeTab="overview" version="new" reworkOpen reworkDraft={{ ...draft, description: 'Правка' }} onVersionChange={vi.fn()} callbacks={callbacks({ onSubmitRework: submit })} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Ран активен')
    fireEvent.click(screen.getByRole('button', { name: 'Создать цикл' }))
    expect(submit).not.toHaveBeenCalled()
  })
})

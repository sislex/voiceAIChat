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
  it('переключает представление без доменной мутации', () => {
    const change = vi.fn()
    render(<NewTaskCardView model={model} activeTab="overview" version="new" reworkOpen={false} reworkDraft={draft} onVersionChange={change} callbacks={callbacks()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Старая' }))
    expect(change).toHaveBeenCalledWith('legacy')
  })
  it('при активном ране не подтверждает доработку', () => {
    const submit = vi.fn()
    render(<NewTaskCardView model={{ ...model, actions: { canRework: true, hasActiveRun: true, reworkBlockedReason: 'Ран активен', safeActiveRunActions: ['keep_running'] } }} activeTab="overview" version="new" reworkOpen reworkDraft={{ ...draft, description: 'Правка' }} onVersionChange={vi.fn()} callbacks={callbacks({ onSubmitRework: submit })} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Ран активен')
    fireEvent.click(screen.getByRole('button', { name: 'Создать цикл' }))
    expect(submit).not.toHaveBeenCalled()
  })
})

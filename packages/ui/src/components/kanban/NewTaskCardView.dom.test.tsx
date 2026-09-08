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
  cycles: [], drafts: [], loadState: 'ready',
  cycleNumber: 1, nextCycleNumber: 2, branch: null, commit: null,
  tabs: [{ id: 'overview', label: 'Общее' }, { id: 'reworks', label: 'Доработки' }],
  actions: { canRework: true, hasActiveRun: false, canStopRun: false, safeActiveRunActions: [] }
}
function callbacks(over: Partial<TaskCardCallbacks> = {}): TaskCardCallbacks {
  return { onClose: vi.fn(), onChangeTab: vi.fn(), onOpenRun: vi.fn(), onOpenMake: vi.fn(), onStartRework: vi.fn(), onChangeReworkDraft: vi.fn(), onSubmitRework: vi.fn(), onCancelRework: vi.fn(), ...over }
}

describe('NewTaskCardView', () => {
  it('работает только через view model и callbacks', () => {
    const cb = callbacks()
    render(<NewTaskCardView model={model} activeTab="overview" version="new" reworkOpen={false} reworkDraft={draft} onVersionChange={vi.fn()} callbacks={cb} />)
    // Первоначальная постановка свёрнута: на экране актуальная, исходная — по кнопке.
    expect(screen.queryByText('Исходное ТЗ')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Показать' }))
    expect(screen.getByText('Исходное ТЗ')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '↩ На доработку · цикл 2' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить как черновик' }))
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
  it('при активном ране предупреждает, но черновик сохранить даёт', () => {
    const submit = vi.fn()
    const stop = vi.fn()
    const activeModel = { ...model, actions: { canRework: true, hasActiveRun: true, canStopRun: true, reworkBlockedReason: 'Ран активен', safeActiveRunActions: ['keep_running' as const] } }
    render(<NewTaskCardView model={activeModel} activeTab="overview" version="new" reworkOpen reworkDraft={{ ...draft, description: 'Правка' }} onVersionChange={vi.fn()} callbacks={callbacks({ onSubmitRework: submit, onStopRun: stop })} />)
    // Баннер в шапке объясняет ситуацию и даёт остановить ран.
    expect(screen.getByRole('status')).toHaveTextContent('Активный ран блокирует возврат')
    fireEvent.click(screen.getByRole('button', { name: 'Остановить ран' }))
    expect(stop).toHaveBeenCalledOnce()
    // Сам черновик собрать можно: ворота стоят на отправке, а не на подготовке.
    expect(screen.getByRole('alert')).toHaveTextContent('Сейчас выполняется ран')
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить как черновик' }))
    expect(submit).toHaveBeenCalledOnce()
  })

  it('вкладка доработок показывает черновики с действиями, а отправленные — без них', () => {
    const cb = callbacks({ onSubmitDraft: vi.fn(), onDeleteDraft: vi.fn(), onEditDraft: vi.fn() })
    const withReworks = {
      ...model,
      tabs: [{ id: 'overview' as const, label: 'Общее' }, { id: 'reworks' as const, label: 'Доработки', count: 1 }],
      drafts: [{ id: 'd1', sequence: 2, description: 'Черновик доработки', criteria: ['A'], makeSources: [], attachments: [], createdBy: 'alex', createdAt: 1, preparationRunId: null, status: 'draft' as const }],
      cycles: [{ id: 'c1', sequence: 1, description: 'Отправленный цикл', criteria: [], makeSources: [], attachments: [], createdBy: 'alex', createdAt: 1, preparationRunId: null, status: 'submitted' as const, merged: true }]
    }
    render(<NewTaskCardView model={withReworks} activeTab="reworks" version="new" reworkOpen={false} reworkDraft={draft} onVersionChange={vi.fn()} callbacks={cb} />)
    expect(screen.getByText('Черновик доработки')).toBeTruthy()
    expect(screen.getByText('Вмержено в main')).toBeTruthy()
    // Действия есть только у черновика — отправленный цикл неизменяем.
    expect(screen.getAllByRole('button', { name: 'Отправить на доработку' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Отправить на доработку' }))
    expect(cb.onSubmitDraft).toHaveBeenCalledWith('d1')
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }))
    expect(cb.onEditDraft).toHaveBeenCalledWith('d1')
  })

  it('переносом файла в зону грузит вложение задачи', () => {
    const upload = vi.fn()
    render(<NewTaskCardView model={model} activeTab="overview" version="new" reworkOpen={false} reworkDraft={draft} onVersionChange={vi.fn()} callbacks={callbacks({ onUploadAttachment: upload })} />)
    const zone = screen.getByText('Перетащите файлы сюда').closest('label')!
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'dropped.png', { type: 'image/png' })] } })
    expect(upload).toHaveBeenCalledWith('source', expect.objectContaining({ name: 'dropped.png' }))
  })

  it('показывает изменения текущего цикла со ссылкой на план', () => {
    const cb = callbacks()
    const withCycle = {
      ...model,
      cycles: [{ id: 'c1', sequence: 1, description: 'Восстановление записи', criteria: [], makeSources: [], attachments: [], createdBy: 'alex', createdAt: 1, preparationRunId: 'prep-1', status: 'submitted' as const }]
    }
    render(<NewTaskCardView model={withCycle} activeTab="overview" version="new" reworkOpen={false} reworkDraft={draft} onVersionChange={vi.fn()} callbacks={cb} />)
    expect(screen.getByText('Восстановление записи')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'План →' }))
    expect(cb.onChangeTab).toHaveBeenCalledWith('preparation')
  })

  it('Make-дизайн: превью, замена и снятие связи', () => {
    const cb = callbacks({ onOpenMake: vi.fn(), onUnlinkMake: vi.fn(), onReplaceMake: vi.fn() })
    const choices = { state: 'ready' as const, items: [
      { conversationId: 'make-19', title: 'Проект 19', owner: 'me', own: true, updatedAt: 1 },
      { conversationId: 'make-20', title: 'Проект 20', owner: 'me', own: true, updatedAt: 1 }
    ] }
    render(<NewTaskCardView model={model} activeTab="overview" version="new" reworkOpen={false} reworkDraft={draft} makeSourcesState={choices} onVersionChange={vi.fn()} callbacks={cb} />)
    fireEvent.click(screen.getByRole('button', { name: 'Открыть превью' }))
    expect(cb.onOpenMake).toHaveBeenCalledWith('make-19')

    // Заменить показывает выбор из остальных Make-проектов проекта.
    fireEvent.click(screen.getByRole('button', { name: 'Заменить' }))
    fireEvent.change(screen.getByLabelText('Новый макет'), { target: { value: 'make-20' } })
    expect(cb.onReplaceMake).toHaveBeenCalledWith('make-1', 'make-20')

    fireEvent.click(screen.getByRole('button', { name: 'Удалить связь' }))
    expect(cb.onUnlinkMake).toHaveBeenCalledWith('make-1')
  })

  it('превью картинки грузится по требованию, а не при открытии карточки', async () => {
    const load = vi.fn().mockResolvedValue('data:image/png;base64,AAA')
    const withImage = { ...model, source: { ...model.source, attachments: [{ id: 'a1', name: 'shot.png', mimeType: 'image/png', status: 'ready' as const }] } }
    render(<NewTaskCardView model={withImage} activeTab="overview" version="new" reworkOpen={false} reworkDraft={draft} onVersionChange={vi.fn()} callbacks={callbacks({ loadAttachment: load })} />)
    expect(load).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Превью' }))
    expect(await screen.findByAltText('shot.png')).toHaveAttribute('src', 'data:image/png;base64,AAA')
  })

  it('размечает критерии относительно первоначальной постановки', () => {
    const diffModel = { ...model, acceptanceCriteria: '1. Исходный критерий\n2. Совсем новый пункт' }
    render(<NewTaskCardView model={diffModel} activeTab="overview" version="new" reworkOpen={false} reworkDraft={draft} onVersionChange={vi.fn()} callbacks={callbacks()} />)
    expect(screen.getByText('Исходный')).toBeTruthy()
    expect(screen.getByText('Добавлен')).toBeTruthy()
  })
})

import type { Meta, StoryObj } from '@storybook/react'
import { vi } from 'vitest'
import { NewTaskCardView } from './NewTaskCardView'
import type { TaskCardViewModel } from './TaskCardViewModel'

const model: TaskCardViewModel = {
  taskId: 'task-19', taskKey: 'CHAT-408', projectName: 'Голос Чат',
  title: 'Новая карточка задачи по Make «Проект 19»',
  stage: { semanticType: 'component_qa', label: 'Component QA', fallback: false },
  priority: 'Высокий', assignee: 'alexey', labels: ['frontend', 'workflow'],
  description: 'Карточка отображает задачу, раны, файлы и историю циклов.',
  acceptanceCriteria: '1. Новая и старая версии доступны без потери контекста.',
  source: { description: 'Реализовать новую карточку по живому Make-проекту.', acceptanceCriteria: '1. Соответствует макету.', attachments: [{ id: 'brief', name: 'brief.pdf', mimeType: 'application/pdf', status: 'ready' }] },
  workflow: [
    { id: 'preparation', semanticType: 'preparation', label: 'Подготовка', state: 'passed' },
    { id: 'development', semanticType: 'development', label: 'Разработка', state: 'passed' },
    { id: 'component_qa', semanticType: 'component_qa', label: 'Component QA', state: 'current' },
    { id: 'integration_tests', semanticType: 'integration_tests', label: 'Интеграционные тесты', state: 'upcoming' }
  ],
  runs: [{ id: 'run-19', title: 'Development', status: 'success', outcome: 'success', createdAt: Date.UTC(2026, 8, 4), finishedAt: Date.UTC(2026, 8, 4, 0, 12), canOpen: true, canCancel: false, canAnswer: false }],
  makeSources: [{ id: 'make', title: 'Проект 19', conversationId: 'e7b501e7-a0b5-4c00-bb20-e8743e25011f', mode: 'files', paths: [{ path: 'src/App.jsx', available: true }, { path: 'src/removed.jsx', available: false, error: 'Файл удалён' }] }],
  cycles: [], drafts: [], loadState: 'ready',
  cycleNumber: 1, nextCycleNumber: 2, branch: null, commit: null,
  tabs: [{ id: 'overview', label: 'Общее' }, { id: 'reworks', label: 'Доработки' }],
  actions: { canRework: true, hasActiveRun: false, canStopRun: false, safeActiveRunActions: [] }
}
const meta: Meta<typeof NewTaskCardView> = {
  title: 'Kanban/NewTaskCard',
  component: NewTaskCardView,
  args: {
    model, activeTab: 'overview', version: 'new', reworkOpen: false,
    reworkDraft: { description: '', criteria: [], makeMode: 'whole_project', makePaths: [], attachments: [] },
    onVersionChange: vi.fn(),
    callbacks: { onClose: vi.fn(), onChangeTab: vi.fn(), onOpenRun: vi.fn(), onOpenMake: vi.fn(), onStartRework: vi.fn(), onChangeReworkDraft: vi.fn(), onAddReworkFiles: vi.fn(), onRemoveReworkFile: vi.fn(), onRetryReworkFile: vi.fn(), onRetryHistory: vi.fn(), onSubmitRework: vi.fn(), onCancelRework: vi.fn() }
  }
}
export default meta
type Story = StoryObj<typeof NewTaskCardView>
export const Desktop: Story = {}
export const Tablet: Story = { parameters: { viewport: { defaultViewport: 'tablet' } } }
export const Mobile: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } }
export const Dark: Story = { globals: { theme: 'dark' } }
export const Loading: Story = { args: { model: { ...model, loadState: 'loading' } } }
export const Empty: Story = { args: { model: { ...model, loadState: 'empty' } } }
export const Error: Story = { args: { model: { ...model, loadState: 'error', error: 'Сеть недоступна' } } }
export const WaitingForAnswer: Story = { args: { model: { ...model, runs: [{ ...model.runs[0]!, status: 'waiting_for_answer', outcome: 'active', canAnswer: true }] }, activeTab: 'overview' } }
export const Rework: Story = { args: { reworkOpen: true, reworkDraft: { description: 'Уточнить мобильное поведение', criteria: ['Нет горизонтального скролла'], makeMode: 'files', makePaths: ['src/App.jsx'], attachments: [] } } }

export const Reworks: Story = {
  args: {
    activeTab: 'reworks',
    model: {
      ...model,
      tabs: [{ id: 'overview', label: 'Общее' }, { id: 'reworks', label: 'Доработки', count: 1 }],
      drafts: [{
        id: 'draft-1', sequence: 2, description: 'Компактный статус синхронизации',
        criteria: ['Статус рядом с сообщением'], makeSources: [], attachments: [],
        createdBy: 'alex', createdAt: Date.UTC(2026, 8, 7, 12), preparationRunId: null, status: 'draft'
      }],
      cycles: [{
        id: 'cycle-1', sequence: 1, description: 'Первый вариант индикатора записи',
        criteria: ['Индикатор виден'], makeSources: [], attachments: [],
        createdBy: 'alex', createdAt: Date.UTC(2026, 8, 1, 12), preparationRunId: null, status: 'submitted', merged: true
      }]
    }
  }
}

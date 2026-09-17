import { useState } from 'react'
import { StageCard, StageHeading, StageRail } from './NewTaskStages'
import type { NewTaskCardViewProps } from './NewTaskCardView'
import type { Meta, StoryObj } from '@storybook/react'
import { fn } from '@storybook/test'
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
    { id: 'development', semanticType: 'development', label: 'Разработка', state: 'passed', startedAt: Date.UTC(2026, 8, 4), finishedAt: Date.UTC(2026, 8, 4, 0, 12), durationMs: 720000 },
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
  parameters: {
    componentQa: {
      componentId: 'new-task-card-view',
      primaryStoryId: 'kanban-newtaskcard--desktop'
    }
  },
  args: {
    model, activeTab: 'overview', version: 'new', reworkOpen: false,
    reworkDraft: { description: '', criteria: [], makeMode: 'whole_project', makePaths: [], attachments: [] },
    onVersionChange: fn(),
    callbacks: { onClose: fn(), onChangeTab: fn(), onOpenRun: fn(), onOpenMake: fn(), onStartRework: fn(), onChangeReworkDraft: fn(), onAddReworkFiles: fn(), onRemoveReworkFile: fn(), onRetryReworkFile: fn(), onRetryHistory: fn(), onSubmitRework: fn(), onCancelRework: fn() }
  }
}
export default meta
type Story = StoryObj<typeof NewTaskCardView>
function InteractiveCard(args: NewTaskCardViewProps): JSX.Element {
  const [current, setCurrent] = useState(args.model)
  const [activeTab, setTab] = useState(args.activeTab)
  return <NewTaskCardView {...args} model={current} activeTab={activeTab} callbacks={{
    ...args.callbacks, onChangeTab: setTab,
    onUpdate: async (fields) => { setCurrent((value) => ({ ...value, ...fields })) }
  }} />
}

function ErrorRail(): JSX.Element {
  const [failed, setFailed] = useState(true)
  return <><StageHeading eyebrow="Component QA" title="Проверка компонентов" /><StageRail><StageCard number={1} status={failed ? 'failed' : 'queued'}
    eyebrow="Этап 1" title="Проверка компонентов" error={'Не удалось открыть страницу\nПодробности в ленте'}
    onRetry={() => setFailed(false)}><p>Результат последнего рана этого этапа.</p></StageCard></StageRail></>
}

// @testCase TC1
export const StatementEditing: Story = {
  name: 'Редактирование постановки',
  render: (args) => <InteractiveCard {...args} />
}

// @testCase TC1
export const StageWithError: Story = {
  name: 'Этап с ошибкой',
  args: { activeTab: 'component_qa', model: { ...model, tabs: [...model.tabs, { id: 'component_qa', label: 'Component QA' }] }, renderPanel: () => <ErrorRail /> }
}

// @testCase TC1
export const MobileRail: Story = {
  name: 'Мобильная рейка',
  parameters: { viewport: { defaultViewport: 'chat449mobile', viewports: { chat449mobile: { name: '390px', styles: { width: '390px', height: '844px' } } } } },
  args: {
    ...StageWithError.args,
    model: { ...model, title: 'Очень длинное название задачи '.repeat(8), tabs: [...model.tabs, { id: 'component_qa', label: 'Component QA' }] }
  },
  render: (args) => <InteractiveCard {...args} />
}

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

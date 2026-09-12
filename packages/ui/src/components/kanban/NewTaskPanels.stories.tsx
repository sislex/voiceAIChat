import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { NewTaskCardView } from './NewTaskCardView'
import type { TaskCardCallbacks, TaskCardViewModel } from './TaskCardViewModel'
import { NewTaskPreparationPanel } from './NewTaskPreparationPanel'
import { NewTaskSettingsPanel } from './NewTaskSettingsPanel'
import { NewTaskProgressPanel } from './NewTaskProgressPanel'
import { NewTaskQaStagesPanel } from './NewTaskQaStagesPanel'
import { NewTaskManualQaPanel } from './NewTaskManualQaPanel'
import { NewTaskMergePanel } from './NewTaskMergePanel'
import { NewTaskFeedPanel } from './NewTaskFeedPanel'
import { fixtureTaskProps, installNewTaskPanelFixtures, preparationFixture } from './newTaskPanelFixtures'

export type PanelName = 'overview' | 'reworks' | 'preparation' | 'settings' | 'progress' | 'component_qa' | 'integration_tests' | 'automated_qa' | 'manual_qa' | 'merge' | 'feed'
export function Panel({ panel }: { panel: PanelName }): JSX.Element {
  const p = fixtureTaskProps
  if (panel === 'overview' || panel === 'reworks') return <CardExample tab={panel} />
  if (panel === 'preparation') return <NewTaskPreparationPanel {...p} preparation={{ projectId: p.projectId, taskId: p.taskId, loadRuns: async () => [preparationFixture()], onAnswer: async () => undefined, onCancel: async () => undefined }} />
  if (panel === 'settings') return <NewTaskSettingsPanel {...p} />
  if (panel === 'progress') return <NewTaskProgressPanel {...p} />
  if (panel === 'manual_qa') return <NewTaskManualQaPanel {...p} runActive={false} />
  if (panel === 'merge') return <NewTaskMergePanel {...p} activeRunId={null} canStart onStartMerge={() => undefined} />
  if (panel === 'feed') return <NewTaskFeedPanel {...p} ciSummary={{ id: 'dev-2', taskId: 't1', status: 'success', error: null, durationMs: 1000, slotProgress: { done: 1, total: 1, phase: 'development' }, modelActive: false, awaitingInput: false }} />
  return <NewTaskQaStagesPanel {...p} stage={panel} runActive={false} />
}
function CardExample({ tab }: { tab: 'overview' | 'reworks' }): JSX.Element {
  const [activeTab, setActiveTab] = useState(tab)
  const noop = () => undefined
  const model: TaskCardViewModel = {
    taskId: 't1', taskKey: 'CHAT-445', projectName: 'CHAT', title: 'Функциональные вкладки новой карточки',
    stage: { semanticType: 'component_qa', label: 'Component QA', fallback: false }, priority: 'Высокий', assignee: 'alex', labels: [],
    description: 'Восстановление после потери сети', acceptanceCriteria: 'Сохранить ввод пользователя', source: { description: 'Исходная постановка', acceptanceCriteria: 'Сохранить ввод', attachments: [] },
    workflow: fixtureTaskProps.workflow.map((label, at) => ({ id: String(at), label, semanticType: 'custom', state: at === 2 ? 'current' : at < 2 ? 'passed' : 'upcoming' })),
    makeSources: [], cycles: fixtureTaskProps.cycles, drafts: [{ ...fixtureTaskProps.cycles[0]!, id: 'draft-3', sequence: 2, status: 'draft' }],
    runs: [], cycleNumber: 2, nextCycleNumber: 3, branch: 'CHAT-445', commit: null, loadState: 'ready',
    tabs: [{ id: 'overview', label: 'Общее' }, { id: 'reworks', label: 'Доработки' }], actions: { canRework: true, hasActiveRun: false, canStopRun: false, safeActiveRunActions: [] }
  }
  const callbacks: TaskCardCallbacks = { onClose: noop, onChangeTab: value => { if (value === 'overview' || value === 'reworks') setActiveTab(value) },
    onOpenRun: noop, onOpenMake: noop, onStartRework: noop, onChangeReworkDraft: noop, onSubmitRework: noop, onCancelRework: noop }
  return <NewTaskCardView model={model} activeTab={activeTab} version="new" onVersionChange={noop} callbacks={callbacks} reworkOpen={false}
    reworkDraft={{ description: '', criteria: [], makeMode: 'whole_project', makePaths: [], attachments: [] }} />
}
const meta: Meta<typeof Panel> = {
  title: 'Kanban/NewTaskCard/FunctionalPanels', component: Panel, excludeStories: ['Panel'], args: { panel: 'preparation' },
  beforeEach: () => { installNewTaskPanelFixtures() },
  decorators: [(Story) => <div style={{ maxWidth: 1000, padding: 18, background: 'var(--surface-sunken)' }}><Story /></div>]
}
export default meta
type Story = StoryObj<typeof Panel>
export const Overview: Story = { args: { panel: 'overview' } }
export const Reworks: Story = { args: { panel: 'reworks' } }
export const Preparation: Story = { args: { panel: 'preparation' } }
export const Settings: Story = { args: { panel: 'settings' } }
export const Progress: Story = { args: { panel: 'progress' } }
export const ComponentQa: Story = { args: { panel: 'component_qa' } }
export const Integration: Story = { args: { panel: 'integration_tests' } }
export const AutomatedQa: Story = { args: { panel: 'automated_qa' } }
export const ManualQa: Story = { args: { panel: 'manual_qa' } }
export const Merge: Story = { args: { panel: 'merge' } }
export const Feed: Story = { args: { panel: 'feed' } }
export const Dark: Story = { args: { panel: 'component_qa' }, globals: { theme: 'dark' } }
export const Mobile: Story = { args: { panel: 'preparation' }, parameters: { viewport: { defaultViewport: 'mobile1' } } }

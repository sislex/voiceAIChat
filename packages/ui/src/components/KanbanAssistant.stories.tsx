// Сториз панели канбан-ассистента: состояния, которые в приложении достижимы
// только через живой ход модели и фоновый план — идущая серия задач, её провал
// и режим подтверждений. Мосты берутся из общего фейка (withBridges), поэтому
// витрина никуда не ходит по сети.
import type { Meta, StoryObj } from '@storybook/react'
import type { Orchestration, OrchestrationItem } from '@shared/orchestration'
import type { WidgetAssistantContext } from '@shared/widgetAssistant'
import { KanbanAssistant } from './KanbanAssistant'
import { createFakeApi } from '../test/fakeApi'
import { withBridges } from '../test/storyBridges'

const PROJECT_ID = 'p1'

function step(patch: Partial<OrchestrationItem> & { position: number; title: string }): OrchestrationItem {
  return {
    id: `i${patch.position}`,
    kind: 'run_ci',
    taskId: 't1',
    dependsOn: [],
    payload: {},
    status: 'pending',
    runId: null,
    attempts: 0,
    error: null,
    startedAt: null,
    finishedAt: null,
    ...patch
  }
}

function plan(patch: Partial<Orchestration> = {}): Orchestration {
  return {
    id: 'plan-1',
    projectId: PROJECT_ID,
    conversationId: 'c1',
    owner: 'admin',
    title: 'Серия задач по корзине',
    status: 'running',
    error: null,
    createdAt: 0,
    updatedAt: 0,
    items: [
      step({ position: 0, title: 'Завести карточку «Корзина»', kind: 'create_task', status: 'done' }),
      step({ position: 1, title: 'Разработка CHAT-42', dependsOn: [0], status: 'running' }),
      step({ position: 2, title: 'Дождаться merge', kind: 'wait_merge', dependsOn: [1] }),
      step({ position: 3, title: 'Разработка CHAT-43', dependsOn: [2] })
    ],
    ...patch
  }
}

const context: WidgetAssistantContext<any> = {
  version: 1,
  widget: { kind: 'kanban', instanceId: PROJECT_ID, title: 'Голос Чат' },
  project: null,
  selection: null,
  surface: { route: `/projects/${PROJECT_ID}`, section: 'board', openTaskId: null, openTaskTab: null, boardView: null, commands: [] },
  recentActions: []
}

/** Фейковый мост: панель читает планы через api и слушает их через window.widgetUi. */
function apiWith(plans: Orchestration[], autonomy: 'auto' | 'confirm' = 'auto'): ReturnType<typeof createFakeApi> {
  const api = createFakeApi()
  const original = api['kanbanAssistant:get']
  api['orchestrations:list'] = (async () => plans) as typeof api['orchestrations:list']
  api['orchestrations:cancel'] = (async () => ({ ...plans[0]!, status: 'cancelled' })) as typeof api['orchestrations:cancel']
  api['kanbanAssistant:get'] = (async (arg) => {
    const data = await original(arg)
    return { ...data, conversation: { ...data.conversation, assistantAutonomy: autonomy } }
  }) as typeof api['kanbanAssistant:get']
  return api
}

const transport = {
  send: () => {},
  onToken: () => () => {},
  onDone: () => () => {},
  onError: () => () => {}
} as unknown as NonNullable<typeof window.claude>

const meta: Meta<typeof KanbanAssistant> = {
  title: 'Kanban/KanbanAssistant',
  component: KanbanAssistant,
  decorators: [
    withBridges(),
    (Story) => <div className="widget-assistant" style={{ height: 'calc(100vh - 32px)' }}><aside className="widget-assistant-panel" style={{ flex: '1 1 auto' }}><Story /></aside></div>
  ],
  args: {
    projectId: PROJECT_ID,
    context,
    llmEngines: [],
    transport,
    onCommand: () => {},
    onOpenTask: () => {}
  }
}
export default meta
type Story = StoryObj<typeof KanbanAssistant>

export const RunningPlan: Story = {
  name: 'План в работе',
  args: { api: apiWith([plan()]) }
}

export const FailedPlan: Story = {
  name: 'План остановлен ошибкой',
  args: {
    api: apiWith([plan({
      status: 'failed',
      items: [
        step({ position: 0, title: 'Завести карточку «Корзина»', kind: 'create_task', status: 'done' }),
        step({ position: 1, title: 'Разработка CHAT-42', dependsOn: [0], status: 'failed', attempts: 1, error: 'Ран завершился со статусом failed' }),
        step({ position: 2, title: 'Дождаться merge', kind: 'wait_merge', dependsOn: [1] })
      ]
    })])
  }
}

export const ConfirmMode: Story = {
  name: 'Режим подтверждений',
  args: { api: apiWith([], 'confirm') }
}

export const EmptyDialog: Story = {
  name: 'Пустой диалог (макет «Проект 14»)',
  args: { api: apiWith([]), context: { ...context, project: { id: PROJECT_ID, name: 'ChatAI', description: '', technologies: [], skills: [], typeChain: { nodes: [], features: [], label: '' } } as unknown as WidgetAssistantContext<any>['project'] }, onSelectConversation: () => {}, onClose: () => {} }
}

export const Unavailable: Story = {
  name: 'Транспорт не подключён',
  args: { api: apiWith([]), transport: undefined }
}

export const LoadError: Story = {
  name: 'Ошибка загрузки разговора',
  args: {
    api: (() => {
      const api = createFakeApi()
      api['kanbanAssistant:get'] = (async () => { throw new Error('Модель временно недоступна') }) as typeof api['kanbanAssistant:get']
      return api
    })()
  }
}

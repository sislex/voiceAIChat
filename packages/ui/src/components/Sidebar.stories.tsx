import type { Meta, StoryObj } from '@storybook/react'
import { userEvent, within } from '@storybook/test'
import type { Conversation, MessageSearchHit } from '@shared/types'
import type { TaskChatBadge } from '@shared/projects'
import type { CiRunSummary } from '@shared/ci'
import { Sidebar } from './Sidebar'
import { makeConversation } from '../test/fixtures/conversations'

const NOW = new Date(2026, 7, 19, 12).getTime()
const MONDAY = new Date(2026, 7, 17, 0).getTime()

function conversation(id: string, title: string, updatedAt: number, over: Partial<Conversation> = {}): Conversation {
  return makeConversation({ id, title, createdAt: updatedAt - 1000, updatedAt, ...over })
}

const MIXED = [
  conversation('current-task', 'Исправить немедленное обновление истории после переноса карточки', NOW, { taskId: 'task-1' }),
  conversation('current-chat', 'Обсуждение релиза и проверок', MONDAY),
  conversation('older-first', 'Старая беседа о миграции', MONDAY - 1),
  conversation('older-second', 'Очень длинное название старой беседы, проверяющее перенос и прокрутку в узком мобильном сайдбаре', MONDAY - 86_400_000)
]

const TASK_BADGES: Record<string, TaskChatBadge> = {
  'current-task': { conversationId: 'current-task', projectId: 'project-1', taskId: 'task-1', key: 'CHAT-288', type: 'task', columnSemantic: 'development', run: null }
}
const CI: Record<string, CiRunSummary> = {
  'task-1': { id: 'run-1', taskId: 'task-1', status: 'running', slotProgress: { done: 2, total: 5, phase: 'Проверяет UI' }, durationMs: 42_000, modelActive: true, awaitingInput: false }
}
const hit: MessageSearchHit = {
  messageId: 'message-1', conversationId: 'older-first', conversationTitle: 'Старая беседа о миграции',
  role: 'u1', snippet: 'Проверили <mark>миграцию</mark> без потери карточек',
  createdAt: MONDAY - 1, time: '18:30', projectId: null, score: -1
}

const meta: Meta<typeof Sidebar> = {
  title: 'Layout/Sidebar',
  component: Sidebar,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div style={{ width: 340, height: '100vh' }}><Story /></div>],
  args: {
    conversations: MIXED, conversationsStatus: 'ready', activeId: 'current-task',
    taskBadges: TASK_BADGES, ciSummaries: CI, now: NOW,
    onNew: () => {}, onPick: () => {}, onDelete: () => {},
    searchQuery: '', onSearch: () => {}, onOpenObserver: () => {}, onOpenSettings: () => {}
  }
}
export default meta
type Story = StoryObj<typeof Sidebar>

export const CurrentWeekOnly: Story = { args: { conversations: MIXED.slice(0, 2) } }
export const MixedCollapsed: Story = {}
export const MixedExpanded: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Более старые 2' }))
  }
}
export const Empty: Story = { args: { conversations: [] } }
export const Loading: Story = { args: { conversations: [], conversationsStatus: 'loading' } }
export const Error: Story = { args: { conversations: [], conversationsStatus: 'error', conversationsError: 'Сервер недоступен' } }
export const StaleError: Story = { args: { conversationsStatus: 'error', conversationsError: 'Не удалось обновить список' } }
export const Refreshing: Story = { args: { conversationsStatus: 'loading' } }
export const TitleSearch: Story = { args: { searchQuery: 'миграция', conversations: MIXED.slice(2, 3) } }
export const MessageSearch: Story = {
  args: {
    searchQuery: 'миграция', searchScope: 'messages', onSearchScopeChange: () => {},
    messageSearch: { query: 'миграция', status: 'ready', hits: [hit], nextCursor: null, loadingMore: false, error: null }
  }
}
export const ScrollAndLongTitles: Story = {
  args: { conversations: Array.from({ length: 14 }, (_, index) => conversation(`long-${index}`, `Длинная беседа номер ${index + 1}: детали проверки сайдбара и доступного управления`, NOW - index * 1000)) }
}
export const ChatsControlsHidden: Story = {
  args: { mode: 'chats', onModeChange: () => {}, onShowDoneTaskChatsChange: () => {}, width: 264, onWidthChange: () => {} }
}
export const ChatsControlsOpen: Story = {
  ...ChatsControlsHidden,
  play: async ({ canvasElement }) => {
    within(canvasElement).getByRole('list', { name: 'Беседы' }).dispatchEvent(new WheelEvent('wheel', { deltaY: -40, bubbles: true }))
  }
}
export const ProjectsControlsOpen: Story = {
  args: {
    mode: 'projects', onModeChange: () => {}, onCreateProject: () => {}, width: 264, onWidthChange: () => {},
    projects: [{ id: 'project-1', name: 'Альфа', role: 'owner' }, { id: 'project-2', name: 'Длинный проект для проверки узкого сайдбара', role: 'member' }] as never[]
  },
  play: async ({ canvasElement }) => {
    canvasElement.querySelector('.projlist')?.dispatchEvent(new WheelEvent('wheel', { deltaY: -40, bubbles: true }))
  }
}
export const MinimumWidth: Story = { ...ChatsControlsHidden, decorators: [(Story) => <div style={{ width: 220, height: '100vh' }}><Story /></div>] }
export const MaximumWidth: Story = { ...ProjectsControlsOpen, decorators: [(Story) => <div style={{ width: 420, height: '100vh' }}><Story /></div>] }
export const ShortViewportAccountMenu: Story = {
  args: { ...ChatsControlsHidden.args, currentUser: { name: 'Администратор', role: 'admin' }, onOpenUsers: () => {}, onOpenKnowledgeBase: () => {}, onOpenFiles: () => {}, onOpenConsole: () => {}, onLogout: () => {} },
  decorators: [(Story) => <div style={{ width: 340, height: 500 }}><Story /></div>],
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Администратор/ }))
  }
}
export const Mobile: Story = { args: { open: true }, parameters: { viewport: { defaultViewport: 'mobile1' } } }
export const DarkTheme: Story = {
  args: { ...ChatsControlsHidden.args },
  decorators: [(Story) => <div data-theme="dark" style={{ width: 340, height: '100vh', background: 'var(--bg)' }}><Story /></div>]
}

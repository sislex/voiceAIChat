// Страница пользователя целиком: реалистичный расход, фильтры и пустое состояние.
import type { Meta, StoryObj } from '@storybook/react'
import { fn } from '@storybook/test'
import { UsersAdmin } from './UsersAdmin'

const conversations = [
  { id: 'chat-1', title: 'Редизайн кабинета', createdAt: 1, updatedAt: 2, messageCount: 18, claudeSessionId: null, execTarget: null, workdir: '', skillNames: [], llmEngineId: null, llmProvider: 'codex' as const, llmModel: 'gpt-5.6-sol', permissionMode: null, kbContextMode: 'auto' as const, projectId: null, taskId: null, status: 'developing' as const, lastExecTarget: null },
  { id: 'chat-2', title: 'План релиза', createdAt: 1, updatedAt: 2, messageCount: 7, claudeSessionId: null, execTarget: null, workdir: '', skillNames: [], llmEngineId: null, llmProvider: 'claude' as const, llmModel: 'opus', permissionMode: null, kbContextMode: 'auto' as const, projectId: null, taskId: null, status: 'developing' as const, lastExecTarget: null }
]

const meta: Meta<typeof UsersAdmin> = {
  title: 'Admin/User page',
  component: UsersAdmin,
  parameters: { layout: 'fullscreen' },
  args: {
    variant: 'page',
    users: [
      { name: 'admin', role: 'admin', blocked: false, createdAt: 1, conversationCount: 12, agents: [] },
      { name: 'alex', role: 'user', blocked: false, createdAt: 2, conversationCount: 3, agents: [] }
    ],
    selected: 'alex',
    currentUserName: 'admin',
    conversations,
    conversationId: null,
    messages: [],
    usage: {
      unit: 'day',
      conversationId: null,
      totals: { inputTokens: 1_840_000, outputTokens: 284_000, cacheReadTokens: 6_400_000, costUsd: 13.72, messages: 25 },
      byModel: [
        { model: 'gpt-5.6-sol', inputTokens: 1_240_000, outputTokens: 204_000, cacheReadTokens: 5_100_000, costUsd: 9.84, messages: 18 },
        { model: 'opus', inputTokens: 600_000, outputTokens: 80_000, cacheReadTokens: 1_300_000, costUsd: 3.88, messages: 7 }
      ],
      byBucket: [
        { bucket: '2026-08-02', inputTokens: 420_000, outputTokens: 64_000, cacheReadTokens: 1_200_000, costUsd: 3.11, messages: 6 },
        { bucket: '2026-08-03', inputTokens: 670_000, outputTokens: 102_000, cacheReadTokens: 2_400_000, costUsd: 4.65, messages: 9 },
        { bucket: '2026-08-04', inputTokens: 750_000, outputTokens: 118_000, cacheReadTokens: 2_800_000, costUsd: 5.96, messages: 10 }
      ],
      byConversation: [
        { conversationId: 'chat-1', title: 'Редизайн кабинета', inputTokens: 1_240_000, outputTokens: 204_000, cacheReadTokens: 5_100_000, costUsd: 9.84, messages: 18 }
      ]
    },
    engines: [],
    engineHealth: {},
    onSelect: fn(), onCreate: fn(), onSetBlocked: fn(), onDelete: fn(),
    onLoadUsage: fn(), onOpenConversation: fn(), onCreateEngine: fn(),
    onUpdateEngine: fn(), onDeleteEngine: fn(), onCheckEngineHealth: fn(), onClose: fn()
  }
}
export default meta
type Story = StoryObj<typeof UsersAdmin>

export const Overview: Story = {}
export const EmptyUsage: Story = { args: { usage: null } }

// Страница пользователя целиком: реалистичный расход, фильтры и пустое состояние.
import type { Meta, StoryObj } from '@storybook/react'
import { fn } from '@storybook/test'
import { UsersAdmin } from './UsersAdmin'

const NOW = Date.now()

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
      { name: 'admin', role: 'admin', blocked: false, createdAt: 1, conversationCount: 12, agents: [], lastSeenAt: NOW - 40_000, liveSessions: 2 },
      { name: 'alex', role: 'developer', blocked: false, createdAt: 2, conversationCount: 3, lastSeenAt: NOW - 3 * 60_000, liveSessions: 1, llmLimitUsd: 50, email: 'alex@voicechat.team', agents: [
        { id: 'm1', name: 'MacBook Pro 16"', online: true, createdAt: 1, lastSeen: NOW, version: '2.7.4', telemetry: { os: { platform: 'darwin', release: '15.6' } } as never },
        { id: 'm2', name: 'Mac mini CI', online: false, createdAt: 1, lastSeen: NOW - 2 * 86_400_000 }
      ] },
      { name: 'nikita', role: 'tester', blocked: true, createdAt: 3, conversationCount: 0, agents: [], lastSeenAt: NOW - 12 * 86_400_000, liveSessions: 0 }
    ],
    selected: 'alex',
    route: { page: 'users', userName: 'alex', tab: 'overview' },
    latestAgentVersion: '2.8.1',
    usageSummary: [
      { name: 'admin', totals: { inputTokens: 400_000, outputTokens: 60_000, cacheReadTokens: 0, costUsd: 21.4, messages: 12 }, byModel: [] },
      { name: 'alex', totals: { inputTokens: 1_840_000, outputTokens: 284_000, cacheReadTokens: 6_400_000, costUsd: 13.72, messages: 25 }, byModel: [] }
    ],
    security: [
      { id: 3, at: NOW - 12 * 60_000, user: 'alex', type: 'login', ip: '89.125.68.35', userAgent: 'Chrome 141 · macOS', details: 'новое устройство' },
      { id: 2, at: NOW - 60 * 60_000, user: 'alex', type: 'agent_connected', ip: '10.0.0.4', userAgent: 'agent/2.7.4', details: 'MacBook Pro 16"' },
      { id: 1, at: NOW - 26 * 60 * 60_000, user: 'alex', type: 'password_changed', ip: '89.125.68.35', userAgent: 'Chrome 141 · macOS', details: '' }
    ],
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

/** Список, метрики и карточка выбранного человека — главный экран раздела. */
export const Overview: Story = {}

/** Новый период без ответов модели: честное пустое состояние вместо нулей. */
export const EmptyUsage: Story = { args: { usage: null, route: { page: 'users', userName: 'alex', tab: 'usage' } } }

/** Матрица доступа: Codex закрыт целиком, Claude — по моделям. */
export const AccessMatrix: Story = {
  args: { route: { page: 'users', userName: 'alex', tab: 'access' }, llmAccess: [{ provider: 'codex', modelId: '*' }] }
}

/** Машины человека: устаревшая версия агента и офлайн-машина без известной ОС. */
export const Machines: Story = { args: { route: { page: 'users', userName: 'alex', tab: 'machines' } } }

/** Журнал безопасности с фильтром и выгрузкой. */
export const History: Story = { args: { route: { page: 'users', userName: 'alex', tab: 'history' } } }

/** Пустая установка: ни одного человека, кроме встроенного администратора. */
export const Empty: Story = { args: { users: [], selected: null, route: { page: 'users' }, usageSummary: [] } }

/** Сотни учёток: список показывает первую страницу и предлагает догрузить. */
export const ManyUsers: Story = {
  args: {
    route: { page: 'users' },
    selected: null,
    users: Array.from({ length: 420 }, (_, index) => ({
      name: `user-${String(index).padStart(3, '0')}`,
      role: (['developer', 'tester', 'observer'] as const)[index % 3]!,
      blocked: index % 37 === 0,
      createdAt: 1,
      conversationCount: index % 11,
      machinesTotal: index % 3,
      machinesOnline: index % 2,
      lastSeenAt: NOW - index * 60_000,
      liveSessions: index % 2
    }))
  }
}

/** Длинные имя и почта: шапка карточки переносит их, а не выдавливает кнопки. */
export const LongNames: Story = {
  args: {
    selected: 'константин-александрович-разумовский-тестировщик',
    route: { page: 'users', userName: 'константин-александрович-разумовский-тестировщик', tab: 'overview' },
    users: [{
      name: 'константин-александрович-разумовский-тестировщик',
      role: 'tester' as const,
      blocked: false,
      createdAt: 1,
      email: 'konstantin.alexandrovich.razumovsky@very-long-corporate-domain.example',
      conversationCount: 3,
      machinesTotal: 0,
      machinesOnline: 0,
      lastSeenAt: NOW - 120_000,
      liveSessions: 1
    }]
  }
}

/** Ошибка загрузки вкладки: видна внутри карточки, а не только в исчезнувшем тосте. */
export const TabError: Story = {
  args: { route: { page: 'users', userName: 'alex', tab: 'usage' }, usage: null, tabError: 'HTTP 503: сервис отчётов недоступен' }
}

/** Тёмная тема страницы целиком. */
export const Dark: Story = {
  decorators: [(Story) => (
    <div data-theme="dark" style={{ background: 'var(--bg)', color: 'var(--text)', minHeight: '100vh' }}>
      <Story />
    </div>
  )]
}

/** Телефон 390×844: список превращается в ленту, карточка занимает экран. */
export const Mobile: Story = {
  args: { route: { page: 'users', userName: 'alex', tab: 'overview' } },
  parameters: { viewport: { defaultViewport: 'mobile2' } }
}

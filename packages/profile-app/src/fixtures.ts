// Фикстуры для сториз и тестов: один набор на обоих потребителей карточки.

import type {
  ProfileConversation,
  ProfileProvider,
  ProfileSecurityEvent,
  ProfileUsage,
  ProfileUser
} from './contracts'
import { securityLabel } from './securityLabels'

export const NOW = Date.UTC(2026, 7, 31, 12, 0, 0)

export const providers: ProfileProvider[] = [
  {
    id: 'claude',
    label: 'Anthropic Claude',
    models: [
      { id: 'opus', label: 'Claude Opus 4.1', note: 'Рассуждения и код' },
      { id: 'sonnet', label: 'Claude Sonnet 4', note: 'Баланс скорости' },
      { id: 'haiku', label: 'Claude Haiku 3.5', note: 'Быстрые задачи' }
    ]
  },
  {
    id: 'codex',
    label: 'OpenAI Codex',
    models: [
      { id: 'gpt-5-codex', label: 'GPT-5.2 Codex', note: 'Сложная разработка' },
      { id: 'gpt-5-codex-mini', label: 'GPT-5.1 Codex mini', note: 'Быстрые правки' },
      { id: 'o3', label: 'o3', note: 'Глубокие рассуждения' }
    ]
  }
]

export const user: ProfileUser = {
  name: 'marina',
  role: 'developer',
  blocked: false,
  createdAt: NOW - 240 * 86_400_000,
  email: 'marina@voicechat.team',
  lastLogin: NOW - 3 * 3_600_000,
  lastSeenAt: NOW - 90_000,
  liveSessions: 3,
  llmLimitUsd: 250,
  conversationCount: 42,
  machines: [
    { id: 'm1', name: 'MacBook Pro 16"', online: true, version: '2.7.4', platform: 'darwin', osRelease: '15.6', lastSeen: NOW - 60_000 },
    { id: 'm2', name: 'Studio Workstation', online: true, version: '2.8.1', platform: 'linux', osRelease: '24.04', lastSeen: NOW - 120_000 },
    { id: 'm3', name: 'Mac mini CI', online: false, lastSeen: NOW - 2 * 86_400_000 }
  ]
}

export const blockedUser: ProfileUser = { ...user, name: 'nikita', blocked: true, lastSeenAt: NOW - 12 * 86_400_000, liveSessions: 0, llmLimitUsd: null }

export const usage: ProfileUsage = {
  spendUsd: 184.2,
  inputTokens: 6_100_000,
  outputTokens: 2_300_000,
  cacheReadTokens: 810_000,
  messages: 1284,
  interrupted: 17,
  byModel: [
    { model: 'claude-opus-4.1', spendUsd: 96.4, inputTokens: 3_100_000, outputTokens: 1_200_000 },
    { model: 'gpt-5.2-codex', spendUsd: 58.2, inputTokens: 2_100_000, outputTokens: 800_000 },
    { model: 'claude-sonnet-4', spendUsd: 29.6, inputTokens: 900_000, outputTokens: 300_000 }
  ],
  byBucket: Array.from({ length: 12 }, (_, index) => ({
    bucket: `2026-08-${String(index + 1).padStart(2, '0')}`,
    spendUsd: Number((4 + Math.sin(index) * 3 + index * 0.6).toFixed(2))
  }))
}

/** Пустой отчёт: период выбран, ответов в нём не было. */
export const emptyUsage: ProfileUsage = {
  spendUsd: 0,
  spendIncomplete: true,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  messages: 0,
  byModel: [],
  byBucket: []
}

function event(id: number, minutesAgo: number, type: string, details: string): ProfileSecurityEvent {
  return { id, at: NOW - minutesAgo * 60_000, type, label: securityLabel(type), ip: '89.125.68.35', userAgent: 'Chrome 141 · macOS', details }
}

export const events: ProfileSecurityEvent[] = [
  event(5, 12, 'login', 'новое устройство'),
  event(4, 70, 'agent_connected', 'MacBook Pro 16" · v2.7.4'),
  event(3, 26 * 60, 'password_changed', ''),
  event(2, 40 * 60, 'session_trusted', 'MacBook Pro 16"'),
  event(1, 72 * 60, 'login_failed', 'неверный пароль, попытка 2')
]

export const conversations: ProfileConversation[] = [
  { id: 'c1', title: 'Рефакторинг API', updatedAt: NOW - 30 * 60_000, messageCount: 42 },
  { id: 'c2', title: 'Разбор падения CI', updatedAt: NOW - 5 * 3_600_000, messageCount: 17 }
]

export const denied = [{ provider: 'claude', modelId: 'haiku' }, { provider: 'codex', modelId: 'o3' }]

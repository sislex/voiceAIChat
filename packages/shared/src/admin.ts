// Типы админ-страницы пользователей (только для роли admin).

import type { AgentInfo } from './agentProtocol'
import type { UserRole } from './types'

/** Пользователь в списке администрирования (+ его машины и счётчик разговоров). */
export interface AdminUserInfo {
  name: string
  role: UserRole
  blocked: boolean
  createdAt: number
  conversationCount: number
  /** Машины-агенты пользователя с онлайн-статусом. */
  agents: AgentInfo[]
}

/** Единица бакета в отчёте по токенам. */
export type UsageUnit = 'hour' | 'day' | 'week'

/** Суммарные метрики использования (токены/стоимость/число ответов). */
export interface UsageTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  costUsd: number
  /** Число ответов модели (ai-сообщений) в выборке. */
  messages: number
}

/** Метрики за временной бакет (напр. день/час/неделя, ключ — строка бакета). */
export interface UsageBucket extends UsageTotals {
  bucket: string
}

/** Метрики по конкретной модели. */
export interface UsageByModel extends UsageTotals {
  model: string
}

/** Полный отчёт по токенам пользователя за период. */
export interface UsageReport {
  unit: UsageUnit
  totals: UsageTotals
  byBucket: UsageBucket[]
  byModel: UsageByModel[]
}

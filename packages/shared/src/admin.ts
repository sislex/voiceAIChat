// Типы админ-страницы пользователей (только для роли admin).

import type { AgentInfo } from './agentProtocol'
import type { UserRole } from './types'
import type { LlmRunKind, LlmRunnerHealth } from './llm'

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


/** Kind исполнителя LLM: под какой CLI сервер адресует ход. */
export type LlmEngineKind = LlmRunKind

/** Запись реестра исполнителей, доступная админу в UI и REST. */
export interface AdminLlmEngine {
  id: string
  name: string
  kind: LlmEngineKind
  baseUrl: string
  /** Bearer-токен исполнителя; виден только админу. */
  token: string
  enabled: boolean
  allowedRoles: UserRole[]
  isDefault: boolean
  createdAt: number
}

/** Входные поля create/update записи реестра. */
export interface AdminLlmEngineInput {
  name: string
  kind: LlmEngineKind
  baseUrl: string
  token: string
  enabled: boolean
  allowedRoles: UserRole[]
  isDefault: boolean
}

/** Ответ health-check для конкретной пары (исполнитель, kind). */
export interface AdminLlmEngineHealth {
  engineId: string
  kind: LlmEngineKind
  checkedAt: number
  available: boolean
  detail: string
  status: LlmRunnerHealth | null
}


/** Безопасное описание доступного пользователю исполнителя (без URL и токена). */
export interface LlmEngineOption {
  id: string
  name: string
  kind: LlmEngineKind
  isDefault: boolean
}

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
  /** Авто-блокировка после неудачных входов (auth-roadmap п.3). */
  failedLogins?: number
  lockedUntil?: number | null
  lockReason?: string | null
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
  /** Стоимость, сообщённая CLI; у Codex обычно равна 0. */
  costUsd: number
  /** Независимый пересчёт по редактируемой таблице model_prices. */
  costFromPrices?: number
  /**
   * В выборке есть Codex-ответ без стоимости CLI и без строки в model_prices.
   * costUsd в этом случае — лишь известная часть суммы и не должна отображаться
   * как точная стоимость.
   */
  costIncomplete?: boolean
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

/** Метрики по конкретному разговору — одновременно данные для фильтра и сверки итогов. */
export interface UsageByConversation extends UsageTotals {
  conversationId: string
  title: string
}

/** Полный отчёт по токенам пользователя за период и необязательный разговор. */
export interface UsageReport {
  unit: UsageUnit
  conversationId: string | null
  totals: UsageTotals
  byBucket: UsageBucket[]
  byModel: UsageByModel[]
  byConversation: UsageByConversation[]
}

/** Строка сводки расхода пользователя для админского дашборда. */
/** Редактируемая запись прайса, USD за 1M токенов. */
export interface ModelPrice {
  provider: string
  model: string
  inputPerMillion: number
  cachedInputPerMillion: number
  cacheWritePerMillion: number
  outputPerMillion: number
  sourceUrl: string
  effectiveAt: number
  updatedAt: number
}

/** Данные upsert без серверной даты изменения. */
export interface ModelPriceInput {
  provider: string
  model: string
  inputPerMillion: number
  cachedInputPerMillion: number
  cacheWritePerMillion: number
  outputPerMillion: number
  sourceUrl: string
  effectiveAt: number
}

export interface UserUsageSummary {
  name: string
  totals: UsageTotals
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

/** Результат запроса на запуск host-side деплоя. */
export interface AdminDeployResponse {
  status: 'accepted' | 'running'
  message: string
}


/** Безопасное описание доступного пользователю исполнителя (без URL и токена). */
export interface LlmEngineOption {
  id: string
  name: string
  kind: LlmEngineKind
  isDefault: boolean
}

/** Метрики Make для админки (п.38): сколько проектов, места и публикаций — по системе и по пользователям. */
export interface AdminMakeProjectStat {
  conversationId: string
  owner: string | null
  filesCount: number
  bytes: number
  snapshots: number
  published: boolean
  shared: boolean
  views: number
  updatedAt: number
}

export interface AdminMakeUserStat {
  user: string
  projects: number
  bytes: number
  published: number
  views: number
}

/** Инвайт на саморегистрацию (auth-roadmap п.8): роль, срок, лимит использований. */
export interface InviteInfo { token: string; role: UserRole; createdBy: string; createdAt: number; expiresAt: number; maxUses: number; uses: number; note: string }

/** Журнал безопасности (auth-roadmap п.7): входы, выходы, неудачи, блокировки, смена пароля, 2FA. */
export type SecurityEventType = 'invite_created' | 'registered' | 'login' | 'login_failed' | 'login_locked' | 'login_2fa_failed' | 'logout' | 'logout_all' | 'session_revoked' | 'password_set' | 'twofactor_enabled' | 'twofactor_disabled' | 'user_blocked' | 'user_unblocked'
export interface SecurityEvent { id: number; at: number; user: string; type: SecurityEventType; ip: string; userAgent: string; details: string }

/** Диск с данными (roadmap-4 п.40): `alert` — свободно меньше `MAKE_DISK_ALERT_BYTES`. */
export interface AdminDiskStats { totalBytes: number; freeBytes: number; alert: boolean }
export const MAKE_DISK_ALERT_BYTES = 10 * 1024 ** 3

export interface AdminMakeStats {
  /** Свободное место на разделе с данными Make; null — узнать не удалось. */
  disk?: AdminDiskStats | null
  projects: number
  bytes: number
  filesBytes: number
  snapshotsBytes: number
  shotsBytes: number
  published: number
  shared: number
  views: number
  limitBytes: number
  /** Квота на пользователя (сумма его проектов); в byUser предупреждение при ≥ 80 %. */
  userLimitBytes: number
  byUser: AdminMakeUserStat[]
  /** Самые тяжёлые проекты (до 10). */
  top: AdminMakeProjectStat[]
}

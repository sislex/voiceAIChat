// Типы админ-страницы пользователей (только для роли admin).

import type { AgentInfo } from './agentProtocol'
import type { UserRole } from './types'
import type { LlmRunKind, LlmRunnerHealth } from './llm'

/** Машина в карточке человека: всё, кроме политики команд. */
export type AdminAgentInfo = Omit<AgentInfo, 'policy'>

/**
 * Профиль одного человека: то, что он вправе знать о себе сам. Админский
 * `AdminUserInfo` — это он же плюс поля надзора, поэтому одна и та же карточка
 * рисует и чужой профиль в админке, и свой на странице «Мой аккаунт».
 */
export interface UserProfileInfo {
  name: string
  role: UserRole
  blocked: boolean
  createdAt: number
  /** Временный пароль: пользователь обязан сменить его при входе (auth-roadmap п.11). */
  mustChangePassword?: boolean
  /** Подтверждённый email саморегистрации. */
  email?: string | null
  /** Последний вход (п.18) и месячный лимит расхода LLM (п.17). */
  lastLogin?: number | null
  llmLimitUsd?: number | null
  conversationCount: number
  /**
   * Машины-агенты пользователя с онлайн-статусом. Политика команд из списка
   * вырезана: она нужна разделу «Машины», а в списке людей это десятки
   * килобайт на каждого, которые никто не читает.
   */
  agents: AdminAgentInfo[]
  /**
   * Последняя активность живой сессии и их число. «Последний вход» для этого не
   * годится: человек, вошедший неделю назад и работающий прямо сейчас, по нему
   * выглядит неактивным.
   */
  lastSeenAt?: number | null
  liveSessions?: number
}

/** Пользователь в списке администрирования: профиль + состояние замков. */
export interface AdminUserInfo extends UserProfileInfo {
  /** Авто-блокировка после неудачных входов (auth-roadmap п.3). */
  failedLogins?: number
  lockedUntil?: number | null
  lockReason?: string | null
}

/**
 * Окно, внутри которого сессия считается активной «сейчас». Пять минут, а не
 * минута: `touchSession` обновляет `last_seen` не чаще раза в минуту, поэтому
 * узкое окно показывало бы работающего человека офлайн. Константа общая для
 * сервера и UI, чтобы список и метрика не расходились в трактовке.
 */
export const ACTIVE_WINDOW_MS = 5 * 60_000

/** Активен ли человек прямо сейчас по последней активности его сессий. */
export function isActiveNow(lastSeenAt: number | null | undefined, now: number): boolean {
  return lastSeenAt !== null && lastSeenAt !== undefined && now - lastSeenAt <= ACTIVE_WINDOW_MS
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
  /**
   * Сколько из них человек прервал (`TurnMeta.interrupted`). Доли «успешных»
   * ходов в системе нет и быть не может: неудавшийся ход сообщения не создаёт
   * вовсе, поэтому знаменателя не существует. Прерывание — единственный
   * зафиксированный признак незавершённого ответа.
   */
  interrupted?: number
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

/**
 * Потрачено по выборке. Codex часто не сообщает стоимость сам, а прайс покрывает
 * не все модели, поэтому берётся большая из двух оценок — та же формула, по
 * которой сервер проверяет месячный лимит (`turns.ts`). Держим её здесь, чтобы
 * UI и проверка лимита не разъехались в трактовке «сколько человек потратил».
 */
export function spendUsd(totals: Pick<UsageTotals, 'costUsd' | 'costFromPrices'>): number {
  return Math.max(totals.costUsd, totals.costFromPrices ?? 0)
}

/** Начало текущего календарного месяца в местном времени — граница «расхода за месяц». */
export function monthStart(now: number = Date.now()): number {
  const date = new Date(now)
  date.setDate(1)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * Доля израсходованного лимита (0..1+) или `null`, когда лимита нет. Проценту
 * бюджета неоткуда взяться без лимита: общего бюджета в системе не существует,
 * и рисовать «78%» от несуществующей величины нельзя.
 */
export function budgetShare(spent: number, limitUsd: number | null | undefined): number | null {
  return limitUsd === null || limitUsd === undefined || limitUsd <= 0 ? null : spent / limitUsd
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

/** Настройка открытой регистрации: включена ли и какую роль получают новые пользователи. */
export interface SignupConfig { enabled: boolean; role: UserRole; mailConfigured: boolean; ownedProjectLimit: number; /** Максимум живых сессий на пользователя; 0 — без ограничения. */ sessionLimit: number }

/** Инвайт на саморегистрацию (auth-roadmap п.8): роль, срок, лимит использований. */
export interface InviteInfo { token: string; role: UserRole; createdBy: string; createdAt: number; expiresAt: number; maxUses: number; uses: number; note: string; email: string | null; emailedAt: number | null }

/** Журнал безопасности (auth-roadmap п.7): входы, выходы, неудачи, блокировки, смена пароля, 2FA. */
export type SecurityEventType = 'agent_connected' | 'agent_rejected' | 'agent_token_rotated' | 'agent_token_revoked' | 'signup_requested' | 'signup_verified' | 'login_new_device' | 'inactive_blocked' | 'reset_code_issued' | 'password_reset' | 'password_changed' | 'invite_created' | 'project_invited' | 'project_invite_accepted' | 'registered' | 'login' | 'login_failed' | 'login_locked' | 'login_2fa_failed' | 'logout' | 'logout_all' | 'session_revoked' | 'session_renamed' | 'session_trusted' | 'session_untrusted' | 'session_evicted' | 'session_panic' | 'password_set' | 'twofactor_enabled' | 'twofactor_disabled' | 'user_blocked' | 'user_unblocked'
export interface SecurityEvent { id: number; at: number; user: string; type: SecurityEventType; ip: string; userAgent: string; details: string }

/** Метрики машины для админки и Prometheus (machines-roadmap п.5). */
export interface AdminMachineStat {
  id: string
  name: string
  owner: string
  online: boolean
  version?: string
  /** Команд всего / за 24 ч, ошибок (ненулевой код, таймаут, отказ) за 24 ч, средняя длительность за 24 ч. */
  commandsTotal: number
  commands24h: number
  errors24h: number
  avgDurationMs24h: number
  lastCommandAt: number | null
  /** Тревог watchdog «не в сети» за 30 дней и суммарный простой по ним (мс). */
  offlineEvents30d: number
  offlineMs30d: number
  /** Байт передано файлами за 24 ч (upload/copy — по журналу команд не видно; считаем write/read из fs — пока 0, поле для Prometheus). */
  cpuLoadPct?: number
  memUsedRatio?: number
  diskFreeBytes?: number
}
export interface AdminMachineStats {
  generatedAt: number
  machines: AdminMachineStat[]
  totals: { machines: number; online: number; commands24h: number; errors24h: number }
}

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

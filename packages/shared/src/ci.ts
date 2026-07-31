// Типы домена «CI-раннер»: справочник команд, раны, шаги, лог, fix-loop,
// рабочие директории, предложения модели, метрики и payload'ы realtime-событий.
// Разделяются server/web (desktop CI не получает). Чистые типы + пара хелперов.

import type { QuestionSpec } from './questions'

// --- Справочник команд ---------------------------------------------------

/** Область видимости команды. */
export type CiCommandScope = 'global' | 'project'

/** Слот привязки команды вокруг работы модели. */
export type CiSlot = 'before_model' | 'after_model'
export const CI_SLOTS: CiSlot[] = ['before_model', 'after_model']

/** Именованный переиспользуемый shell-скрипт из справочника. */
export interface CiCommand {
  id: string
  scope: CiCommandScope
  /** Проект для scope='project'; null для глобальной команды. */
  projectId: string | null
  name: string
  /** Многострочный скрипт (bash). */
  script: string
  description: string
  /** Рабочая директория относительно корня рана ('' — корень). */
  workdir: string
  /** Таймаут шага в секундах (0/undefined — из глобальных настроек). */
  timeoutSec: number | null
  /** Переменные окружения команды (имя → значение). */
  env: Record<string, string>
  /** Продолжать ран при ненулевом коде выхода. */
  allowFailure: boolean
  /** После успеха этой команды рабочая директория считается освобождённой. */
  isCleanup: boolean
  /** Доступна ли команда как инструмент модели. */
  availableToModel: boolean
  /** Версия текста команды (растёт при принятии предложения/правке скрипта). */
  version: number
  createdBy: string
  createdAt: number
  updatedAt: number
  /** Мягкое удаление: время удаления или null. */
  deletedAt: number | null
}

/** Поля создания/правки команды (частичные — для PATCH). */
export interface CiCommandInput {
  scope?: CiCommandScope
  projectId?: string | null
  name?: string
  script?: string
  description?: string
  workdir?: string
  timeoutSec?: number | null
  env?: Record<string, string>
  allowFailure?: boolean
  isCleanup?: boolean
  availableToModel?: boolean
}

/** Привязка команды к слоту (дефолт проекта или переопределение задачи). */
export interface CiSlotCommand {
  id: string
  ownerType: 'project' | 'task'
  ownerId: string
  slot: CiSlot
  commandId: string
  /** Порядок = порядок выполнения (дробный ранг не нужен: пересобираем целиком). */
  position: number
}

/** Слот-конфиг задачи/проекта в удобном для UI виде. */
export interface CiSlotConfig {
  beforeModel: string[] // commandId[] в порядке выполнения (могут повторяться)
  afterModel: string[]
}

/** Режим шага модели: сначала план с одобрением, либо сразу разработка. */
export type CiRunMode = 'plan' | 'development'
export const CI_RUN_MODES: CiRunMode[] = ['plan', 'development']

/**
 * Глубина уточнений: сколько вопросов модель имеет право задать за ран.
 * `none` — ни одного, `few` — до 3, `medium` — до 6, `detailed` — `clarifyMax` (1..30).
 */
export type CiClarifyLevel = 'none' | 'few' | 'medium' | 'detailed'
export const CI_CLARIFY_LEVELS: CiClarifyLevel[] = ['none', 'few', 'medium', 'detailed']

/** Верхняя граница числа вопросов для «детального уточнения». */
export const CI_CLARIFY_MAX_LIMIT = 30

/**
 * Движок, модель и режим запуска шага разработки; задача наследует настройку
 * проекта (см. `resolveTaskLlmConfig`).
 */
export interface CiLlmConfig {
  provider: CiLlmProvider
  model: string
  mode: CiRunMode
  clarifyLevel: CiClarifyLevel
  /** Используется только при `clarifyLevel === 'detailed'`. */
  clarifyMax: number
}

export const DEFAULT_CI_LLM_CONFIG: CiLlmConfig = {
  provider: 'claude',
  model: 'sonnet',
  mode: 'development',
  clarifyLevel: 'few',
  clarifyMax: 3
}

/** Сколько вопросов модель может задать за ран при данной настройке. */
export function clarifyBudget(c: Pick<CiLlmConfig, 'clarifyLevel' | 'clarifyMax'>): number {
  switch (c.clarifyLevel) {
    case 'none':
      return 0
    case 'few':
      return 3
    case 'medium':
      return 6
    case 'detailed':
      return Math.min(CI_CLARIFY_MAX_LIMIT, Math.max(1, Math.round(c.clarifyMax) || 1))
    default:
      return 0
  }
}

// --- Глобальные настройки CI ---------------------------------------------

export interface CiGlobalSettings {
  /** Лимит попыток исправления на один упавший шаг. */
  maxFixAttempts: number
  /** Страховка fix-loop по времени, мс (0 — без лимита). */
  fixTimeLimitMs: number
  /** Страховка fix-loop по токенам (0 — без лимита). */
  fixTokenLimit: number
  /** Таймаут шага по умолчанию, сек. */
  defaultStepTimeoutSec: number
  /** Сколько последних ранов учитывать в метриках по командам. */
  metricsWindow: number
  /** Лимит одновременных ранов на сервер. */
  maxConcurrentRuns: number
  /** Лимит вызовов команд моделью на один ран. */
  maxModelCommandCalls: number
  /** Сколько ждать ответа пользователя на вопрос/одобрение, мс (0 — без лимита). */
  interactionWaitMs: number
}

export const DEFAULT_CI_GLOBAL_SETTINGS: CiGlobalSettings = {
  maxFixAttempts: 3,
  fixTimeLimitMs: 10 * 60 * 1000,
  fixTokenLimit: 200_000,
  defaultStepTimeoutSec: 600,
  metricsWindow: 20,
  maxConcurrentRuns: 2,
  maxModelCommandCalls: 20,
  interactionWaitMs: 30 * 60 * 1000
}

/** Стратегия повторного запуска при существующей рабочей директории. */
export type CiReuseStrategy = 'reuse' | 'clean' | 'fail'
export const CI_REUSE_STRATEGIES: CiReuseStrategy[] = ['reuse', 'clean', 'fail']

/** CI-поля настроек проекта. */
export interface CiProjectSettings {
  baseBranch: string
  /** Шаблон ветки, напр. `feature/{task_number}-{slug}`. */
  branchTemplate: string
  reuseStrategy: CiReuseStrategy
  /** Ссылка на секрет для авторизации выполнения (или ''). */
  execAuthRef: string
}

// --- Ран и шаги ----------------------------------------------------------

/** Общий статус рана и шага. */
export type CiLlmProvider = 'claude' | 'codex'

export type CiStatus = 'queued' | 'running' | 'awaiting_input' | 'success' | 'failed' | 'cancelled' | 'timeout' | 'skipped'
export const CI_STATUSES: CiStatus[] = ['queued', 'running', 'awaiting_input', 'success', 'failed', 'cancelled', 'timeout', 'skipped']

/** Терминальные статусы рана. */
export function isTerminalCiStatus(s: CiStatus): boolean {
  return s === 'success' || s === 'failed' || s === 'cancelled' || s === 'timeout'
}

/**
 * Ран ещё идёт (в очереди, работает или ждёт ответа): повторный запуск задачи
 * недоступен, из действий остаётся только лента рана.
 */
export function isActiveCiStatus(s: CiStatus): boolean {
  return s === 'queued' || s === 'running' || s === 'awaiting_input'
}

/**
 * Доступен ли запуск рана задачи прямо сейчас (кнопка «Выполнить» на карточке и
 * в модалке). Завершённый ран запуску не мешает — ни успешный, ни упавший, ни
 * отменённый: «Выполнить» стартует новый полный ран, а не продолжает прошлый
 * (для продолжения есть «Повторить с упавшего шага» в ленте). Кнопки нет только
 * пока ран активен: в очереди, работает или стоит на паузе (`awaiting_input`).
 */
export function canStartCiRun(summary: { status: CiStatus } | null | undefined): boolean {
  return summary == null || !isActiveCiStatus(summary.status)
}

/**
 * Как подсветить карточку задачи по последнему рану:
 * `running` — медленно «дышит» голубым, `fixing` — модель разбирается с ошибкой
 * (медленно мигает красным), `awaiting` — ждёт ответа пользователя (часто мигает
 * жёлтым), `failed` — свалился окончательно (часто мигает красным), `done` —
 * разработка закончена, ждёт пересборки прода (статичная зелёная рамка).
 * `null` — подсветки нет (рана не было, отменён или пропущен).
 */
export type CiCardPulse = 'running' | 'fixing' | 'awaiting' | 'failed' | 'done'

export function ciCardPulse(
  summary: { status: CiStatus; slotProgress: Pick<CiSlotProgress, 'fixing'> } | null | undefined
): CiCardPulse | null {
  if (!summary) return null
  switch (summary.status) {
    case 'awaiting_input':
      return 'awaiting'
    case 'queued':
    case 'running':
      return summary.slotProgress.fixing ? 'fixing' : 'running'
    case 'failed':
    case 'timeout':
      return 'failed'
    case 'success':
      return 'done'
    default:
      return null
  }
}

/** Вид шага ленты рана. */
export type CiStepKind = 'command' | 'model_work' | 'model_command' | 'model_summary'

/** Кто инициировал шаг. */
export type CiInitiatedBy = 'user' | 'system' | 'model'

/** Один запуск воркфлоу для конкретной задачи. */
export interface CiRun {
  id: string
  projectId: string
  taskId: string
  /** Машина выполнения (agentId). */
  agentId: string | null
  status: CiStatus
  workspaceId: string | null
  /** Логин запустившего. */
  triggeredBy: string
  /** Колонка задачи до рана — для отката при Исходе B. */
  prevColumnId: string | null
  /** Провайдер и модель шага разработки; можно сменить при повторе упавшего model_work. */
  llmProvider: CiLlmProvider
  llmModel: string
  /** Снимок режима и глубины уточнений на момент запуска (повтор их сохраняет). */
  mode: CiRunMode
  clarifyLevel: CiClarifyLevel
  clarifyMax: number
  /** Связанный чат задачи, куда дублируются вопросы модели. */
  conversationId: string | null
  /** Прогресс по слотам: {done,total} для шкалы «1/4». */
  slotProgress: CiSlotProgress
  startedAt: number | null
  finishedAt: number | null
  durationMs: number | null
  createdAt: number
}

/** Прогресс воркфлоу (вызовы команд моделью НЕ учитываются). */
export interface CiSlotProgress {
  done: number
  total: number
  /** Читаемая фаза для шкалы карточки. */
  phase: string
  /** Модель прямо сейчас разбирается с упавшим шагом (fix-loop). */
  fixing?: boolean
}

/** Элемент ленты рана. */
export interface CiRunStep {
  id: string
  runId: string
  slot: CiSlot | null
  position: number
  kind: CiStepKind
  /** Вложенность (вызов команды моделью → parent = model_work). */
  parentStepId: string | null
  initiatedBy: CiInitiatedBy
  /** Ссылка на команду справочника (для command/model_command). */
  commandId: string | null
  /** Снапшот текста команды на момент рана (версионирование). */
  commandSnapshot: string | null
  /** Отображаемое имя шага. */
  title: string
  workdir: string | null
  status: CiStatus
  exitCode: number | null
  /** Номер попытки (fix-loop перезапускает упавший шаг). */
  attempt: number
  /** Шаг был доведён до успеха моделью в fix-loop. */
  fixedByModel: boolean
  startedAt: number | null
  finishedAt: number | null
  durationMs: number | null
}

/** Одна строка потокового лога (для реплея после reconnect). */
export interface CiLogLine {
  runId: string
  stepId: string
  /** Монотонный курсор в пределах рана. */
  seq: number
  stream: 'stdout' | 'stderr' | 'system'
  chunk: string
  at: number
}

// --- Интеракция: пауза рана в ожидании пользователя -----------------------

/** Что именно ждёт ран: уточняющие вопросы модели или одобрение плана. */
export type CiInteractionKind = 'clarify' | 'plan_approval'

export type CiInteractionStatus = 'pending' | 'answered' | 'cancelled'

/** Решение пользователя по плану. */
export type CiPlanDecision = 'approved' | 'rework'

/**
 * Одна пауза рана. Пока `status === 'pending'`, ран стоит в `awaiting_input`.
 * Ответить можно из ленты рана или из связанного чата — засчитывается первый.
 */
export interface CiInteraction {
  id: string
  runId: string
  /** Шаг ленты, внутри которого висит пауза (обычно `model_work`). */
  stepId: string
  /** Монотонный номер интеракции в пределах рана. */
  seq: number
  kind: CiInteractionKind
  /** Для `clarify` — вопросы модели; для `plan_approval` пусто. */
  questions: QuestionSpec[]
  /** Для `plan_approval` — текст плана. */
  planText: string | null
  /** Ответ пользователя (для плана — комментарий к доработке). */
  answerText: string | null
  decision: CiPlanDecision | null
  status: CiInteractionStatus
  /** Чат, куда продублирован вопрос, и id сообщения в нём. */
  conversationId: string | null
  messageId: string | null
  createdAt: number
  answeredAt: number | null
  answeredBy: string | null
}

/** Тело ответа на интеракцию (REST). */
export interface CiInteractionAnswer {
  text?: string
  decision?: CiPlanDecision
}

/** Полный снимок рана с шагами (ответ GET деталь рана). */
export interface CiRunDetail {
  run: CiRun
  steps: CiRunStep[]
  fixAttempts: CiFixAttempt[]
  /** Паузы рана — без них после reload pending-вопрос не восстановить. */
  interactions: CiInteraction[]
}

/** Краткая сводка рана по задаче — для доски/карточки. */
export interface CiRunSummary {
  id: string
  taskId: string
  status: CiStatus
  slotProgress: CiSlotProgress
  durationMs: number | null
  /** Активна ли работа модели прямо сейчас. */
  modelActive: boolean
  /** Ран стоит и ждёт ответа пользователя. */
  awaitingInput: boolean
}

// --- fix-loop ------------------------------------------------------------

/** Одна итерация цикла исправления упавшего шага моделью. */
export interface CiFixAttempt {
  id: string
  runStepId: string
  attemptNo: number
  /** Что именно сломалось (одна-две фразы). */
  diagnosis: string
  /** Что модель сделала. */
  action: string
  /** Итог итерации. */
  result: 'fixed' | 'retrying' | 'gave_up'
  /** Дифф изменений в рабочей директории. */
  diff: string | null
  durationMs: number | null
  tokensUsed: number | null
  createdAt: number
}

// --- Рабочие директории --------------------------------------------------

export interface CiWorkspace {
  id: string
  projectId: string
  taskId: string
  agentId: string | null
  path: string
  state: 'active' | 'released'
  /** Занимаемый объём в байтах (для отчёта по месту; null — не измерялся). */
  sizeBytes: number | null
  createdAt: number
  /** Шаг с is_cleanup, освободивший директорию, или null. */
  releasedByStepId: string | null
}

/** Строка отчёта по занятому месту. */
export interface CiWorkspaceReportItem extends CiWorkspace {
  taskTitle: string | null
  /** Осиротевшая: активна, но задача закрыта/удалена и cleanup не выполнялся. */
  orphaned: boolean
}

// --- Предложения модели по правке команды --------------------------------

export type CiSuggestionStatus = 'new' | 'accepted' | 'rejected'

export interface CiCommandSuggestion {
  id: string
  commandId: string
  runStepId: string | null
  /** Причина → предлагаемое изменение (текст). */
  reason: string
  /** Полный текст предлагаемой версии скрипта. */
  proposedScript: string
  status: CiSuggestionStatus
  /** Сколько раз встречалась однотипная рекомендация по этой команде. */
  occurrences: number
  createdAt: number
  resolvedBy: string | null
  resolvedAt: number | null
}

// --- Метрики -------------------------------------------------------------

/** Метрика по команде × проект (окно metrics_window). */
export interface CiCommandMetric {
  projectId: string
  commandId: string
  medianMs: number | null
  avgMs: number | null
  p90Ms: number | null
  /** Число успешных ранов, попавших в окно длительности. */
  samples: number
  /** Доля успехов по всем ранам команды в окне. */
  successRate: number
}

/** Метрика работы модели: среднее по последним 10 длительностям. */
export interface CiModelWorkMetric {
  projectId: string
  avgMs: number | null
  samples: number
}

// --- Аудит / история -----------------------------------------------------

export type CiEventActor = 'user' | 'model' | 'system'

export interface CiEvent {
  id: string
  projectId: string
  runId: string | null
  commandId: string | null
  type: string
  actorType: CiEventActor
  actorId: string | null
  payload: Record<string, unknown>
  createdAt: number
}

// --- Диагностическая консоль (US-6) --------------------------------------

export type CiConsoleMode = 'read_only' | 'edit'

/** Запрос выполнения команды в консоли рана. */
export interface CiConsoleExecRequest {
  runId: string
  command: string
}

export interface CiConsoleExecResult {
  output: string
  exitCode: number | null
  /** Команда отклонена белым списком read-only режима. */
  rejected: boolean
  message: string
}

// --- Realtime payload'ы (полезная нагрузка WS ci.*-сообщений) ------------

/** Причина завершения рана — для UI-заключения. */
export type CiFailureClass =
  | 'no_access'
  | 'no_secret'
  | 'version_mismatch'
  | 'script_error'
  | 'external_unavailable'
  | 'insufficient_permissions'
  | 'unknown'

/** Заключение модели при Исходе B. */
export interface CiRunConclusion {
  failureClass: CiFailureClass
  /** Что нужно от человека. */
  summary: string
}

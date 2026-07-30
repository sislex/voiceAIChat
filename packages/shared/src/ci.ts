// Типы домена «CI-раннер»: справочник команд, раны, шаги, лог, fix-loop,
// рабочие директории, предложения модели, метрики и payload'ы realtime-событий.
// Разделяются server/web (desktop CI не получает). Чистые типы + пара хелперов.

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

/** Движок и модель шага разработки; задача наследует настройку проекта. */
export interface CiLlmConfig {
  provider: CiLlmProvider
  model: string
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
}

export const DEFAULT_CI_GLOBAL_SETTINGS: CiGlobalSettings = {
  maxFixAttempts: 3,
  fixTimeLimitMs: 10 * 60 * 1000,
  fixTokenLimit: 200_000,
  defaultStepTimeoutSec: 600,
  metricsWindow: 20,
  maxConcurrentRuns: 2,
  maxModelCommandCalls: 20
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

export type CiStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled' | 'timeout' | 'skipped'
export const CI_STATUSES: CiStatus[] = ['queued', 'running', 'success', 'failed', 'cancelled', 'timeout', 'skipped']

/** Терминальные статусы рана. */
export function isTerminalCiStatus(s: CiStatus): boolean {
  return s === 'success' || s === 'failed' || s === 'cancelled' || s === 'timeout'
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

/** Полный снимок рана с шагами (ответ GET деталь рана). */
export interface CiRunDetail {
  run: CiRun
  steps: CiRunStep[]
  fixAttempts: CiFixAttempt[]
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

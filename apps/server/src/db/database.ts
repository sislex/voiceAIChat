import Database from 'better-sqlite3'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { MESSAGES_FTS_SQL, SCHEMA_SQL } from './schema'
import { toFtsMatchQuery } from './fts.js'
import { calculateKbHit, filesReadFromCiLog } from '../ci/kbHit.js'
import { testStages } from '../ci/testStages.js'
import {
  DEFAULT_SETTINGS,
  DEFAULT_AGENT_POLICY,
  DEFAULT_CODEX_MODEL,
  isProviderAllowed,
  firstAllowedProvider,
  clampModel,
  type AgentCreated,
  type AgentPolicy,
  type Conversation,
  type ConversationStatus,
  DEFAULT_CONVERSATION_STATUS,
  type DesktopMigrationBundle,
  type DesktopMigrationResult,
  type LlmProvider,
  type UserLlmAccess,
  type Message,
  type MessageAttachment,
  type MessageRole,
  type MessageSearchHit,
  type MessageSearchResult,
  type QueuedTurn,
  type QueueTurnPayload,
  type PermissionMode,
  type Settings,
  type TurnMeta,
  type UsageBucket,
  type UsageByModel,
  type UsageByConversation,
  type UsageReport,
  type UsageTotals,
  type UsageUnit,
  type UserRole,
  type AdminLlmEngine,
  type AdminLlmEngineInput,
  type ModelPrice,
  type ModelPriceInput,
  type LlmEngineKind,
  type Board,
  type KanbanColumn,
  type ProjectDetail,
  type ProjectMember,
  type ProjectSummary,
  type Task,
  type TaskRunResult,
  normalizeTaskRunOutcome,
  type TaskPriority,
  type WorkItemType,
  type WorkItemDefaultSkills,
  type KanbanColumnSemanticType,

  estimateKbTokens,
  type KbDocumentKind,
  type KbScope,
  type KbFreshness,
  type KbMatchType,
  type KbProjectUsageReport,
  type KbUsageQuery,
  type KbUsageReport,
  type KbUsageSectionAggregate,
  type KbUsageSectionRef,
  type KbUsageSource,
  type KbUsageStatus,
  type KbContextMode,
  type KbRunUsageReport,
  type KbTaskUsageReport,
  type KbUsageTotals,
  type CiCommand,
  type CiCommandInput,
  type CiCommandScope,
  type CiSlot,
  type CiSlotConfig,
  type CiLlmConfig,
  DEFAULT_CI_CLAUDE_MODEL,
  CI_KB_UPDATE_COMMAND_ID,
  CI_KB_UPDATE_COMMAND_NAME,
  DEFAULT_CI_LLM_CONFIG,
  type CiRunMode,
  type CiClarifyLevel,
  CI_CLARIFY_MAX_LIMIT,
  type CiInteraction,
  type CiInteractionKind,
  type CiInteractionStatus,
  type CiPlanDecision,
  type QuestionSpec,
  type TaskChatBadge,
  type TaskChatContext,
  type TaskChatCrumb,
  issueKey,
  isCompletedHidden,
  compareTasksInColumn,
  DEFAULT_DONE_RETENTION_DAYS,
  type CiGlobalSettings,
  DEFAULT_CI_GLOBAL_SETTINGS,
  type CiRun,
  type MergeRun,
  type TaskRepository,
  ACTIVE_MERGE_STATUSES,
  type CiRunDetail,
  type CiExecutionLlmSnapshot,
  type CiStageRun,
  type CiRunStep,
  type CiStatus,
  type CiStepKind,
  type CiInitiatedBy,
  type CiSlotProgress,
  type CiLogLine,
  type CiFixAttempt,
  type CiFixDiagnosticContext,
  type CiTargetedTestRun,
  type CiTestFailure,
  type CiWorkspace,
  type CiWorkspaceReportItem,
  type CiCommandSuggestion,
  type CiRunSummary,
  type CiCommandMetric,
  type CiModelWorkMetric,
  type CiEventActor,
  type CiRunUsage,
  type CiUsageKind,
  CI_USAGE_KINDS,
  type CiStageLlmSelection,
  type CiStageLlmSnapshot,
  resolveCiStageLlm,
  type CiInputSemantics,
  type CiToolCalls,
  type CiToolChars,
  type CiToolKind,
  type CiRunToolResponse,
  type CiRunReport,
  type CiRunReportStep,
  type CiTaskReport,
  type TaskTimeline,
  type TaskTimelineAttempt,
  type TaskTimelineStage,
  type TaskTimelineStatus,
  mergedTimelineDuration,
  subtractTimelineIntervals,
  timelineDuration,
  timelineIso,
  type KbGapNote,
  CI_TOOL_KINDS,
  CI_TOOL_RESPONSES_KEEP,
  CI_TOOL_RESPONSES_SHOWN,
  EMPTY_CI_TOOL_CALLS,
  EMPTY_CI_TOOL_CHARS,
  ciTaskTotals,
  ciUsageStages,
  ciUsageTotals,
  normCiStageModels,
  buildCiAutomationProgress,
  isVerificationCommand,
  canCompleteQa,
  canCompleteComponentQa,
  componentQaLaunchReasons,
  componentQaSemanticVersion,
  canTransitionWorkflow,
  validateQaResult,
  QA_RESULT_STATUSES,
  type AcceptanceCriterion,
  type AcceptanceCriterionSnapshot,
  type AcceptanceCriterionVersion,
  type QaTaskState,
  type TaskPreparationRun,
  type PreparationEvent,
  type PreparationQuestion,
  type PreparationAnswerResult,
  type PreparationClarificationNotification,
  type TaskPreparationPhase,
  type PreparationGateResult,
  redactPreparationText,
  developmentReadinessGateResults,
  type TaskLaunchResult,
  type DevelopmentReadiness,
  type AnyQaStageRun,
  type QaRunStage,
  type QaStageRunStatus,
  QA_RUN_KIND,
  canCompleteAutomation,
  type QaSession,
  type QaCriterionResult,
  type QaAttachment,
  type QaIssue,
  type QaResultStatus,
  type QaIssueClassification,
  type QaSeverity,
  type QaFrequency,
  type ComponentQaRun,
  type ComponentQaTaskState,
  type ComponentQaScenarioSnapshot,
  type ComponentQaCommandResult,
  type ComponentQaArtifact,
  type IntegrationTestRun,
  type IntegrationTestTaskState,
  type IntegrationTestCommandResult,
  integrationTestSemanticVersion,
  integrationTestGate,
  RELEASE_STEP_ORDER,
  type ProjectRelease,
  type ReleaseStepKind,
  type ReleaseStepStatus,
  type ReleaseTimeouts,
  DEFAULT_RELEASE_TIMEOUTS,
  validateReleaseTimeouts,
  releaseStepLimit
} from '@voicechat/shared'
import { hashPassword, verifyPassword } from '../users/passwords.js'

/** Инъектируемые зависимости — для детерминированных тестов. */
export interface DbDeps {
  /** Генератор id (по умолчанию crypto.randomUUID). */
  newId?: () => string
  /** Источник текущего времени в мс (по умолчанию Date.now). */
  now?: () => number
}

/** Ключ настроек per-user в key-value таблице settings (`app:<userId>`). */
function settingsKey(userId: string): string {
  return `app:${userId}`
}

interface ConversationRow {
  id: string
  title: string
  created_at: number
  updated_at: number
  claude_session_id: string | null
  exec_target: string | null
  workdir: string | null
  skill_names: string | null
  llm_engine_id: string | null
  llm_provider: string | null
  llm_model: string | null
  permission_mode: string | null
  kb_context_mode: string | null
  project_id: string | null
  preview_url: string | null
  task_id: string | null
  assistant_kind: string | null
  status: string | null
  last_exec_target?: string | null
}


interface AgentRow {
  id: string
  name: string
  token_hash: string
  created_at: number
  last_seen: number | null
  policy: string | null
  user_id: string | null
}

/** Запись пользователя приложения (без хеша пароля наружу). */
export interface UserRow {
  name: string
  role: UserRole
  blocked: boolean
  createdAt: number
}

interface UserDbRow {
  name: string
  password_hash: string
  role: string
  blocked: number
  created_at: number
}

interface LlmEngineRow {
  id: string
  name: string
  kind: string
  base_url: string
  token: string
  enabled: number
  allowed_roles: string
  is_default: number
  created_at: number
}

/** Запись машины-агента из БД (онлайн-статус добавляется реестром). */
export interface AgentRecord {
  id: string
  name: string
  createdAt: number
  lastSeen: number | null
  policy: AgentPolicy
  /** Владелец машины (пользователь, создавший её). */
  userId: string | null
}

/** Парсит JSON-политику из БД с откатом к дефолту (терпит старые/битые строки). */
function parsePolicy(raw: string | null): AgentPolicy {
  if (!raw) return { ...DEFAULT_AGENT_POLICY }
  try {
    return { ...DEFAULT_AGENT_POLICY, ...(JSON.parse(raw) as Partial<AgentPolicy>) }
  } catch {
    return { ...DEFAULT_AGENT_POLICY }
  }
}

/** sha256(token) в hex — токены храним только хэшем. */
export function hashAgentToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Разбор JSON meta сообщения; битый/пустой → undefined (не роняет чтение ленты). */
function parseMeta(raw: string): TurnMeta | undefined {
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === 'object' ? (v as TurnMeta) : undefined
  } catch {
    return undefined
  }
}

/** Старые/битые метаданные не должны ломать восстановление ленты. */
function parseAttachments(raw: string | null): MessageAttachment[] | undefined {
  if (!raw) return undefined
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return undefined
    const files = value.filter((item): item is MessageAttachment => Boolean(item) && typeof item === 'object' && typeof (item as MessageAttachment).path === 'string' && typeof (item as MessageAttachment).name === 'string' && typeof (item as MessageAttachment).mimeType === 'string' && typeof (item as MessageAttachment).size === 'number')
    return files.length ? files : undefined
  } catch {
    return undefined
  }
}

interface MessageRow {
  id: string
  conversation_id: string
  role: string
  text: string
  time: string
  created_at: number
  engine: string | null
  meta: string | null
  exec_target: string | null
  attachments: string | null
  state: string
  history_position: number | null
}

/**
 * Условие «беседа не является чатом завершённой задачи»: чат либо не привязан к
 * задаче, либо её колонка не имеет семантики `done`. Проверяем колонку, а не
 * `tasks.done_at`, чтобы возврат задачи в работу возвращал чат в список сразу.
 */
const NOT_DONE_TASK_CHAT = `(c.task_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM tasks t JOIN kanban_columns k ON k.id = t.column_id
    WHERE t.id = c.task_id AND k.semantic_type = 'done'))`

/** Отменённые задачи не входят ни в одну стандартную выборку разговоров. */
const NOT_CANCELLED_TASK_CHAT = `(c.task_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM tasks t JOIN kanban_columns k ON k.id = t.column_id
    WHERE t.id = c.task_id AND k.semantic_type = 'cancelled'))`

/** Шаг дробного ранга для порядка колонок/задач. */
const RANK_STEP = 1024
/** Порог схлопывания дробного ранга — ниже него колонка ренормализуется. */
const RANK_EPS = 1e-6

/** Заголовок автозадачи учёта «влито в прод-ветку, но прод не пересобран». */
export const PROD_REBUILD_TASK_TITLE = 'Пересборка прода'
/** Первая строка описания автозадачи — дальше идёт список вмерженных задач. */
export const PROD_REBUILD_TASK_INTRO = 'Влито в прод-ветку, но прод-контейнер в ране не пересобирался. Пересобрать прод для задач:'

interface ProjectRow {
  id: string
  name: string
  description: string
  git_url: string | null
  preview_url: string | null
  technologies: string
  skills: string
  created_by: string
  created_at: number
  updated_at: number
  default_agent_id: string | null
  commit_policy: string
  merge_transport: string
  agent_plan_approval_mode: string
  test_command: string
  production_deploy_command: string
  production_agent_id: string | null
  production_checkout_path: string
  production_health_check_command: string
  release_timeouts_json: string
  default_skills_epic: string
  default_skills_story: string
  default_skills_task: string
  ci_base_branch: string
  ci_branch_template: string
  ci_reuse_strategy: string
  ci_exec_auth_ref: string
  ci_kb_context_mode: string
  ci_test_fix_cycle_limit: number
  done_retention_days: number | null
}

interface ProjectMemberRow {

  username: string
  role: string
  added_at: number
}

interface ColumnRow {
  id: string
  project_id: string
  name: string
  semantic_type: string
  position: number
  hidden: number
  wip_limit: number | null
  created_at: number
}

interface TaskRow {
  id: string
  project_id: string
  column_id: string
  title: string
  description: string
  acceptance_criteria: string
  type: string
  parent_id: string | null
  priority: string
  assignee: string | null
  created_by: string | null
  created_by_name: string | null
  agent_id: string | null
  labels: string | null
  skills: string | null
  story_points: number | null
  due_date: number | null
  flagged: number
  done_at: number | null
  preview_ready: number
  seq: number | null
  position: number
  created_at: number
  updated_at: number
  chat_id?: string | null
  merge_source_branch?: string | null
  merge_source_sha?: string | null
  active_merge_run_id?: string | null
  latest_merge_run_id?: string | null
  active_merge_status?: string | null
  merge_permitted?: number
  merge_machine_bound?: number
  merged_sha?: string | null
  merged_source_sha?: string | null
  task_preparation_run_id?: string | null
  task_preparation_status?: string | null
  task_preparation_error?: string | null
  task_preparation_log?: string | null
}


/** Нормализация статуса чата из колонки (мусор → дефолт). */
const CONVERSATION_STATUS_SET = new Set<ConversationStatus>([
  'planned',
  'developing',
  'planning_done',
  'development_done',
  'done'
])
function normStatus(raw: string | null): ConversationStatus {
  return raw && CONVERSATION_STATUS_SET.has(raw as ConversationStatus)
    ? (raw as ConversationStatus)
    : DEFAULT_CONVERSATION_STATUS
}

/** Разбор JSON-массива строк из колонки (терпит битые значения). */
function parseStringArray(raw: string | null): string[] {
  try {
    const v = JSON.parse(raw ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Разбор JSON-объекта из колонки; битое или пустое значение — `null`. */
function parseJsonObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function parseAllowedRoles(raw: string | null): UserRole[] {
  return parseStringArray(raw).map((role) => role === 'user' ? 'developer' : role).filter((role): role is UserRole => role === 'admin' || role === 'developer' || role === 'tester' || role === 'observer')
}

function normEngineKind(raw: string): LlmEngineKind {
  return raw === 'codex' ? 'codex' : 'claude'
}

/** Валидный приоритет (неизвестное → medium). */
function normPriority(raw: string): TaskPriority {
  return raw === 'low' || raw === 'high' || raw === 'urgent' || raw === 'medium' ? raw : 'medium'
}

function normColumnSemantic(raw: string): KanbanColumnSemanticType {
  return raw === 'backlog' || raw === 'preparation' || raw === 'ready' || raw === 'development' || raw === 'component_qa' || raw === 'integration_tests' || raw === 'automated_qa' || raw === 'testing' || raw === 'qa_preparation' || raw === 'manual_qa' || raw === 'awaiting_merge' || raw === 'merge' || raw === 'decision_required' || raw === 'done' || raw === 'cancelled' ? raw : 'custom'
}

function normWorkItemType(raw: string): WorkItemType {
  return raw === 'epic' || raw === 'story' ? raw : 'task'
}

function mapColumn(r: ColumnRow): KanbanColumn {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    semanticType: normColumnSemantic(r.semantic_type),
    position: r.position,
    hidden: r.hidden !== 0,
    wipLimit: r.wip_limit ?? null,
    createdAt: r.created_at
  }
}

function mapTask(r: TaskRow): Task {
  return {
    id: r.id,
    projectId: r.project_id,
    columnId: r.column_id,
    type: normWorkItemType(r.type),
    parentId: r.parent_id,
    title: r.title,
    description: r.description,
    acceptanceCriteria: r.acceptance_criteria,
    priority: normPriority(r.priority),
    assignee: r.assignee,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    agentId: r.agent_id ?? null,
    labels: parseStringArray(r.labels),
    skills: parseStringArray(r.skills),
    storyPoints: r.story_points ?? null,

    dueDate: r.due_date ?? null,
    flagged: r.flagged !== 0,
    doneAt: r.done_at ?? null,
    previewReady: r.preview_ready !== 0,
    seq: r.seq ?? 0,
    position: r.position,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    chatId: r.chat_id ?? null,
    mergeSourceBranch: r.merge_source_branch ?? null,
    mergeSourceSha: r.merge_source_sha ?? null,
    activeMergeRunId: r.active_merge_run_id ?? null,
    latestMergeRunId: r.latest_merge_run_id ?? null,
    activeMergeStatus: r.active_merge_status ?? null,
    mergePermitted: r.merge_permitted !== 0,
    mergeMachineBound: r.merge_machine_bound !== 0,
    mergedSha: r.merged_sha ?? null,
    mergedSourceSha: r.merged_source_sha ?? null,
    taskPreparationRunId: r.task_preparation_run_id ?? null,
    taskPreparationStatus: (r.task_preparation_status as Task['taskPreparationStatus']) ?? null,
    taskPreparationError: r.task_preparation_error ?? null,
    taskPreparationLog: r.task_preparation_log ?? null
  }
}


// ---- Полнотекстовый поиск: константы и служебные типы --------------------

/** Имя индекса в `fts_state` (пока индексируются только сообщения). */
const FTS_MESSAGES = 'messages'
/** Сколько сообщений индексируем за одну порцию бэкфилла. */
const FTS_BACKFILL_CHUNK = 500
/** Пауза между порциями: старт и запросы не должны стоять в очереди за индексом. */
const FTS_BACKFILL_PAUSE_MS = 25
/** Предохранитель для `ensureMessagesIndexed` (500 × 20000 = 10 млн сообщений). */
const FTS_BACKFILL_MAX_CHUNKS = 20_000
/** Сколько раз готовы пересобрать индекс после проваленной integrity-check. */
const FTS_MAX_REPAIRS = 1
/** Длина сниппета в токенах (максимум, который допускает FTS5, — 64). */
const SNIPPET_TOKENS = 12
/** Границы размера страницы результатов. */
const SEARCH_LIMIT_DEFAULT = 20
const SEARCH_LIMIT_MAX = 50

/** Параметры поиска по сообщениям. */
export interface MessageSearchOptions {
  q: string
  /** undefined — по всем беседам, null — только беседы без проекта. */
  projectId?: string | null
  conversationId?: string
  limit?: number
  cursor?: string | null
}

interface MessageSearchRow {
  message_id: string
  conversation_id: string
  role: string
  created_at: number
  time: string
  rid: number
  conversation_title: string
  project_id: string | null
  score: number
  snippet: string
}

interface FtsStateRow {
  lastRowid: number
  maxRowid: number
  done: number
  repairs: number
}

function clampSearchLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) return SEARCH_LIMIT_DEFAULT
  return Math.min(Math.max(Math.trunc(limit), 1), SEARCH_LIMIT_MAX)
}

/** Курсор — непрозрачная строка: пара (bm25, rowid) последней выданной строки. */
function encodeSearchCursor(score: number, rowid: number): string {
  return Buffer.from(`${score}|${rowid}`, 'utf8').toString('base64url')
}

function decodeSearchCursor(cursor: string | null | undefined): { score: number; rowid: number } | null {
  if (!cursor) return null
  // Подделанный/устаревший курсор — не ошибка запроса: просто первая страница.
  const [rawScore, rawRowid] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
  const score = Number(rawScore)
  const rowid = Number(rawRowid)
  if (!Number.isFinite(score) || !Number.isInteger(rowid)) return null
  return { score, rowid }
}

/**
 * Обёртка над SQLite: разговоры, сообщения, спикеры, настройки.
 * Не зависит от Electron — путь к файлу передаётся снаружи
 * (`:memory:` в тестах, `userData/voicechat.db` в приложении).
 */
export class VoiceChatDb {
  private readonly db: Database.Database
  private readonly newId: () => string
  private readonly now: () => number
  /** Close-события WebSocket могут прийти после teardown; закрытую БД больше не трогаем. */
  private closed = false
  /** Доступен ли FTS5 в этой сборке SQLite (иначе поиск по сообщениям пустой). */
  private ftsReady = false
  /** Таймер следующей порции бэкфилла индекса; null — порция не запланирована. */
  private ftsTimer: ReturnType<typeof setTimeout> | null = null

  constructor(filename: string, deps: DbDeps = {}) {
    this.db = new Database(filename)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    // Unicode-lower для регистронезависимого поиска (SQLite LIKE/lower() — только ASCII).
    this.db.function('ulower', (s: unknown) => (typeof s === 'string' ? s.toLowerCase() : ''))
    this.db.exec(SCHEMA_SQL)
    // До `migrate()`: миграции тоже пишут строки (например, недостающие
    // workflow-колонки канбана) и требуют уже готовых `newId`/`now`.
    this.newId = deps.newId ?? (() => randomUUID())
    this.now = deps.now ?? (() => Date.now())
    this.migrate()
    this.ensureKbUpdateCommand()
    this.pruneDevelopmentAfterModelCommands()
    this.setupMessagesFts()
  }

  /** Лёгкие миграции существующих БД (idempotent). */
  private migrate(): void {
    // CHAT-193: legacy `user` becomes developer; only the two known ChatAI
    // accounts are elevated. Future accounts are never promoted implicitly.
    this.db.prepare(`UPDATE users SET role = 'developer' WHERE role = 'user'`).run()
    this.db.prepare(`UPDATE users SET role = 'admin' WHERE name IN ('admin', 'admin1')`).run()
    this.db.prepare(`UPDATE llm_engines SET allowed_roles = replace(allowed_roles, '"user"', '"developer"') WHERE allowed_roles LIKE '%"user"%'`).run()

    const preparationCols = this.db.prepare(`PRAGMA table_info(task_preparation_runs)`).all() as Array<{ name: string }>
    const addPreparationColumn = (name: string, sql: string): void => {
      if (preparationCols.length && !preparationCols.some((column) => column.name === name)) this.db.exec(sql)
    }
    addPreparationColumn('phase', `ALTER TABLE task_preparation_runs ADD COLUMN phase TEXT NOT NULL DEFAULT 'initialization'`)
    addPreparationColumn('task_key', `ALTER TABLE task_preparation_runs ADD COLUMN task_key TEXT NOT NULL DEFAULT ''`)
    addPreparationColumn('llm_engine_id', `ALTER TABLE task_preparation_runs ADD COLUMN llm_engine_id TEXT`)
    addPreparationColumn('provider', `ALTER TABLE task_preparation_runs ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude'`)
    addPreparationColumn('model', `ALTER TABLE task_preparation_runs ADD COLUMN model TEXT NOT NULL DEFAULT ''`)
    addPreparationColumn('profile_id', `ALTER TABLE task_preparation_runs ADD COLUMN profile_id TEXT NOT NULL DEFAULT ''`)
    addPreparationColumn('gate_results_json', `ALTER TABLE task_preparation_runs ADD COLUMN gate_results_json TEXT NOT NULL DEFAULT '[]'`)
    addPreparationColumn('started_at', `ALTER TABLE task_preparation_runs ADD COLUMN started_at INTEGER`)
    if (preparationCols.length) {
      this.db.exec(`DROP INDEX IF EXISTS idx_task_preparation_active; CREATE UNIQUE INDEX idx_task_preparation_active ON task_preparation_runs(task_id) WHERE status IN ('queued','running','waiting_for_answer','validating')`)
    }

    const agentCols = this.db.prepare(`PRAGMA table_info(agents)`).all() as Array<{ name: string }>
    if (!agentCols.some((c) => c.name === 'policy')) {
      this.db.exec(`ALTER TABLE agents ADD COLUMN policy TEXT`)
    }
    if (!agentCols.some((c) => c.name === 'user_id')) {
      this.db.exec(`ALTER TABLE agents ADD COLUMN user_id TEXT`)
    }
    const convCols = this.db
      .prepare(`PRAGMA table_info(conversations)`)
      .all() as Array<{ name: string }>
    if (!convCols.some((c) => c.name === 'user_id')) {
      this.db.exec(`ALTER TABLE conversations ADD COLUMN user_id TEXT`)
    }
    if (!convCols.some((c) => c.name === 'exec_target')) {
      this.db.exec(`ALTER TABLE conversations ADD COLUMN exec_target TEXT`)
    }
    if (!convCols.some((c) => c.name === 'workdir')) {
      this.db.exec(`ALTER TABLE conversations ADD COLUMN workdir TEXT`)
    }
    if (!convCols.some((c) => c.name === 'skill_names')) {
      this.db.exec(`ALTER TABLE conversations ADD COLUMN skill_names TEXT NOT NULL DEFAULT '[]'`)
    }
    if (!convCols.some((c) => c.name === 'llm_engine_id')) {
      this.db.exec(`ALTER TABLE conversations ADD COLUMN llm_engine_id TEXT`)
    }
    if (!convCols.some((c) => c.name === 'llm_provider')) {
      this.db.exec(`ALTER TABLE conversations ADD COLUMN llm_provider TEXT`)
    }
    if (!convCols.some((c) => c.name === 'llm_model')) {
      this.db.exec(`ALTER TABLE conversations ADD COLUMN llm_model TEXT`)
    }
    if (!convCols.some((c) => c.name === 'permission_mode')) {
      this.db.exec(`ALTER TABLE conversations ADD COLUMN permission_mode TEXT`)
    }
    if (!convCols.some((c) => c.name === 'kb_context_mode')) {
      this.db.exec(`ALTER TABLE conversations ADD COLUMN kb_context_mode TEXT NOT NULL DEFAULT 'auto'`)
    }
    if (!convCols.some((c) => c.name === 'project_id')) {
      this.db.exec(`ALTER TABLE conversations ADD COLUMN project_id TEXT`)
    }
    if (!convCols.some((c) => c.name === 'preview_url')) {
      this.db.exec(`ALTER TABLE conversations ADD COLUMN preview_url TEXT`)
    }
    if (!convCols.some((c) => c.name === 'task_id')) {
      this.db.exec(`ALTER TABLE conversations ADD COLUMN task_id TEXT`)
    }
    if (!convCols.some((c) => c.name === 'assistant_kind')) {
      this.db.exec(`ALTER TABLE conversations ADD COLUMN assistant_kind TEXT`)
    }
    if (!convCols.some((c) => c.name === 'status')) {
      this.db.exec(`ALTER TABLE conversations ADD COLUMN status TEXT NOT NULL DEFAULT 'developing'`)
    }
    // Проекты (итерация 2): папка на машину + машина по умолчанию.
    const projCols = this.db.prepare(`PRAGMA table_info(projects)`).all() as Array<{ name: string }>
    if (projCols.length && !projCols.some((c) => c.name === 'default_agent_id')) {
      this.db.exec(`ALTER TABLE projects ADD COLUMN default_agent_id TEXT`)
    }
    const memberCols = this.db.prepare(`PRAGMA table_info(project_members)`).all() as Array<{ name: string }>
    if (memberCols.length && !memberCols.some((c) => c.name === 'qa_permission')) {
      this.db.exec(`ALTER TABLE project_members ADD COLUMN qa_permission INTEGER NOT NULL DEFAULT 0`)
    }
    // Старые проекты могли хранить владельца только в projects.created_by.
    // PK project_members исключает дубли и сохраняет роли уже существующих участников.
    if (memberCols.length) {
      this.db.exec(`
        INSERT OR IGNORE INTO project_members (project_id, username, role, added_at)
        SELECT id, created_by, 'owner', created_at FROM projects
      `)
    }
    const pmCols = this.db.prepare(`PRAGMA table_info(project_machines)`).all() as Array<{ name: string }>
    if (pmCols.length && !pmCols.some((c) => c.name === 'path')) {
      this.db.exec(`ALTER TABLE project_machines ADD COLUMN path TEXT NOT NULL DEFAULT ''`)
    }
    // Корень рабочих копий переехал от Feature Run к CI-раннеру — только имя колонки.
    if (pmCols.length && pmCols.some((c) => c.name === 'feature_repos_root') && !pmCols.some((c) => c.name === 'repos_root')) {
      this.db.exec(`ALTER TABLE project_machines RENAME COLUMN feature_repos_root TO repos_root`)
    } else if (pmCols.length && !pmCols.some((c) => c.name === 'repos_root')) {
      this.db.exec(`ALTER TABLE project_machines ADD COLUMN repos_root TEXT NOT NULL DEFAULT ''`)
    }
    if (pmCols.length && !pmCols.some((c) => c.name === 'ssh_host')) {
      this.db.exec(`ALTER TABLE project_machines ADD COLUMN ssh_host TEXT NOT NULL DEFAULT ''`)
    }
    if (pmCols.length && !pmCols.some((c) => c.name === 'ssh_user')) {
      this.db.exec(`ALTER TABLE project_machines ADD COLUMN ssh_user TEXT NOT NULL DEFAULT ''`)
    }
    if (pmCols.length && !pmCols.some((c) => c.name === 'added_at')) {
      this.db.exec(`ALTER TABLE project_machines ADD COLUMN added_at INTEGER NOT NULL DEFAULT 0`)
    }
    if (pmCols.length && !pmCols.some((c) => c.name === 'added_by')) {
      this.db.exec(`ALTER TABLE project_machines ADD COLUMN added_by TEXT NOT NULL DEFAULT ''`)
    }
    for (const t of ['agent_tasks', 'feature_deployments', 'feature_events', 'features', 'repository_slots']) {
      this.db.exec(`DROP TABLE IF EXISTS ${t}`)
    }
    const taskCols = this.db.prepare(`PRAGMA table_info(tasks)`).all() as Array<{ name: string }>
    if (taskCols.length && !taskCols.some((c) => c.name === 'type')) this.db.exec(`ALTER TABLE tasks ADD COLUMN type TEXT NOT NULL DEFAULT 'task'`)
    if (taskCols.length && !taskCols.some((c) => c.name === 'parent_id')) this.db.exec(`ALTER TABLE tasks ADD COLUMN parent_id TEXT`)
    if (taskCols.length && !taskCols.some((c) => c.name === 'acceptance_criteria')) this.db.exec(`ALTER TABLE tasks ADD COLUMN acceptance_criteria TEXT NOT NULL DEFAULT ''`)
    // Старым карточкам автора не угадываем: NULL отображается как «Нет данных».
    if (taskCols.length && !taskCols.some((c) => c.name === 'created_by')) this.db.exec(`ALTER TABLE tasks ADD COLUMN created_by TEXT`)
    if (taskCols.length && !taskCols.some((c) => c.name === 'created_by_name')) this.db.exec(`ALTER TABLE tasks ADD COLUMN created_by_name TEXT`)
    // NULL у старых карточек сохраняет прежнее поведение: машина проекта по умолчанию.
    if (taskCols.length && !taskCols.some((c) => c.name === 'agent_id')) this.db.exec(`ALTER TABLE tasks ADD COLUMN agent_id TEXT`)
    if (taskCols.length && !taskCols.some((c) => c.name === 'labels')) this.db.exec(`ALTER TABLE tasks ADD COLUMN labels TEXT NOT NULL DEFAULT '[]'`)
    if (taskCols.length && !taskCols.some((c) => c.name === 'skills')) this.db.exec(`ALTER TABLE tasks ADD COLUMN skills TEXT NOT NULL DEFAULT '[]'`)

    if (taskCols.length && !taskCols.some((c) => c.name === 'story_points')) this.db.exec(`ALTER TABLE tasks ADD COLUMN story_points REAL`)
    if (taskCols.length && !taskCols.some((c) => c.name === 'due_date')) this.db.exec(`ALTER TABLE tasks ADD COLUMN due_date INTEGER`)
    if (taskCols.length && !taskCols.some((c) => c.name === 'flagged')) this.db.exec(`ALTER TABLE tasks ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0`)
    // Момент завершения задачи: отсчёт срока, после которого карточка уходит с
    // доски. Уже лежащим в done проставляем время последней правки — иначе они
    // остались бы на доске навсегда.
    if (taskCols.length && !taskCols.some((c) => c.name === 'done_at')) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN done_at INTEGER`)
      this.db.exec(`
        UPDATE tasks SET done_at = updated_at
        WHERE column_id IN (SELECT id FROM kanban_columns WHERE semantic_type = 'done')
      `)
    }
    if (taskCols.length && !taskCols.some((c) => c.name === 'preview_ready')) this.db.exec(`ALTER TABLE tasks ADD COLUMN preview_ready INTEGER NOT NULL DEFAULT 0`)
    if (taskCols.length && !taskCols.some((c) => c.name === 'seq')) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN seq INTEGER`)
      // Номер по порядку создания в проекте — как ключи PRJ-1, PRJ-2 в Jira.
      this.db.exec(`UPDATE tasks SET seq = (
        SELECT COUNT(*) FROM tasks t2
        WHERE t2.project_id = tasks.project_id
          AND (t2.created_at < tasks.created_at OR (t2.created_at = tasks.created_at AND t2.id <= tasks.id))
      ) WHERE seq IS NULL`)
    }
    // Связанные чаты задач раньше назывались просто заголовком карточки. Префикс
    // ставим только тем, кого пользователь не переименовывал (имя = заголовок
    // задачи) — чужие названия не трогаем. Повторно не срабатывает: после правки
    // имя уже не совпадает с заголовком.
    if (taskCols.length) {
      this.db.exec(`
        UPDATE conversations SET title = 'Задача ' || title
        WHERE task_id IS NOT NULL
          AND title NOT LIKE 'Задача %'
          AND title = (SELECT t.title FROM tasks t WHERE t.id = conversations.task_id)
      `)
    }
    // Счётчик ключей задач проекта: номера не переиспользуются (как в Jira).
    if (projCols.length && !projCols.some((c) => c.name === 'task_seq')) {
      this.db.exec(`ALTER TABLE projects ADD COLUMN task_seq INTEGER NOT NULL DEFAULT 0`)
      this.db.exec(`UPDATE projects SET task_seq = (SELECT COALESCE(MAX(seq), 0) FROM tasks WHERE tasks.project_id = projects.id)`)
    }
    const colCols = this.db.prepare(`PRAGMA table_info(kanban_columns)`).all() as Array<{ name: string }>
    if (colCols.length && !colCols.some((c) => c.name === 'semantic_type')) this.db.exec(`ALTER TABLE kanban_columns ADD COLUMN semantic_type TEXT NOT NULL DEFAULT 'custom'`)
    if (colCols.length && !colCols.some((c) => c.name === 'wip_limit')) this.db.exec(`ALTER TABLE kanban_columns ADD COLUMN wip_limit INTEGER`)
    // Старые доски имели To Do / In Progress / Done без стабильной семантики.
    // Сначала сохраняем их пользовательские названия, назначая базовые роли.
    this.db.exec(`
      UPDATE kanban_columns SET semantic_type = 'backlog'
      WHERE semantic_type = 'custom'
        AND NOT EXISTS (SELECT 1 FROM kanban_columns existing WHERE existing.project_id=kanban_columns.project_id AND existing.semantic_type='backlog')
        AND id IN (SELECT id FROM kanban_columns c2 WHERE c2.project_id = kanban_columns.project_id ORDER BY position LIMIT 1);
      UPDATE kanban_columns SET semantic_type = 'done'
      WHERE semantic_type = 'custom'
        AND NOT EXISTS (SELECT 1 FROM kanban_columns existing WHERE existing.project_id=kanban_columns.project_id AND existing.semantic_type='done')
        AND id IN (SELECT id FROM kanban_columns c2 WHERE c2.project_id = kanban_columns.project_id ORDER BY position DESC LIMIT 1);
      UPDATE kanban_columns SET semantic_type = 'development'
      WHERE semantic_type = 'custom'
        AND NOT EXISTS (SELECT 1 FROM kanban_columns existing WHERE existing.project_id=kanban_columns.project_id AND existing.semantic_type='development')
        AND id IN (SELECT id FROM kanban_columns c2 WHERE c2.project_id = kanban_columns.project_id ORDER BY position LIMIT 1 OFFSET 1);
    `)
    // Полная визуальная миграция workflow: системные колонки получают один
    // канонический порядок, legacy-колонки безопасно сливаются с новыми, custom
    // остаются после системы. Транзакция и стабильный выбор первой колонки делают
    // повторный запуск идемпотентным.
    const workflowColumns: Array<[KanbanColumnSemanticType, string]> = [
      ['backlog', 'Бэклог'],
      ['preparation', 'Подготовка к разработке'],
      ['ready', 'Ready for Development'],
      ['development', 'Development'],
      ['component_qa', 'Component QA'],
      ['integration_tests', 'Создание интеграционных автотестов'],
      ['automated_qa', 'Automated QA'],
      ['manual_qa', 'Ручное QA'],
      ['awaiting_merge', 'Ожидает мержа'],
      ['merge', 'Мерж'],
      ['done', 'Готово'],
      ['cancelled', 'Отменено'],
      ['decision_required', 'Требуется решение']
    ]
    type WorkflowColumnRow = { id: string; name: string; semantic_type: string; position: number; created_at: number }
    type WorkflowTaskRow = { id: string }
    this.db.transaction(() => {
      const projectIds = this.db.prepare(`SELECT id FROM projects ORDER BY created_at, id`).all() as Array<{ id: string }>
      const loadColumns = (projectId: string) => this.db.prepare(
        `SELECT id, name, semantic_type, position, created_at FROM kanban_columns WHERE project_id=? ORDER BY position, created_at, id`
      ).all(projectId) as WorkflowColumnRow[]
      const mergeColumns = (projectId: string, targetId: string, sourceIds: string[]) => {
        if (!sourceIds.length) return
        const targetTasks = this.db.prepare(
          `SELECT id FROM tasks WHERE project_id=? AND column_id=? ORDER BY position, created_at, id`
        ).all(projectId, targetId) as WorkflowTaskRow[]
        const placeholders = sourceIds.map(() => '?').join(',')
        const sourceTasks = this.db.prepare(
          `SELECT t.id FROM tasks t JOIN kanban_columns c ON c.id=t.column_id WHERE t.project_id=? AND t.column_id IN (${placeholders}) ORDER BY c.position, t.position, t.created_at, t.id`
        ).all(projectId, ...sourceIds) as WorkflowTaskRow[]
        ;[...targetTasks, ...sourceTasks].forEach((task, index) => {
          this.db.prepare(`UPDATE tasks SET column_id=?, position=? WHERE id=?`).run(targetId, (index + 1) * RANK_STEP, task.id)
        })
        this.db.prepare(`DELETE FROM kanban_columns WHERE project_id=? AND id IN (${placeholders})`).run(projectId, ...sourceIds)
      }

      for (const { id: projectId } of projectIds) {
        let columns = loadColumns(projectId)
        // Сохранённая семантика (и тем самым id существующей системной колонки) —
        // основной признак. Только если её ещё нет, старую системную колонку можно
        // однократно узнать по точному legacy-заголовку, не двигая её карточки.
        if (!columns.some(column => column.semantic_type === 'cancelled')) {
          const legacyCancelled = columns.find(column => column.semantic_type === 'custom' && column.name === 'Отменены')
          if (legacyCancelled) {
            this.db.prepare(`UPDATE kanban_columns SET semantic_type='cancelled' WHERE id=?`).run(legacyCancelled.id)
            columns = loadColumns(projectId)
          }
        }
        let nextPosition = Math.max(0, ...columns.map(column => column.position)) + RANK_STEP
        for (const [semantic, name] of workflowColumns) {
          if (columns.some(column => column.semantic_type === semantic)) continue
          this.db.prepare(
            `INSERT INTO kanban_columns (id, project_id, name, semantic_type, position, hidden, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`
          ).run(this.newId(), projectId, name, semantic, nextPosition, this.now())
          nextPosition += RANK_STEP
          columns = loadColumns(projectId)
        }

        // Схлопываем дубликаты системных колонок, сохраняя первую по визуальному
        // порядку и добавляя карточки дублей после уже лежащих в ней.
        for (const [semantic] of workflowColumns) {
          const matches = columns.filter(column => column.semantic_type === semantic)
          if (matches.length > 1) {
            mergeColumns(projectId, matches[0].id, matches.slice(1).map(column => column.id))
            columns = loadColumns(projectId)
          }
        }

        const canonical = new Map(columns.map(column => [column.semantic_type, column]))
        const legacyMappings: Array<[string, KanbanColumnSemanticType]> = [
          ['testing', 'automated_qa'],
          ['qa_preparation', 'component_qa']
        ]
        for (const [legacy, targetSemantic] of legacyMappings) {
          const sources = columns.filter(column => column.semantic_type === legacy)
          const target = canonical.get(targetSemantic)
          if (target && sources.length) {
            mergeColumns(projectId, target.id, sources.map(column => column.id))
            columns = loadColumns(projectId)
          }
        }

        const order = [...workflowColumns.map(([semantic]) => semantic), 'custom']
        let position = RANK_STEP
        for (const semantic of order) {
          const matches = columns.filter(column => column.semantic_type === semantic)
          for (const column of matches) {
            if (semantic === 'custom') this.db.prepare(`UPDATE kanban_columns SET position=? WHERE id=?`).run(position, column.id)
            else this.db.prepare(`UPDATE kanban_columns SET position=?, hidden=0 WHERE id=?`).run(position, column.id)
            position += RANK_STEP
          }
        }
      }
    })()
    const featureProjectCols = this.db.prepare(`PRAGMA table_info(projects)`).all() as Array<{ name: string }>
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'preview_url')) this.db.exec(`ALTER TABLE projects ADD COLUMN preview_url TEXT`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'commit_policy')) this.db.exec(`ALTER TABLE projects ADD COLUMN commit_policy TEXT NOT NULL DEFAULT 'agent_commits'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'merge_transport')) this.db.exec(`ALTER TABLE projects ADD COLUMN merge_transport TEXT NOT NULL DEFAULT 'local'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'agent_plan_approval_mode')) this.db.exec(`ALTER TABLE projects ADD COLUMN agent_plan_approval_mode TEXT NOT NULL DEFAULT 'manual'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'test_command')) this.db.exec(`ALTER TABLE projects ADD COLUMN test_command TEXT NOT NULL DEFAULT ''`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'production_deploy_command')) this.db.exec(`ALTER TABLE projects ADD COLUMN production_deploy_command TEXT NOT NULL DEFAULT ''`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'production_agent_id')) this.db.exec(`ALTER TABLE projects ADD COLUMN production_agent_id TEXT`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'production_checkout_path')) this.db.exec(`ALTER TABLE projects ADD COLUMN production_checkout_path TEXT NOT NULL DEFAULT ''`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'production_health_check_command')) this.db.exec(`ALTER TABLE projects ADD COLUMN production_health_check_command TEXT NOT NULL DEFAULT ''`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'release_timeouts_json')) this.db.exec(`ALTER TABLE projects ADD COLUMN release_timeouts_json TEXT NOT NULL DEFAULT '{}'`)
    const qaSessionCols = this.db.prepare(`PRAGMA table_info(qa_sessions)`).all() as Array<{ name: string }>
    if (qaSessionCols.length && !qaSessionCols.some(c => c.name === 'additional_issues')) this.db.exec(`ALTER TABLE qa_sessions ADD COLUMN additional_issues TEXT NOT NULL DEFAULT ''`)
    if (qaSessionCols.length && !qaSessionCols.some(c => c.name === 'linked_fix_run_id')) this.db.exec(`ALTER TABLE qa_sessions ADD COLUMN linked_fix_run_id TEXT`)
    const releaseCols = this.db.prepare(`PRAGMA table_info(project_releases)`).all() as Array<{ name: string }>
    if (releaseCols.length && !releaseCols.some(c=>c.name==='agent_id')) this.db.exec(`ALTER TABLE project_releases ADD COLUMN agent_id TEXT`)
    if (releaseCols.length && !releaseCols.some(c=>c.name==='checkout_path')) this.db.exec(`ALTER TABLE project_releases ADD COLUMN checkout_path TEXT`)
    if (releaseCols.length && !releaseCols.some(c=>c.name==='deleted_at')) this.db.exec(`ALTER TABLE project_releases ADD COLUMN deleted_at INTEGER`)
    const releaseStepCols = this.db.prepare(`PRAGMA table_info(project_release_steps)`).all() as Array<{ name: string }>
    if (releaseStepCols.length && !releaseStepCols.some(c=>c.name==='limit_ms')) this.db.exec(`ALTER TABLE project_release_steps ADD COLUMN limit_ms INTEGER`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'default_skills_epic')) this.db.exec(`ALTER TABLE projects ADD COLUMN default_skills_epic TEXT NOT NULL DEFAULT '[]'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'default_skills_story')) this.db.exec(`ALTER TABLE projects ADD COLUMN default_skills_story TEXT NOT NULL DEFAULT '[]'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'default_skills_task')) this.db.exec(`ALTER TABLE projects ADD COLUMN default_skills_task TEXT NOT NULL DEFAULT '[]'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'ci_base_branch')) this.db.exec(`ALTER TABLE projects ADD COLUMN ci_base_branch TEXT NOT NULL DEFAULT 'main'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'ci_branch_template')) this.db.exec(`ALTER TABLE projects ADD COLUMN ci_branch_template TEXT NOT NULL DEFAULT '{task_number}'`)
    // Normalize the two historical defaults. Deliberately custom templates stay intact.
    if (featureProjectCols.some((c) => c.name === 'ci_branch_template')) this.db.prepare(`UPDATE projects SET ci_branch_template='{task_number}' WHERE ci_branch_template IN ('feature/{task_number}', 'feature/{task_number}-{slug}')`).run()
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'ci_reuse_strategy')) this.db.exec(`ALTER TABLE projects ADD COLUMN ci_reuse_strategy TEXT NOT NULL DEFAULT 'fail'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'ci_exec_auth_ref')) this.db.exec(`ALTER TABLE projects ADD COLUMN ci_exec_auth_ref TEXT NOT NULL DEFAULT ''`)
    // Режим базы знаний в ходах модели CI-рана: настройка проекта, не чата.
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'ci_kb_context_mode')) this.db.exec(`ALTER TABLE projects ADD COLUMN ci_kb_context_mode TEXT NOT NULL DEFAULT 'auto'`)
    // Старые cleanup уже удалили клоны, но связанные чаты остались в их путях.
    // Сбрасываем только чаты задач с released workspace: активные и сохранённые
    // после ошибки рабочие копии остаются доступными для разбора.
    this.db.exec(`
      UPDATE conversations AS c
      SET exec_target = (SELECT default_agent_id FROM projects p WHERE p.id = c.project_id),
          workdir = (
            SELECT NULLIF(pm.path, '')
            FROM project_machines pm
            JOIN projects p ON p.id = c.project_id
            WHERE pm.project_id = c.project_id AND pm.agent_id = p.default_agent_id
          )
      WHERE c.task_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM ci_workspaces w
          WHERE w.project_id = c.project_id AND w.task_id = c.task_id
            AND w.state = 'released' AND c.workdir LIKE w.path || '/%'
        )
    `)
    // Порог «сколько держать завершённые на доске»: существующим проектам —
    // дефолт 14 дней (DEFAULT в ALTER заполняет старые строки).
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'done_retention_days')) this.db.exec(`ALTER TABLE projects ADD COLUMN done_retention_days INTEGER DEFAULT ${DEFAULT_DONE_RETENTION_DAYS}`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'ci_test_fix_cycle_limit')) this.db.exec(`ALTER TABLE projects ADD COLUMN ci_test_fix_cycle_limit INTEGER NOT NULL DEFAULT 10`)
    const ciWorkspaceCols = this.db.prepare(`PRAGMA table_info(ci_workspaces)`).all() as Array<{ name: string }>
    if (ciWorkspaceCols.length && !ciWorkspaceCols.some((c) => c.name === 'branch')) this.db.exec(`ALTER TABLE ci_workspaces ADD COLUMN branch TEXT`)
    if (ciWorkspaceCols.length && !ciWorkspaceCols.some((c) => c.name === 'commit_sha')) this.db.exec(`ALTER TABLE ci_workspaces ADD COLUMN commit_sha TEXT`)
    if (ciWorkspaceCols.length && !ciWorkspaceCols.some((c) => c.name === 'pushed')) this.db.exec(`ALTER TABLE ci_workspaces ADD COLUMN pushed INTEGER NOT NULL DEFAULT 0`)
    const mergeRunCols = this.db.prepare(`PRAGMA table_info(merge_runs)`).all() as Array<{ name: string }>
    if (mergeRunCols.length) {
      this.db.exec(`DROP INDEX IF EXISTS idx_merge_runs_one_active_task`)
      this.db.exec(`CREATE UNIQUE INDEX idx_merge_runs_one_active_task ON merge_runs(task_id) WHERE status IN ('queued','checking','fetching','merging','resolving_conflicts','kb_update','testing','pushing')`)
    }
    if (mergeRunCols.length && !mergeRunCols.some((c) => c.name === 'stages_json')) this.db.exec(`ALTER TABLE merge_runs ADD COLUMN stages_json TEXT NOT NULL DEFAULT '[]'`)
    if (mergeRunCols.length && !mergeRunCols.some((c) => c.name === 'checks_json')) this.db.exec(`ALTER TABLE merge_runs ADD COLUMN checks_json TEXT NOT NULL DEFAULT '[]'`)
    if (mergeRunCols.length && !mergeRunCols.some((c) => c.name === 'recommended_action')) this.db.exec(`ALTER TABLE merge_runs ADD COLUMN recommended_action TEXT`)
    if (mergeRunCols.length && !mergeRunCols.some((c) => c.name === 'push_started_at')) this.db.exec(`ALTER TABLE merge_runs ADD COLUMN push_started_at INTEGER`)
    if (mergeRunCols.length && !mergeRunCols.some((c) => c.name === 'requested_llm_provider')) this.db.exec(`ALTER TABLE merge_runs ADD COLUMN requested_llm_provider TEXT`)
    if (mergeRunCols.length && !mergeRunCols.some((c) => c.name === 'requested_llm_model')) this.db.exec(`ALTER TABLE merge_runs ADD COLUMN requested_llm_model TEXT`)
    if (mergeRunCols.length && !mergeRunCols.some((c) => c.name === 'llm_fallback_reason')) this.db.exec(`ALTER TABLE merge_runs ADD COLUMN llm_fallback_reason TEXT`)
    const ciRunCols = this.db.prepare(`PRAGMA table_info(ci_runs)`).all() as Array<{ name: string }>
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'run_column_id')) this.db.exec(`ALTER TABLE ci_runs ADD COLUMN run_column_id TEXT`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'terminal_column_id')) this.db.exec(`ALTER TABLE ci_runs ADD COLUMN terminal_column_id TEXT`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'agent_owner_id')) this.db.exec(`ALTER TABLE ci_runs ADD COLUMN agent_owner_id TEXT`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'agent_owner_name')) this.db.exec(`ALTER TABLE ci_runs ADD COLUMN agent_owner_name TEXT`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'agent_selection_source')) this.db.exec(`ALTER TABLE ci_runs ADD COLUMN agent_selection_source TEXT`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'llm_engine_id')) this.db.exec(`ALTER TABLE ci_runs ADD COLUMN llm_engine_id TEXT`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'llm_provider')) this.db.exec(`ALTER TABLE ci_runs ADD COLUMN llm_provider TEXT NOT NULL DEFAULT 'claude'`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'llm_model')) this.db.exec(`ALTER TABLE ci_runs ADD COLUMN llm_model TEXT NOT NULL DEFAULT '${DEFAULT_CI_CLAUDE_MODEL}'`)
    // Режим запуска (план/разработка), глубина уточнений и связанный чат рана.
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'mode')) this.db.exec(`ALTER TABLE ci_runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'development'`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'clarify_level')) this.db.exec(`ALTER TABLE ci_runs ADD COLUMN clarify_level TEXT NOT NULL DEFAULT 'few'`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'clarify_max')) this.db.exec(`ALTER TABLE ci_runs ADD COLUMN clarify_max INTEGER NOT NULL DEFAULT 3`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'conversation_id')) this.db.exec(`ALTER TABLE ci_runs ADD COLUMN conversation_id TEXT`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'model_session_id')) this.db.exec(`ALTER TABLE ci_runs ADD COLUMN model_session_id TEXT`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'fix_context_json')) this.db.exec(`ALTER TABLE ci_runs ADD COLUMN fix_context_json TEXT`)
    const ciFixCols = this.db.prepare(`PRAGMA table_info(ci_fix_attempts)`).all() as Array<{ name: string }>
    if (ciFixCols.length && !ciFixCols.some((c) => c.name === 'changed_files_json')) this.db.exec(`ALTER TABLE ci_fix_attempts ADD COLUMN changed_files_json TEXT NOT NULL DEFAULT '[]'`)
    if (ciFixCols.length && !ciFixCols.some((c) => c.name === 'targeted_tests_json')) this.db.exec(`ALTER TABLE ci_fix_attempts ADD COLUMN targeted_tests_json TEXT NOT NULL DEFAULT '[]'`)
    if (ciFixCols.length && !ciFixCols.some((c) => c.name === 'full_rerun_json')) this.db.exec(`ALTER TABLE ci_fix_attempts ADD COLUMN full_rerun_json TEXT`)
    if (ciFixCols.length && !ciFixCols.some((c) => c.name === 'failures_json')) this.db.exec(`ALTER TABLE ci_fix_attempts ADD COLUMN failures_json TEXT NOT NULL DEFAULT '[]'`)
    // Режим базы знаний рана — снимок настройки проекта на момент старта.
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'kb_context_mode')) this.db.exec(`ALTER TABLE ci_runs ADD COLUMN kb_context_mode TEXT NOT NULL DEFAULT 'auto'`)
    const ciLlmCols = this.db.prepare(`PRAGMA table_info(ci_llm_configs)`).all() as Array<{ name: string }>
    if (ciLlmCols.length && !ciLlmCols.some((c) => c.name === 'llm_engine_id')) this.db.exec(`ALTER TABLE ci_llm_configs ADD COLUMN llm_engine_id TEXT`)
    if (ciLlmCols.length && !ciLlmCols.some((c) => c.name === 'mode')) this.db.exec(`ALTER TABLE ci_llm_configs ADD COLUMN mode TEXT NOT NULL DEFAULT 'development'`)
    if (ciLlmCols.length && !ciLlmCols.some((c) => c.name === 'clarify_level')) this.db.exec(`ALTER TABLE ci_llm_configs ADD COLUMN clarify_level TEXT NOT NULL DEFAULT 'few'`)
    if (ciLlmCols.length && !ciLlmCols.some((c) => c.name === 'clarify_max')) this.db.exec(`ALTER TABLE ci_llm_configs ADD COLUMN clarify_max INTEGER NOT NULL DEFAULT 3`)
    const ciCmdCols = this.db.prepare(`PRAGMA table_info(ci_commands)`).all() as Array<{ name: string }>
    if (ciCmdCols.length && !ciCmdCols.some((c) => c.name === 'builtin')) this.db.exec(`ALTER TABLE ci_commands ADD COLUMN builtin TEXT`)
    if (ciCmdCols.length && !ciCmdCols.some((c) => c.name === 'is_test')) {
      this.db.exec(`ALTER TABLE ci_commands ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0`)
      // Бэкфилл: гейт в уже заведённых справочниках помечаем сами — иначе после
      // обновления модель по-прежнему видит «Запустить тестирование» инструментом
      // и прогоняет тесты до шага воркфлоу.
      const rows = this.db.prepare(`SELECT id, name, script FROM ci_commands`).all() as Array<{ id: string; name: string; script: string }>
      const mark = this.db.prepare(`UPDATE ci_commands SET is_test = 1, available_to_model = 0 WHERE id = ?`)
      for (const r of rows) if (isVerificationCommand(r)) mark.run(r.id)
    }
    // Стандартный гейт живёт в данных справочника. Переводим только его точный
    // прежний текст, не затрагивая пользовательские команды с другим скриптом.
    this.db.prepare(`UPDATE ci_commands
      SET script = 'npm run affected-check', is_test = 1, available_to_model = 1,
          version = version + 1, updated_at = ?
      WHERE script = 'npm run typecheck && npm test'`).run(Date.now())
    this.db.prepare(`UPDATE ci_commands SET available_to_model = 1
      WHERE script = 'npm run affected-check' AND available_to_model = 0`).run()
    this.db.prepare(`UPDATE ci_commands
      SET allow_failure = 0,
          description = 'Модель дописывает в базу знаний, что изменилось в этом ране: темы docs/kb/*.md в рабочей копии и статьи раздела проекта. Ошибка шага останавливает ран.'
      WHERE id = ?`).run(CI_KB_UPDATE_COMMAND_ID)
    // Семантика входных токенов строки расхода. Старые строки остаются с NULL:
    // у codex это «вход вместе с кэшем», и отчёт приводит их на чтении.
    const ciUsageCols = this.db.prepare(`PRAGMA table_info(ci_run_usage)`).all() as Array<{ name: string }>
    if (ciUsageCols.length && !ciUsageCols.some((c) => c.name === 'input_semantics')) this.db.exec(`ALTER TABLE ci_run_usage ADD COLUMN input_semantics TEXT`)
    const ciSettingsCols = this.db.prepare(`PRAGMA table_info(ci_settings)`).all() as Array<{ name: string }>
    if (ciSettingsCols.length && !ciSettingsCols.some((c) => c.name === 'interaction_wait_ms')) this.db.exec(`ALTER TABLE ci_settings ADD COLUMN interaction_wait_ms INTEGER NOT NULL DEFAULT 1800000`)
    if (ciSettingsCols.length && !ciSettingsCols.some((c) => c.name === 'stage_models')) this.db.exec(`ALTER TABLE ci_settings ADD COLUMN stage_models TEXT`)
    // Увеличиваем втрое только прежний полный набор дефолтных предохранителей.
    // Любая вручную изменённая настройка сохраняется без вмешательства.
    this.db.exec(`UPDATE ci_settings
      SET max_fix_attempts = 10,
          fix_time_limit_ms = 1800000,
          fix_token_limit = 600000,
          default_step_timeout_sec = 1800
      WHERE (max_fix_attempts = 3
        AND fix_time_limit_ms = 600000
        AND fix_token_limit = 200000
        AND default_step_timeout_sec = 600)
        OR (max_fix_attempts = 9
        AND fix_time_limit_ms = 1800000
        AND fix_token_limit = 600000
        AND default_step_timeout_sec = 1800)`)
    const toolLimitColumns: Array<[string, number]> = [
      ['bash_output_limit_chars', DEFAULT_CI_GLOBAL_SETTINGS.bashOutputLimitChars],
      ['read_output_limit_chars', DEFAULT_CI_GLOBAL_SETTINGS.readOutputLimitChars],
      ['read_window_max_lines', DEFAULT_CI_GLOBAL_SETTINGS.readWindowMaxLines],
      ['grep_match_limit', DEFAULT_CI_GLOBAL_SETTINGS.grepMatchLimit],
      ['grep_output_limit_chars', DEFAULT_CI_GLOBAL_SETTINGS.grepOutputLimitChars]
    ]
    for (const [column, fallback] of toolLimitColumns) {
      if (ciSettingsCols.length && !ciSettingsCols.some((c) => c.name === column)) {
        this.db.exec(`ALTER TABLE ci_settings ADD COLUMN ${column} INTEGER NOT NULL DEFAULT ${fallback}`)
      }
    }
    const ciToolCallCols = this.db.prepare(`PRAGMA table_info(ci_run_tool_calls)`).all() as Array<{ name: string }>
    if (ciToolCallCols.length && !ciToolCallCols.some((c) => c.name === 'chars')) this.db.exec(`ALTER TABLE ci_run_tool_calls ADD COLUMN chars INTEGER NOT NULL DEFAULT 0`)
    const qaPreparationCols = this.db.prepare(`PRAGMA table_info(qa_preparation_runs)`).all() as Array<{ name: string }>
    if (qaPreparationCols.length && !qaPreparationCols.some((c) => c.name === 'attempt')) this.db.exec(`ALTER TABLE qa_preparation_runs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1`)
    if (qaPreparationCols.length && !qaPreparationCols.some((c) => c.name === 'diagnostics_json')) this.db.exec(`ALTER TABLE qa_preparation_runs ADD COLUMN diagnostics_json TEXT NOT NULL DEFAULT '[]'`)

    // Привязка обращения к БЗ к рану и шагу CI: отчёты по ране/задаче строятся
    // по ним, а старые строки просто остаются с NULL (это обращения из чата).
    const kbUsageCols = this.db.prepare(`PRAGMA table_info(kb_usage_queries)`).all() as Array<{ name: string }>
    if (kbUsageCols.length && !kbUsageCols.some((c) => c.name === 'ci_run_id')) this.db.exec(`ALTER TABLE kb_usage_queries ADD COLUMN ci_run_id TEXT`)
    if (kbUsageCols.length && !kbUsageCols.some((c) => c.name === 'ci_step_id')) this.db.exec(`ALTER TABLE kb_usage_queries ADD COLUMN ci_step_id TEXT`)
    if (kbUsageCols.length) this.db.exec(`CREATE INDEX IF NOT EXISTS idx_kb_usage_ci_run ON kb_usage_queries(ci_run_id, created_at DESC)`)
    const kbSectionCols = this.db.prepare(`PRAGMA table_info(kb_usage_sections)`).all() as Array<{ name: string }>
    if (kbSectionCols.length && !kbSectionCols.some((c) => c.name === 'related_files')) this.db.exec(`ALTER TABLE kb_usage_sections ADD COLUMN related_files TEXT NOT NULL DEFAULT '[]'`)

    const llmEngineCols = this.db.prepare(`PRAGMA table_info(llm_engines)`).all() as Array<{ name: string }>
    if (llmEngineCols.length && !llmEngineCols.some((c) => c.name === 'token')) this.db.exec(`ALTER TABLE llm_engines ADD COLUMN token TEXT NOT NULL DEFAULT ''`)
    if (llmEngineCols.length && !llmEngineCols.some((c) => c.name === 'enabled')) this.db.exec(`ALTER TABLE llm_engines ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1`)
    if (llmEngineCols.length && !llmEngineCols.some((c) => c.name === 'allowed_roles')) this.db.exec(`ALTER TABLE llm_engines ADD COLUMN allowed_roles TEXT NOT NULL DEFAULT '[\"admin\",\"developer\",\"tester\",\"observer\"]'`)
    if (llmEngineCols.length && !llmEngineCols.some((c) => c.name === 'is_default')) this.db.exec(`ALTER TABLE llm_engines ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0`)
    if (llmEngineCols.length && !llmEngineCols.some((c) => c.name === 'created_at')) this.db.exec(`ALTER TABLE llm_engines ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0`)
    if (llmEngineCols.length) {
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_llm_engines_kind_enabled ON llm_engines(kind, enabled, created_at)`)
      this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_engines_default_kind ON llm_engines(kind) WHERE is_default = 1`)
    }

    const msgCols = this.db.prepare(`PRAGMA table_info(messages)`).all() as Array<{ name: string }>
    if (!msgCols.some((c) => c.name === 'engine')) {
      this.db.exec(`ALTER TABLE messages ADD COLUMN engine TEXT`)
    }
    if (!msgCols.some((c) => c.name === 'meta')) {
      this.db.exec(`ALTER TABLE messages ADD COLUMN meta TEXT`)
    }
    if (!msgCols.some((c) => c.name === 'exec_target')) {
      this.db.exec(`ALTER TABLE messages ADD COLUMN exec_target TEXT`)
    }
    if (!msgCols.some((c) => c.name === 'attachments')) {
      this.db.exec(`ALTER TABLE messages ADD COLUMN attachments TEXT`)
    }
    if (!msgCols.some((c) => c.name === 'state')) {
      this.db.exec(`ALTER TABLE messages ADD COLUMN state TEXT NOT NULL DEFAULT 'published'`)
    }
    if (!msgCols.some((c) => c.name === 'history_position')) {
      this.db.exec(`ALTER TABLE messages ADD COLUMN history_position INTEGER`)
      this.db.exec(`UPDATE messages SET history_position = rowid WHERE state = 'published'`)
    }
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_history ON messages(conversation_id, state, history_position)`)
    // Ответ агента наследует цель ближайшей пользовательской реплики того же разговора.
    // Заполняет сообщения, созданные до сохранения exec_target у AI-ответов.
    this.db.exec(`
      UPDATE messages AS answer
      SET exec_target = (
        SELECT prompt.exec_target
        FROM messages AS prompt
        WHERE prompt.conversation_id = answer.conversation_id
          AND prompt.role != 'ai'
          AND (prompt.created_at < answer.created_at OR (prompt.created_at = answer.created_at AND prompt.id < answer.id))
        ORDER BY prompt.created_at DESC, prompt.id DESC
        LIMIT 1
      )
      WHERE answer.role = 'ai' AND answer.exec_target IS NULL
    `)
    // Многопользовательский режим: строки без владельца (legacy однопользовательских
    // данных) удаляем — чистый старт. Идемпотентно: после первого прогона NULL нет.
    this.db.exec(`DELETE FROM conversations WHERE user_id IS NULL`) // messages/speakers — по CASCADE
    this.db.exec(`DELETE FROM agents WHERE user_id IS NULL`)
    // Одноразово удаляем только старые ручные черновики с полностью дефолтными
    // полями. Любая настройка, проект, служебный тип, задача или CLI-сессия
    // делает строку неоднозначной и сохраняет её.
    const cleanup = this.db.prepare(
      `INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES ('cleanup-empty-manual-drafts-v1', ?)`
    ).run(Date.now())
    if (cleanup.changes) {
      this.db.exec(`
        DELETE FROM conversations
        WHERE title = 'Новый разговор'
          AND task_id IS NULL AND assistant_kind IS NULL AND project_id IS NULL
          AND claude_session_id IS NULL AND exec_target IS NULL AND workdir IS NULL
          AND skill_names = '[]' AND llm_engine_id IS NULL
          AND llm_provider IS NULL AND llm_model IS NULL AND permission_mode IS NULL
          AND kb_context_mode = 'auto' AND preview_url IS NULL AND status = 'developing'
          AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = conversations.id)
      `)
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    if (this.ftsTimer) clearTimeout(this.ftsTimer)
    this.ftsTimer = null
    this.db.close()
  }

  // ---- Conversations ----------------------------------------------------

  createConversation(userId: string, title = 'Новый разговор', assistantKind: 'web-recorder' | 'playwright-reader' | null = null): Conversation {
    const id = this.newId()
    const ts = this.now()
    this.db
      .prepare(
        `INSERT INTO conversations (id, title, created_at, updated_at, claude_session_id, user_id, exec_target, assistant_kind)
         VALUES (?, ?, ?, ?, NULL, ?, NULL, ?)`
      )
      .run(id, title, ts, ts, userId, assistantKind)
    return { id, title, createdAt: ts, updatedAt: ts, messageCount: 0, claudeSessionId: null, execTarget: null, workdir: null, skillNames: [], llmEngineId: null, llmProvider: null, llmModel: null, permissionMode: null, kbContextMode: 'auto', projectId: null, assistantKind, status: DEFAULT_CONVERSATION_STATUS, lastExecTarget: null }
  }

  /**
   * Единственная точка персистенции нового обычного чата: разговор, проектные
   * настройки и первая реплика фиксируются одной SQLite-транзакцией.
   */
  createConversationDraft(
    userId: string,
    idempotencyKey: string,
    title: string,
    projectId: string | null,
    message: {
      role: MessageRole
      text: string
      time: string
      engine?: LlmProvider
      meta?: TurnMeta
      execTarget?: string | null
      attachments?: MessageAttachment[]
    }
  ): { conversation: Conversation; messages: Message[] } {
    const run = this.db.transaction(() => {
      const replay = this.db.prepare(
        `SELECT conversation_id FROM conversation_draft_requests WHERE user_id = ? AND idempotency_key = ?`
      ).get(userId, idempotencyKey) as { conversation_id: string } | undefined
      if (replay) {
        const conversation = this.getConversation(userId, replay.conversation_id)
        if (!conversation) throw new Error('idempotent conversation not found')
        return { conversation, messages: this.listMessages(userId, conversation.id) }
      }

      const created = this.createConversation(userId, title)
      const conversation = projectId ? this.setConversationProject(userId, created.id, projectId) : created
      if (!conversation) throw new Error('project not found')
      this.addMessage(
        userId,
        conversation.id,
        message.role,
        message.text,
        message.time,
        message.engine,
        message.meta,
        conversation.execTarget,
        message.attachments
      )
      this.db.prepare(
        `INSERT INTO conversation_draft_requests (user_id, idempotency_key, conversation_id) VALUES (?, ?, ?)`
      ).run(userId, idempotencyKey, conversation.id)
      return { conversation: this.getConversation(userId, conversation.id)!, messages: this.listMessages(userId, conversation.id) }
    })
    return run()
  }

  /** Один приватный сохраняемый чат канбан-ассистента на пользователя и проект. */
  ensureKanbanAssistantConversation(userId: string, projectId: string): Conversation | null {
    if (!this.isProjectMember(userId, projectId)) return null
    const existing = this.db.prepare(
      `SELECT id FROM conversations WHERE user_id = ? AND project_id = ? AND assistant_kind = 'kanban' LIMIT 1`
    ).get(userId, projectId) as { id: string } | undefined
    if (existing) return this.getConversation(userId, existing.id)
    const project = this.getProject(userId, projectId)
    if (!project) return null
    const id = this.newId()
    const ts = this.now()
    this.db.prepare(
      `INSERT INTO conversations (id, title, created_at, updated_at, claude_session_id, user_id, exec_target, project_id, assistant_kind)
       VALUES (?, ?, ?, ?, NULL, ?, 'none', ?, 'kanban')`
    ).run(id, `Ассистент · ${project.name}`, ts, ts, userId, projectId)
    return this.getConversation(userId, id)
  }

  /**
   * Список бесед пользователя. Чаты задач, лежащих в колонке с семантикой
   * `done`, из него убраны: завершённая задача забивала бы сайдбар навсегда.
   * Скрытие мгновенное (порог `doneRetentionDays` тут ни при чём) и обратимое —
   * задачу вернули в работу, чат снова в списке. Доступ к скрытому чату
   * остаётся: `getConversation` его отдаёт, карточка задачи открывает.
   */
  listConversations(userId: string, opts?: { includeCompleted?: boolean }): Conversation[] {
    const rows = this.db
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
                (SELECT m.exec_target FROM messages m WHERE m.conversation_id = c.id
                 ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_exec_target
         FROM conversations c
         WHERE c.user_id = ?
           AND (c.assistant_kind IS NULL OR c.assistant_kind IN ('web-recorder', 'playwright-reader'))
           AND ${NOT_CANCELLED_TASK_CHAT}
           AND (? = 1 OR ${NOT_DONE_TASK_CHAT})
         ORDER BY c.updated_at DESC`
      )
      .all(userId, opts?.includeCompleted ? 1 : 0) as Array<ConversationRow & { message_count: number }>
    return rows.map((r) => this.mapConversation(r, r.message_count))
  }

  getConversation(userId: string, id: string): Conversation | null {
    const row = this.db
      .prepare(`SELECT c.*,
                       (SELECT m.exec_target FROM messages m WHERE m.conversation_id = c.id
                        ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_exec_target
                FROM conversations c WHERE c.id = ? AND c.user_id = ?`)
      .get(id, userId) as ConversationRow | undefined
    if (!row) return null
    const count = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?`).get(id) as {
        n: number
      }
    ).n
    return this.mapConversation(row, count)
  }

  /** Владеет ли пользователь разговором (для проверок при работе с сообщениями). */
  private ownsConversation(userId: string, conversationId: string): boolean {
    const row = this.db
      .prepare(`SELECT 1 FROM conversations WHERE id = ? AND user_id = ?`)
      .get(conversationId, userId)
    return row !== undefined
  }

  /**
   * Поиск по названию разговора и тексту его сообщений (регистронезависимо).
   * Состав тот же, что у `listConversations`: чаты завершённых задач приходят
   * только с `includeCompleted` — иначе выключенный фильтр возвращал бы их
   * через строку поиска.
   */
  searchConversations(userId: string, query: string, opts?: { includeCompleted?: boolean }): Conversation[] {
    const q = query.trim()
    if (!q) return this.listConversations(userId, opts)
    const like = `%${q.toLowerCase().replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`
    const rows = this.db
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
                (SELECT m.exec_target FROM messages m WHERE m.conversation_id = c.id
                 ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_exec_target
         FROM conversations c
         WHERE c.user_id = ?
           AND (c.assistant_kind IS NULL OR c.assistant_kind IN ('web-recorder', 'playwright-reader'))
           AND ${NOT_CANCELLED_TASK_CHAT}
           AND (? = 1 OR ${NOT_DONE_TASK_CHAT})
           AND (ulower(c.title) LIKE ? ESCAPE '\\'
            OR EXISTS (SELECT 1 FROM messages m
                       WHERE m.conversation_id = c.id AND ulower(m.text) LIKE ? ESCAPE '\\'))
         ORDER BY c.updated_at DESC`
      )
      .all(userId, opts?.includeCompleted ? 1 : 0, like, like) as Array<ConversationRow & { message_count: number }>
    return rows.map((r) => this.mapConversation(r, r.message_count))
  }

  renameConversation(userId: string, id: string, title: string): void {
    this.db
      .prepare(`UPDATE conversations SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
      .run(title, this.now(), id, userId)
  }

  setConversationExecTarget(
    userId: string,
    id: string,
    execTarget: string | null,
    workdir?: string | null,
    skillNames?: string[],
    llmProvider?: LlmProvider | null,
    llmModel?: string | null,
    permissionMode?: PermissionMode | null,
    llmEngineId?: string | null
  ): Conversation | null {
    const fields = ['exec_target = ?']
    const values: unknown[] = [execTarget]
    if (workdir !== undefined) {
      fields.push('workdir = ?')
      values.push(workdir)
    }
    if (skillNames !== undefined) {
      fields.push('skill_names = ?')
      values.push(JSON.stringify(skillNames))
    }
    if (llmEngineId !== undefined) {
      fields.push('llm_engine_id = ?')
      values.push(llmEngineId)
    }
    if (llmProvider !== undefined) {
      fields.push('llm_provider = ?')
      values.push(llmProvider)
    }
    if (llmModel !== undefined) {
      fields.push('llm_model = ?')
      values.push(llmModel)
    }
    if (permissionMode !== undefined) {
      fields.push('permission_mode = ?')
      values.push(permissionMode)
    }
    this.db
      .prepare(`UPDATE conversations SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`)
      .run(...values, id, userId)
    return this.getConversation(userId, id)
  }


  /**
   * Единое вычисление машины чата. Сохранённый `null` означает позднее
   * наследование персонального default пользователя; только наследование получает
   * безопасный online-fallback. Явный override не заменяется молча.
   */
  resolveConversationMachine(
    userId: string,
    conversationId: string,
    options: { execTarget?: string | null; projectId?: string | null; isOnline?: (agentId: string) => boolean } = {}
  ): {
    agentId: string | null
    source: 'explicit' | 'personal_default' | 'fallback' | 'disabled' | 'none'
    error: 'unavailable' | 'offline' | 'no_online_machine' | null
  } | null {
    const conversation = this.getConversation(userId, conversationId)
    if (!conversation) return null
    const explicitTarget = options.execTarget === undefined ? conversation.execTarget : options.execTarget
    const projectId = options.projectId === undefined ? conversation.projectId : options.projectId
    if (explicitTarget === 'none') return { agentId: null, source: 'disabled', error: null }
    const usable = this.listUsableAgents(userId, projectId)
    const isOnline = options.isOnline ?? (() => true)
    if (explicitTarget) {
      if (!this.canUseAgent(userId, explicitTarget, projectId)) {
        return { agentId: explicitTarget, source: 'explicit', error: 'unavailable' }
      }
      return {
        agentId: explicitTarget,
        source: 'explicit',
        error: isOnline(explicitTarget) ? null : 'offline'
      }
    }
    const personalDefault = projectId
      ? this.getUserProjectDefaultMachine(userId, projectId)
      : this.getSettings(userId).defaultAgentId
    if (personalDefault && usable.some((agent) => agent.id === personalDefault) && isOnline(personalDefault)) {
      return { agentId: personalDefault, source: 'personal_default', error: null }
    }
    const fallback = usable.find((agent) => isOnline(agent.id))
    if (fallback) return { agentId: fallback.id, source: 'fallback', error: null }
    return { agentId: null, source: 'none', error: 'no_online_machine' }
  }

  /** Вернуть чат задачи к наследованию после удаления изолированного клона. */
  restoreTaskChatWorkdir(userId: string, id: string, projectId: string): Conversation | null {
    if (!this.getProject(userId, projectId)) return null
    return this.setConversationExecTarget(userId, id, null, null)
  }

  setConversationKbContextMode(userId: string, id: string, mode: 'auto' | 'manual' | 'off'): Conversation | null {
    this.db.prepare(`UPDATE conversations SET kb_context_mode = ? WHERE id = ? AND user_id = ?`).run(mode, id, userId)
    return this.getConversation(userId, id)
  }

  setConversationPreviewUrl(userId: string, id: string, previewUrl: string | null): Conversation | null {
    this.db.prepare(`UPDATE conversations SET preview_url = ?, updated_at = ? WHERE id = ? AND user_id = ?`).run(previewUrl, this.now(), id, userId)
    return this.getConversation(userId, id)
  }

  setConversationStatus(userId: string, id: string, status: ConversationStatus): Conversation | null {
    this.db.prepare(`UPDATE conversations SET status = ? WHERE id = ? AND user_id = ?`).run(status, id, userId)
    return this.getConversation(userId, id)
  }

  clearConversationExecTargetForAgent(userId: string, agentId: string): void {
    this.db
      .prepare(`UPDATE conversations SET exec_target = NULL WHERE user_id = ? AND exec_target = ?`)
      .run(userId, agentId)
  }

  deleteConversation(userId: string, id: string): void {
    // ON DELETE CASCADE удалит сообщения и спикеров. Никаких проверок «чат занят»:
    // Feature Run убран, а CI-раны с разговорами не связаны.
    this.db.prepare(`DELETE FROM conversations WHERE id = ? AND user_id = ?`).run(id, userId)
  }

  setClaudeSession(userId: string, id: string, sessionId: string | null): void {
    this.db
      .prepare(`UPDATE conversations SET claude_session_id = ? WHERE id = ? AND user_id = ?`)
      .run(sessionId, id, userId)
  }

  // ---- Persistent turn queue ---------------------------------------------

  listQueuedTurns(userId: string, conversationId: string): QueuedTurn[] {
    if (!this.ownsConversation(userId, conversationId)) return []
    const rows = this.db.prepare(
      `SELECT q.id, q.conversation_id, q.message_id, q.payload, q.status, q.position,
              q.created_at, m.text, m.attachments AS message_attachments
       FROM conversation_turn_queue q
       JOIN messages m ON m.id = q.message_id
       WHERE q.user_id = ? AND q.conversation_id = ? AND q.status IN ('queued','failed')
       ORDER BY q.position, q.created_at`
    ).all(userId, conversationId) as Array<{ id: string; conversation_id: string; message_id: string; payload: string; status: string; position: number; created_at: number; text: string; message_attachments: string | null }>
    return rows.map((row, index) => {
      let payload: QueueTurnPayload = { segments: [] }
      try { payload = JSON.parse(row.payload) as QueueTurnPayload } catch { /* keep recoverable row visible */ }
      let attachmentDetails: MessageAttachment[] = []
      try { attachmentDetails = row.message_attachments ? JSON.parse(row.message_attachments) as MessageAttachment[] : [] } catch { /* attachment ids still remain usable */ }
      return {
        id: row.id,
        conversationId: row.conversation_id,
        messageId: row.message_id,
        text: row.text,
        attachments: payload.attachments ?? [],
        ...(attachmentDetails.length ? { attachmentDetails } : {}),
        position: index + 1,
        status: row.status === 'failed' ? 'failed' : 'queued',
        createdAt: row.created_at
      }
    })
  }

  isTurnQueuePaused(userId: string, conversationId: string): boolean {
    if (!this.ownsConversation(userId, conversationId)) return false
    const row = this.db.prepare(`SELECT paused FROM conversation_turn_control WHERE conversation_id = ?`).get(conversationId) as { paused: number } | undefined
    return Boolean(row?.paused)
  }

  setTurnQueuePaused(userId: string, conversationId: string, paused: boolean): void {
    if (!this.ownsConversation(userId, conversationId)) return
    this.db.prepare(
      `INSERT INTO conversation_turn_control (conversation_id, paused) VALUES (?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET paused = excluded.paused`
    ).run(conversationId, paused ? 1 : 0)
  }

  enqueueTurn(userId: string, conversationId: string, messageId: string, payload: QueueTurnPayload, hideMessage = true): QueuedTurn[] {
    if (!this.ownsConversation(userId, conversationId)) throw new Error('conversation not found')
    const now = this.now()
    this.db.transaction(() => {
      const position = (this.db.prepare(
        `SELECT COALESCE(MAX(position), 0) + 1 AS position FROM conversation_turn_queue WHERE conversation_id = ?`
      ).get(conversationId) as { position: number }).position
      const inserted = this.db.prepare(
        `INSERT OR IGNORE INTO conversation_turn_queue
          (id, conversation_id, user_id, message_id, payload, status, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?)`
      ).run(this.newId(), conversationId, userId, messageId, JSON.stringify(payload), position, now, now)
      if (inserted.changes && hideMessage) {
        this.db.prepare(`UPDATE messages SET state = 'queued', history_position = NULL WHERE id = ? AND conversation_id = ?`).run(messageId, conversationId)
      }
    })()
    return this.listQueuedTurns(userId, conversationId)
  }

  queuedTurnPayload(userId: string, conversationId: string, id: string): QueueTurnPayload | null {
    const row = this.db.prepare(
      `SELECT payload FROM conversation_turn_queue WHERE id = ? AND conversation_id = ? AND user_id = ? AND status IN ('queued','failed')`
    ).get(id, conversationId, userId) as { payload: string } | undefined
    if (!row) return null
    try { return JSON.parse(row.payload) as QueueTurnPayload } catch { return null }
  }

  updateQueuedTurn(userId: string, conversationId: string, id: string, text: string, payload: QueueTurnPayload): QueuedTurn[] {
    this.db.transaction(() => {
      const row = this.db.prepare(
        `SELECT message_id FROM conversation_turn_queue WHERE id = ? AND conversation_id = ? AND user_id = ? AND status IN ('queued','failed')`
      ).get(id, conversationId, userId) as { message_id: string } | undefined
      if (!row) return
      this.db.prepare(`UPDATE messages SET text = ? WHERE id = ? AND conversation_id = ?`).run(text, row.message_id, conversationId)
      this.db.prepare(`UPDATE conversation_turn_queue SET payload = ?, status = 'queued', updated_at = ? WHERE id = ?`).run(JSON.stringify(payload), this.now(), id)
    })()
    return this.listQueuedTurns(userId, conversationId)
  }

  deleteQueuedTurn(userId: string, conversationId: string, id: string): QueuedTurn[] {
    this.db.transaction(() => {
      const row = this.db.prepare(
        `SELECT message_id FROM conversation_turn_queue WHERE id = ? AND conversation_id = ? AND user_id = ? AND status IN ('queued','failed')`
      ).get(id, conversationId, userId) as { message_id: string } | undefined
      if (!row) return
      this.db.prepare(`DELETE FROM conversation_turn_queue WHERE id = ?`).run(id)
      this.db.prepare(`DELETE FROM messages WHERE id = ? AND conversation_id = ?`).run(row.message_id, conversationId)
    })()
    return this.listQueuedTurns(userId, conversationId)
  }

  /** Идемпотентно повышает ожидающий элемент до первого места, не трогая активный ход. */
  prioritizeQueuedTurn(userId: string, conversationId: string, id: string): QueuedTurn[] {
    this.db.transaction(() => {
      const selected = this.db.prepare(
        `SELECT position FROM conversation_turn_queue
         WHERE id = ? AND conversation_id = ? AND user_id = ? AND status IN ('queued','failed')`
      ).get(id, conversationId, userId) as { position: number } | undefined
      if (!selected) return
      const first = this.db.prepare(
        `SELECT MIN(position) AS position FROM conversation_turn_queue
         WHERE conversation_id = ? AND user_id = ? AND status IN ('queued','failed')`
      ).get(conversationId, userId) as { position: number | null }
      if (first.position === null || selected.position === first.position) return
      // UNIQUE(conversation_id, position) проверяется SQLite после каждой строки,
      // поэтому переставляем через заведомо свободный отрицательный/временный диапазон.
      this.db.prepare(`UPDATE conversation_turn_queue SET position = -1, updated_at = ? WHERE id = ?`)
        .run(this.now(), id)
      this.db.prepare(
        `UPDATE conversation_turn_queue SET position = position + 1000000, updated_at = ?
         WHERE conversation_id = ? AND user_id = ? AND status IN ('queued','failed') AND position < ? AND position >= 0`
      ).run(this.now(), conversationId, userId, selected.position)
      this.db.prepare(
        `UPDATE conversation_turn_queue SET position = position - 999999
         WHERE conversation_id = ? AND user_id = ? AND position >= 1000000`
      ).run(conversationId, userId)
      this.db.prepare(
        `UPDATE conversation_turn_queue SET position = ?, status = 'queued', updated_at = ? WHERE id = ?`
      ).run(first.position, this.now(), id)
    })()
    return this.listQueuedTurns(userId, conversationId)
  }

  takeQueuedTurn(userId: string, conversationId: string, id?: string, publish = true): { id: string; messageId: string; payload: QueueTurnPayload; message: Message } | null {
    return this.db.transaction(() => {
      const row = this.db.prepare(
        `SELECT id, message_id, payload FROM conversation_turn_queue
         WHERE user_id = ? AND conversation_id = ? AND status IN ('queued','failed')
           AND (? IS NULL OR id = ?)
         ORDER BY position LIMIT 1`
      ).get(userId, conversationId, id ?? null, id ?? null) as { id: string; message_id: string; payload: string } | undefined
      if (!row) return null
      const position = (this.db.prepare(
        `SELECT COALESCE(MAX(history_position), 0) + 1 AS position FROM messages WHERE conversation_id = ? AND state = 'published'`
      ).get(conversationId) as { position: number }).position
      this.db.prepare(`UPDATE messages SET state = 'published', history_position = ? WHERE id = ? AND conversation_id = ? AND state = 'queued'`)
        .run(position, row.message_id, conversationId)
      this.db.prepare(`DELETE FROM conversation_turn_queue WHERE id = ?`).run(row.id)
      const message = this.listMessages(userId, conversationId).find((item) => item.id === row.message_id)
      if (!message) throw new Error('queued message not found')
      if (!publish) {
        this.db.prepare(`UPDATE messages SET state = 'queued', history_position = NULL WHERE id = ? AND conversation_id = ?`).run(row.message_id, conversationId)
      }
      return { id: row.id, messageId: row.message_id, payload: JSON.parse(row.payload) as QueueTurnPayload, message }
    })()
  }

  markQueuedTurnFailed(userId: string, conversationId: string, messageId: string): void {
    this.db.prepare(
      `UPDATE conversation_turn_queue SET status = 'failed', updated_at = ? WHERE user_id = ? AND conversation_id = ? AND message_id = ?`
    ).run(this.now(), userId, conversationId, messageId)
  }

  // ---- Messages ---------------------------------------------------------

  addMessage(
    userId: string,
    conversationId: string,
    role: MessageRole,
    text: string,
    time: string,
    engine?: LlmProvider,
    meta?: TurnMeta,
    execTarget?: string | null,
    attachments?: MessageAttachment[]
  ): Message {
    if (!this.ownsConversation(userId, conversationId)) {
      throw new Error(`Разговор ${conversationId} не принадлежит пользователю`)
    }
    const id = this.newId()
    const createdAt = this.now()
    const insert = this.db.prepare(
      `INSERT INTO messages (id, conversation_id, role, text, time, created_at, engine, meta, exec_target, attachments, state, history_position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)`
    )
    const touch = this.db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`)
    const metaJson = meta && Object.keys(meta).length > 0 ? JSON.stringify(meta) : null
    this.db.transaction(() => {
      const position = (this.db.prepare(
        `SELECT COALESCE(MAX(history_position), 0) + 1 AS position FROM messages WHERE conversation_id = ? AND state = 'published'`
      ).get(conversationId) as { position: number }).position
      insert.run(id, conversationId, role, text, time, createdAt, engine ?? null, metaJson, execTarget ?? null, attachments?.length ? JSON.stringify(attachments) : null, position)
      touch.run(createdAt, conversationId)
    })()
    return {
      id,
      conversationId,
      role,
      text,
      time,
      createdAt,
      ...(engine ? { engine } : {}),
      ...(meta && Object.keys(meta).length > 0 ? { meta } : {}),
      ...(execTarget !== undefined ? { execTarget } : {}),
      ...(attachments?.length ? { attachments } : {})
    }
  }

  /** Заменяет метаданные сообщения и возвращает актуальную запись. */
  updateMessageMeta(userId: string, conversationId: string, messageId: string, meta: TurnMeta): Message {
    if (!this.ownsConversation(userId, conversationId)) throw new Error('message not found')
    const result = this.db
      .prepare(`UPDATE messages SET meta = ? WHERE id = ? AND conversation_id = ?`)
      .run(Object.keys(meta).length ? JSON.stringify(meta) : null, messageId, conversationId)
    if (!result.changes) throw new Error('message not found')
    const message = this.listMessages(userId, conversationId).find((item) => item.id === messageId)
    if (!message) throw new Error('message not found')
    return message
  }

  /** Удаляет одно сообщение по id (в рамках разговора пользователя). */
  deleteMessage(userId: string, conversationId: string, messageId: string): void {
    if (!this.ownsConversation(userId, conversationId)) return
    this.db
      .prepare(`DELETE FROM messages WHERE id = ? AND conversation_id = ?`)
      .run(messageId, conversationId)
  }

  listMessages(userId: string, conversationId: string): Message[] {
    if (!this.ownsConversation(userId, conversationId)) return []
    const rows = this.db
      .prepare(
        `SELECT * FROM messages WHERE conversation_id = ? AND state = 'published' ORDER BY history_position ASC, id ASC`
      )
      .all(conversationId) as MessageRow[]
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      role: r.role as MessageRole,
      text: r.text,
      time: r.time,
      createdAt: r.created_at,
      ...(r.engine ? { engine: r.engine as LlmProvider } : {}),
      ...(r.meta ? { meta: parseMeta(r.meta) } : {}),
      ...(r.exec_target !== null ? { execTarget: r.exec_target } : {}),
      ...(parseAttachments(r.attachments) ? { attachments: parseAttachments(r.attachments) } : {})
    }))
  }


  // ---- Полнотекстовый поиск по сообщениям (FTS5) -------------------------

  /**
   * Ищет сообщения пользователя по индексу `messages_fts`.
   *
   * Владелец фильтруется джойном на `conversations.user_id` — чужие сообщения
   * недостижимы при любых параметрах (в том числе при явном `conversationId`).
   * Порядок — bm25 (меньше = релевантнее), при равенстве — по rowid, чтобы
   * страницы не «дышали»: курсор кодирует именно эту пару.
   *
   * `projectId`: undefined — по всем беседам, null — только беседы без проекта.
   * Сообщения чатов отменённых задач исключаются до LIMIT/курсора; прямой поиск
   * внутри такого разговора намеренно не превращает его в стандартную выборку.
   */
  searchMessages(userId: string, opts: MessageSearchOptions): MessageSearchResult {
    const match = toFtsMatchQuery(opts.q ?? '')
    const limit = clampSearchLimit(opts.limit)
    // Индекса нет (сборка SQLite без FTS5) или искать нечего — пустая страница.
    if (!match || !this.ftsReady) return { hits: [], nextCursor: null, match }

    const where = ['messages_fts MATCH ?', 'c.user_id = ?', "m.state = 'published'", NOT_CANCELLED_TASK_CHAT]
    const params: unknown[] = [match, userId]
    if (opts.projectId !== undefined) {
      if (opts.projectId === null) where.push('c.project_id IS NULL')
      else {
        where.push('c.project_id = ?')
        params.push(opts.projectId)
      }
    }
    if (opts.conversationId) {
      where.push('m.conversation_id = ?')
      params.push(opts.conversationId)
    }
    const cursor = decodeSearchCursor(opts.cursor)
    if (cursor) {
      where.push('(bm25(messages_fts) > ? OR (bm25(messages_fts) = ? AND m.rowid > ?))')
      params.push(cursor.score, cursor.score, cursor.rowid)
    }

    const rows = this.db
      .prepare(
        `SELECT m.id            AS message_id,
                m.conversation_id,
                m.role,
                m.created_at,
                m.time,
                m.rowid         AS rid,
                c.title         AS conversation_title,
                c.project_id,
                bm25(messages_fts) AS score,
                snippet(messages_fts, 0, '<mark>', '</mark>', '…', ${SNIPPET_TOKENS}) AS snippet
           FROM messages_fts
           JOIN messages m      ON m.rowid = messages_fts.rowid
           JOIN conversations c ON c.id = m.conversation_id
          WHERE ${where.join(' AND ')}
          ORDER BY score ASC, rid ASC
          LIMIT ?`
      )
      .all(...params, limit) as MessageSearchRow[]

    const hits: MessageSearchHit[] = rows.map((r) => ({
      messageId: r.message_id,
      conversationId: r.conversation_id,
      conversationTitle: r.conversation_title,
      projectId: r.project_id,
      role: r.role as MessageRole,
      createdAt: r.created_at,
      time: r.time,
      snippet: r.snippet,
      score: r.score
    }))
    // Полная страница — предполагаем продолжение: следующий запрос либо добьёт
    // остаток, либо вернёт пусто. Это дешевле, чем считать общее число совпадений.
    const last = rows[rows.length - 1]
    const nextCursor = last && rows.length === limit ? encodeSearchCursor(last.score, last.rid) : null
    return { hits, nextCursor, match }
  }

  /**
   * Подключает FTS5-индекс: DDL с триггерами + запуск бэкфилла истории.
   * Вызывается на каждом старте и обязана быть идемпотентной.
   */
  private setupMessagesFts(): void {
    try {
      this.db.exec(MESSAGES_FTS_SQL)
      this.ftsReady = true
    } catch {
      // SQLite без FTS5: поиск по сообщениям недоступен, но сервер поднимается —
      // остальная БД работоспособна, а роут вернёт пустой результат.
      this.ftsReady = false
      return
    }
    const state = this.ftsState()
    if (!state) {
      // Первый старт с индексом (новая БД или миграция боевой): историю
      // проиндексируем порциями, чтобы не держать старт на 100k сообщений.
      this.db.prepare(`INSERT INTO fts_state (name, last_rowid, max_rowid, done) VALUES (?, 0, 0, 0)`).run(FTS_MESSAGES)
    }
    this.scheduleFtsBackfill()
  }

  private ftsState(): FtsStateRow | undefined {
    return this.db
      .prepare(`SELECT last_rowid AS lastRowid, max_rowid AS maxRowid, done, repairs FROM fts_state WHERE name = ?`)
      .get(FTS_MESSAGES) as FtsStateRow | undefined
  }

  /**
   * Ставит следующую порцию бэкфилла в очередь макротаска. Таймер `unref`-нут:
   * незаконченный бэкфилл не должен держать процесс живым (важно и в тестах).
   */
  private scheduleFtsBackfill(): void {
    if (this.closed || !this.ftsReady || this.ftsTimer) return
    const state = this.ftsState()
    if (!state || state.done) return
    const timer = setTimeout(() => {
      this.ftsTimer = null
      try {
        const res = this.backfillMessagesFts()
        if (!res.done) this.scheduleFtsBackfill()
      } catch {
        // Бэкфилл — не критичный путь: недоиндексированная история просто не
        // находится. Сервер и запись сообщений при этом целы.
      }
    }, FTS_BACKFILL_PAUSE_MS)
    timer.unref?.()
    this.ftsTimer = timer
  }

  /**
   * Одна порция бэкфилла (открыта для тестов и разогрева).
   *
   * Границу `max_rowid` фиксируем на старте: всё, что появилось позже, уже
   * проиндексировано триггерами, и повторная вставка тех же rowid раздула бы
   * индекс дублями. Старт с нуля начинается с `delete-all`, поэтому повторный
   * запуск (или потерянное состояние) пересобирает индекс, а не удваивает его.
   */
  backfillMessagesFts(chunk = FTS_BACKFILL_CHUNK): { indexed: number; done: boolean } {
    if (this.closed || !this.ftsReady) return { indexed: 0, done: true }
    const state = this.ftsState()
    if (!state || state.done) return { indexed: 0, done: true }

    let maxRowid = state.maxRowid
    if (state.lastRowid === 0) {
      this.db.exec(`INSERT INTO messages_fts (messages_fts) VALUES ('delete-all')`)
      maxRowid = (this.db.prepare(`SELECT COALESCE(MAX(rowid), 0) AS m FROM messages`).get() as { m: number }).m
      this.db.prepare(`UPDATE fts_state SET max_rowid = ? WHERE name = ?`).run(maxRowid, FTS_MESSAGES)
    }
    const rows = this.db
      .prepare(`SELECT rowid AS rid, text FROM messages WHERE rowid > ? AND rowid <= ? ORDER BY rowid LIMIT ?`)
      .all(state.lastRowid, maxRowid, chunk) as Array<{ rid: number; text: string }>

    const insert = this.db.prepare(`INSERT INTO messages_fts (rowid, text) VALUES (?, ?)`)
    const done = rows.length < chunk
    const lastRowid = rows.length ? rows[rows.length - 1].rid : state.lastRowid
    this.db.transaction(() => {
      for (const r of rows) insert.run(r.rid, r.text)
      this.db
        .prepare(`UPDATE fts_state SET last_rowid = ?, done = ? WHERE name = ?`)
        .run(lastRowid, done ? 1 : 0, FTS_MESSAGES)
    })()
    if (done && rows.length > 0) this.verifyMessagesFts()
    return { indexed: rows.length, done }
  }

  /** Догоняет бэкфилл целиком (тесты и bench: им нужен готовый индекс). */
  ensureMessagesIndexed(): void {
    for (let i = 0; i < FTS_BACKFILL_MAX_CHUNKS; i++) {
      if (this.backfillMessagesFts().done) return
    }
  }

  /**
   * Проверяет индекс после бэкфилла. Удаление сообщения в момент бэкфилла может
   * оставить в индексе мусор (триггер удаляет то, чего там ещё нет), поэтому
   * один раз честно пересобираем — иначе поиск начнёт врать молча.
   */
  private verifyMessagesFts(): void {
    const state = this.ftsState()
    if (!state) return
    try {
      this.db.exec(`INSERT INTO messages_fts (messages_fts) VALUES ('integrity-check')`)
    } catch {
      if (state.repairs >= FTS_MAX_REPAIRS) return
      this.db
        .prepare(`UPDATE fts_state SET last_rowid = 0, max_rowid = 0, done = 0, repairs = repairs + 1 WHERE name = ?`)
        .run(FTS_MESSAGES)
      this.scheduleFtsBackfill()
    }
  }

  // ---- Settings ---------------------------------------------------------

  /** Настройки LLM, которые связанный чат задачи наследует от своего владельца. */
  private taskChatLlmDefaults(userId: string, settings = this.getSettings(userId)): { engineId: string | null; provider: LlmProvider; model: string } {
    const role = this.getUser(userId)?.role ?? 'developer'
    const provider = settings.llmProvider
    const model = provider === 'codex' ? settings.codexModel : settings.model
    const engineId = this.resolveLlmEngine(settings.llmEngineId, provider, role).engine?.id ?? null
    return { engineId, provider, model }
  }

  getSettings(userId: string): Settings {
    const row = this.db
      .prepare(`SELECT value FROM settings WHERE key = ?`)
      .get(settingsKey(userId)) as { value: string } | undefined
    if (!row) return { ...DEFAULT_SETTINGS }
    try {
      // Мержим с дефолтами, чтобы новые поля не ломали старый конфиг.
      const parsed = JSON.parse(row.value) as Partial<Settings>
      return { ...DEFAULT_SETTINGS, ...parsed, personalization: { ...DEFAULT_SETTINGS.personalization, ...parsed.personalization } }
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  saveSettings(userId: string, settings: Settings): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(settingsKey(userId), JSON.stringify(settings))
  }

  /** Идемпотентно переносит legacy-разговоры desktop, сохраняя id и даты. */
  importDesktopData(userId: string, bundle: DesktopMigrationBundle): DesktopMigrationResult {
    const insertConversation = this.db.prepare(`INSERT OR IGNORE INTO conversations (id, title, created_at, updated_at, claude_session_id, user_id, exec_target, workdir, skill_names, llm_provider, llm_model) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, '[]', NULL, NULL)`)
    const insertMessage = this.db.prepare(`INSERT OR IGNORE INTO messages (id, conversation_id, role, text, time, created_at, engine, meta, exec_target) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    let conversationsImported = 0
    let messagesImported = 0
    this.db.transaction(() => {
      for (const item of bundle.conversations) {
        const c = item.conversation
        conversationsImported += Number(insertConversation.run(c.id, c.title, c.createdAt, c.updatedAt, c.claudeSessionId, userId, c.execTarget).changes)
        if (!this.ownsConversation(userId, c.id)) continue
        for (const m of item.messages) {
          if (m.conversationId !== c.id) continue
          messagesImported += Number(insertMessage.run(m.id, c.id, m.role, m.text, m.time, m.createdAt, m.engine ?? null, m.meta ? JSON.stringify(m.meta) : null, m.execTarget ?? null).changes)
        }
      }
    })()
    return { conversationsImported, messagesImported }
  }

  // ---- Agents (машины для удалённого выполнения команд) ------------------

  /** Создаёт машину-агента пользователя; возвращает токен открытым текстом (раз). */
  createAgent(userId: string, name: string): AgentCreated {
    const id = this.newId()
    const token = randomBytes(24).toString('hex')
    this.db
      .prepare(
        `INSERT INTO agents (id, name, token_hash, created_at, last_seen, policy, user_id)
         VALUES (?, ?, ?, ?, NULL, ?, ?)`
      )
      .run(id, name, hashAgentToken(token), this.now(), JSON.stringify(DEFAULT_AGENT_POLICY), userId)
    return { id, name, token }
  }

  private mapAgent(r: AgentRow): AgentRecord {
    return {
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      lastSeen: r.last_seen,
      policy: parsePolicy(r.policy),
      userId: r.user_id
    }
  }

  listAgents(userId: string): AgentRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM agents WHERE user_id = ? ORDER BY created_at ASC`)
      .all(userId) as AgentRow[]
    return rows.map((r) => this.mapAgent(r))
  }

  /**
   * Машины, доступные в контексте чата: все личные и, только для действующего
   * участника проекта, связанные с ним машины. DISTINCT убирает личную машину,
   * которая одновременно добавлена в проект.
   */
  listUsableAgents(userId: string, projectId?: string | null): AgentRecord[] {
    const rows = this.db.prepare(
      `SELECT DISTINCT a.*
       FROM agents a
       WHERE a.user_id = ?
          OR (? IS NOT NULL AND EXISTS (
            SELECT 1 FROM machine_project_shares share
            JOIN project_members member ON member.project_id = share.project_id
            JOIN users u ON u.name = member.username
            WHERE share.project_id = ? AND share.agent_id = a.id AND share.shared = 1
              AND member.username = ? AND u.blocked = 0
          ))
       ORDER BY a.created_at ASC`
    ).all(userId, projectId ?? null, projectId ?? null, userId) as AgentRow[]
    return rows.map((r) => this.mapAgent(r))
  }

  /**
   * Единый гейт использования машины. Проектный доступ существует только при
   * явно переданном контексте проекта и действующем членстве пользователя.
   */
  canUseAgent(userId: string, agentId: string, projectId?: string | null): boolean {
    if (this.db.prepare(`SELECT 1 FROM agents WHERE id = ? AND user_id = ?`).get(agentId, userId)) return true
    if (!projectId) return false
    return Boolean(this.db.prepare(
      `SELECT 1 FROM machine_project_shares share
       JOIN project_members member ON member.project_id = share.project_id
       JOIN users u ON u.name = member.username
       WHERE share.project_id = ? AND share.agent_id = ? AND share.shared = 1
         AND member.username = ? AND u.blocked = 0`
    ).get(projectId, agentId, userId))
  }

  getUserProjectDefaultMachine(userId: string, projectId: string): string | null {
    const row = this.db.prepare(
      `SELECT d.agent_id FROM user_project_machine_defaults d
       WHERE d.username = ? AND d.project_id = ?`
    ).get(userId, projectId) as { agent_id: string } | undefined
    return row && this.canUseAgent(userId, row.agent_id, projectId) ? row.agent_id : null
  }

  setUserProjectDefaultMachine(userId: string, projectId: string, agentId: string | null): void {
    if (!this.isProjectMember(userId, projectId)) throw new Error('Пользователь не состоит в проекте')
    if (agentId === null) {
      this.db.prepare(`DELETE FROM user_project_machine_defaults WHERE username=? AND project_id=?`).run(userId, projectId)
      return
    }
    if (!this.canUseAgent(userId, agentId, projectId)) throw new Error('Машина недоступна в этом проекте')
    this.db.prepare(
      `INSERT INTO user_project_machine_defaults (username,project_id,agent_id,updated_at)
       VALUES (?,?,?,?)
       ON CONFLICT(username,project_id) DO UPDATE SET agent_id=excluded.agent_id,updated_at=excluded.updated_at`
    ).run(userId, projectId, agentId, this.now())
  }

  setMachineSharedWithProject(userId: string, projectId: string, agentId: string, shared: boolean): void {
    if (!this.isProjectMember(userId, projectId)) throw new Error('Пользователь не состоит в проекте')
    if (!this.db.prepare(`SELECT 1 FROM agents WHERE id=? AND user_id=?`).get(agentId, userId)) {
      throw new Error('Только владелец машины может менять предоставление')
    }
    const previous = Boolean((this.db.prepare(
      `SELECT shared FROM machine_project_shares WHERE project_id=? AND agent_id=?`
    ).get(projectId, agentId) as { shared: number } | undefined)?.shared)
    if (previous === shared) return
    const ts = this.now()
    this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO machine_project_shares (project_id,agent_id,shared,created_at,updated_at,updated_by)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(project_id,agent_id) DO UPDATE SET shared=excluded.shared,updated_at=excluded.updated_at,updated_by=excluded.updated_by`
      ).run(projectId, agentId, shared ? 1 : 0, ts, ts, userId)
      this.db.prepare(
        `INSERT INTO machine_project_share_audit (id,project_id,agent_id,actor,old_value,new_value,created_at)
         VALUES (?,?,?,?,?,?,?)`
      ).run(this.newId(), projectId, agentId, userId, previous ? 1 : 0, shared ? 1 : 0, ts)
      if (!shared) {
        this.db.prepare(`DELETE FROM user_project_machine_defaults WHERE project_id=? AND agent_id=?`).run(projectId, agentId)
      }
    })()
  }

  isMachineSharedWithProject(projectId: string, agentId: string): boolean {
    return Boolean((this.db.prepare(
      `SELECT shared FROM machine_project_shares WHERE project_id=? AND agent_id=?`
    ).get(projectId, agentId) as { shared: number } | undefined)?.shared)
  }

  listMachineShareAudit(projectId: string): Array<{ actor: string; agentId: string; oldValue: boolean; newValue: boolean; createdAt: number }> {
    return (this.db.prepare(
      `SELECT actor,agent_id,old_value,new_value,created_at FROM machine_project_share_audit
       WHERE project_id=? ORDER BY created_at,rowid`
    ).all(projectId) as Array<{ actor: string; agent_id: string; old_value: number; new_value: number; created_at: number }>)
      .map((row) => ({ actor: row.actor, agentId: row.agent_id, oldValue: !!row.old_value, newValue: !!row.new_value, createdAt: row.created_at }))
  }

  /** Ищет агента по хэшу токена (авторизация WS-подключения). Глобально по токену. */
  findAgentByTokenHash(tokenHash: string): AgentRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM agents WHERE token_hash = ?`)
      .get(tokenHash) as AgentRow | undefined
    return row ? this.mapAgent(row) : null
  }

  /** Задаёт политику возможностей машины (в рамках владельца). */
  setAgentPolicy(userId: string, id: string, policy: AgentPolicy): void {
    this.db
      .prepare(`UPDATE agents SET policy = ? WHERE id = ? AND user_id = ?`)
      .run(JSON.stringify(policy), id, userId)
  }

  /** Перевыпускает токен машины (старый перестаёт работать). Возвращает новый токен. */
  regenerateAgentToken(userId: string, id: string): { token: string } {
    const token = randomBytes(24).toString('hex')
    this.db
      .prepare(`UPDATE agents SET token_hash = ? WHERE id = ? AND user_id = ?`)
      .run(hashAgentToken(token), id, userId)
    return { token }
  }

  /**
   * Удаляет машину. Связки с проектами уносит CASCADE (`project_machines`), а вот
   * `projects.default_agent_id` — обычная колонка без внешнего ключа: не почистить
   * её означает оставить проекту машину по умолчанию, которой больше нет (CI-ран
   * такого проекта уходил бы в никуда). То же делает `unlinkMachine`.
   */
  deleteAgent(userId: string, id: string): void {
    this.db.prepare(`DELETE FROM agents WHERE id = ? AND user_id = ?`).run(id, userId)
    this.db.prepare(`UPDATE projects SET default_agent_id = NULL WHERE default_agent_id = ?`).run(id)
  }

  /** Обновляет last_seen (при регистрации и по pong). */
  touchAgent(id: string): void {
    if (this.closed) return
    this.db.prepare(`UPDATE agents SET last_seen = ? WHERE id = ?`).run(this.now(), id)
  }

  // ---- Users (аккаунты приложения) --------------------------------------

  private mapUser(r: UserDbRow): UserRow {
    return { name: r.name, role: r.role as UserRole, blocked: r.blocked !== 0, createdAt: r.created_at }
  }

  /**
   * Гарантирует наличие пользователя admin (сид при старте). Пароль применяется
   * только при создании записи — смена пароля через UI не перезатирается рестартом.
   */
  ensureAdmin(password = ''): void {
    const exists = this.db.prepare(`SELECT 1 FROM users WHERE name = 'admin'`).get()
    if (exists) return
    this.db
      .prepare(`INSERT INTO users (name, password_hash, role, blocked, created_at) VALUES (?, ?, 'admin', 0, ?)`)
      .run('admin', hashPassword(password), this.now())
  }

  /** Создаёт пользователя с одной из поддерживаемых ролей. Кидает при дубликате имени. */
  createUser(name: string, password: string, role: UserRole): UserRow {
    this.db
      .prepare(`INSERT INTO users (name, password_hash, role, blocked, created_at) VALUES (?, ?, ?, 0, ?)`)
      .run(name, hashPassword(password), role, this.now())
    return { name, role, blocked: false, createdAt: this.now() }
  }

  getUser(name: string): UserRow | null {
    const row = this.db.prepare(`SELECT * FROM users WHERE name = ?`).get(name) as
      | UserDbRow
      | undefined
    return row ? this.mapUser(row) : null
  }

  listUsers(): UserRow[] {
    const rows = this.db.prepare(`SELECT * FROM users ORDER BY created_at ASC`).all() as UserDbRow[]
    return rows.map((r) => this.mapUser(r))
  }

  /** Проверяет пароль; возвращает пользователя при успехе, иначе null. */
  verifyUserPassword(name: string, password: string): UserRow | null {
    const row = this.db.prepare(`SELECT * FROM users WHERE name = ?`).get(name) as
      | UserDbRow
      | undefined
    if (!row) return null
    return verifyPassword(password, row.password_hash) ? this.mapUser(row) : null
  }

  setUserBlocked(name: string, blocked: boolean): void {
    this.db.prepare(`UPDATE users SET blocked = ? WHERE name = ?`).run(blocked ? 1 : 0, name)
  }

  setUserRole(name: string, role: UserRole): UserRow | null {
    this.db.prepare(`UPDATE users SET role = ? WHERE name = ?`).run(role, name)
    return this.getUser(name)
  }

  setUserPassword(name: string, password: string): void {
    this.db.prepare(`UPDATE users SET password_hash = ? WHERE name = ?`).run(hashPassword(password), name)
  }

  deleteUser(name: string): void {
    this.db.prepare(`DELETE FROM users WHERE name = ?`).run(name)
  }

  /** Делает конкретный Bearer-токен недействительным даже после рестарта сервера. */
  revokeSession(token: string): void {
    const hash = createHash('sha256').update(token).digest('hex')
    this.db.prepare(`INSERT OR IGNORE INTO session_revocations (token_hash, created_at) VALUES (?, ?)`).run(hash, this.now())
  }

  isSessionRevoked(token: string): boolean {
    const hash = createHash('sha256').update(token).digest('hex')
    return Boolean(this.db.prepare(`SELECT 1 FROM session_revocations WHERE token_hash = ?`).get(hash))
  }

  /** Deny-list rows only: an empty list means every provider and model is allowed. */
  getUserLlmAccess(userId: string): UserLlmAccess[] {
    return this.db.prepare(`SELECT provider, model_id AS modelId FROM user_llm_access WHERE user_name = ? ORDER BY provider, model_id`).all(userId) as UserLlmAccess[]
  }

  setUserLlmAccess(userId: string, access: UserLlmAccess[]): void {
    const insert = this.db.prepare(`INSERT INTO user_llm_access (user_name, provider, model_id) VALUES (?, ?, ?)`)
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM user_llm_access WHERE user_name = ?`).run(userId)
      for (const entry of access) insert.run(userId, entry.provider, entry.modelId)
    })()
  }

  /** Удаляет пользователя и ВСЕ его данные (разговоры/сообщения/агенты/настройки). */
  deleteUserData(userId: string): void {
    this.db.transaction(() => {
      // messages/speakers уйдут по ON DELETE CASCADE.
      this.db.prepare(`DELETE FROM conversations WHERE user_id = ?`).run(userId)
      this.db.prepare(`DELETE FROM agents WHERE user_id = ?`).run(userId)
      this.db.prepare(`DELETE FROM settings WHERE key = ?`).run(settingsKey(userId))
      // Проекты: снять назначения, убрать членства и удалить осиротевшие проекты
      // (project_machines уйдут по CASCADE при удалении агентов выше и/или проектов).
      this.db.prepare(`UPDATE tasks SET assignee = NULL WHERE assignee = ?`).run(userId)
      this.db.prepare(`DELETE FROM project_members WHERE username = ?`).run(userId)
      this.db
        .prepare(
          `DELETE FROM projects WHERE id IN (
             SELECT p.id FROM projects p
             WHERE NOT EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.role = 'owner')
           )`
        )
        .run()
      this.db.prepare(`DELETE FROM users WHERE name = ?`).run(userId)
    })()
  }


  // ---- LLM engines (реестр исполнителей) ---------------------------------

  private mapLlmEngine(r: LlmEngineRow): AdminLlmEngine {
    return {
      id: r.id,
      name: r.name,
      kind: normEngineKind(r.kind),
      baseUrl: r.base_url,
      token: r.token,
      enabled: r.enabled !== 0,
      allowedRoles: parseAllowedRoles(r.allowed_roles),
      isDefault: r.is_default !== 0,
      createdAt: r.created_at
    }
  }

  listLlmEngines(): AdminLlmEngine[] {
    const rows = this.db
      .prepare(`SELECT * FROM llm_engines ORDER BY kind ASC, is_default DESC, created_at ASC`)
      .all() as LlmEngineRow[]
    return rows.map((row) => this.mapLlmEngine(row))
  }

  getLlmEngine(id: string): AdminLlmEngine | null {
    const row = this.db.prepare(`SELECT * FROM llm_engines WHERE id = ?`).get(id) as LlmEngineRow | undefined
    return row ? this.mapLlmEngine(row) : null
  }


  /** Исполнители, доступные роли; секреты наружу не возвращаются. */
  listLlmEnginesForRole(role: UserRole) {
    return this.listLlmEngines()
      .filter((engine) => engine.enabled && engine.allowedRoles.includes(role))
      .map(({ id, name, kind, isDefault }) => ({ id, name, kind, isDefault }))
  }

  resolveLlmEngine(engineId: string | null | undefined, kind: LlmEngineKind, role: UserRole) {
    const allowed = (engine: AdminLlmEngine | null): engine is AdminLlmEngine =>
      Boolean(engine && engine.kind === kind && engine.enabled && engine.allowedRoles.includes(role))
    const requested = engineId ? this.getLlmEngine(engineId) : null
    if (allowed(requested)) return { engine: requested, substituted: false }
    const fallback = this.listLlmEngines().find((engine) => engine.kind === kind && engine.isDefault && allowed(engine))
      ?? this.listLlmEngines().find((engine) => engine.kind === kind && allowed(engine))
      ?? null
    return { engine: fallback, substituted: Boolean(engineId && engineId !== fallback?.id) }
  }

  createLlmEngine(input: AdminLlmEngineInput): AdminLlmEngine {
    const id = this.newId()
    const ts = this.now()
    this.db.transaction(() => {
      if (input.isDefault) this.db.prepare(`UPDATE llm_engines SET is_default = 0 WHERE kind = ?`).run(input.kind)
      this.db
        .prepare(
          `INSERT INTO llm_engines (id, name, kind, base_url, token, enabled, allowed_roles, is_default, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.name,
          input.kind,
          input.baseUrl,
          input.token,
          input.enabled ? 1 : 0,
          JSON.stringify(input.allowedRoles),
          input.isDefault ? 1 : 0,
          ts
        )
    })()
    return this.getLlmEngine(id) as AdminLlmEngine
  }

  updateLlmEngine(id: string, patch: AdminLlmEngineInput): AdminLlmEngine | null {
    const exists = this.getLlmEngine(id)
    if (!exists) return null
    this.db.transaction(() => {
      if (patch.isDefault) this.db.prepare(`UPDATE llm_engines SET is_default = 0 WHERE kind = ? AND id != ?`).run(patch.kind, id)
      this.db
        .prepare(
          `UPDATE llm_engines
           SET name = ?, kind = ?, base_url = ?, token = ?, enabled = ?, allowed_roles = ?, is_default = ?
           WHERE id = ?`
        )
        .run(
          patch.name,
          patch.kind,
          patch.baseUrl,
          patch.token,
          patch.enabled ? 1 : 0,
          JSON.stringify(patch.allowedRoles),
          patch.isDefault ? 1 : 0,
          id
        )
    })()
    return this.getLlmEngine(id)
  }

  deleteLlmEngine(id: string): void {
    this.db.prepare(`DELETE FROM llm_engines WHERE id = ?`).run(id)
  }

  listModelPrices(): ModelPrice[] {
    return this.db.prepare(`SELECT provider, model, input_per_million AS inputPerMillion, cached_input_per_million AS cachedInputPerMillion, cache_write_per_million AS cacheWritePerMillion, output_per_million AS outputPerMillion, source_url AS sourceUrl, effective_at AS effectiveAt, updated_at AS updatedAt FROM model_prices ORDER BY provider, model`).all() as ModelPrice[]
  }

  upsertModelPrice(input: ModelPriceInput): ModelPrice {
    const updatedAt = Date.now()
    this.db.prepare(`INSERT INTO model_prices (provider, model, input_per_million, cached_input_per_million, cache_write_per_million, output_per_million, source_url, effective_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(provider, model) DO UPDATE SET input_per_million=excluded.input_per_million, cached_input_per_million=excluded.cached_input_per_million, cache_write_per_million=excluded.cache_write_per_million, output_per_million=excluded.output_per_million, source_url=excluded.source_url, effective_at=excluded.effective_at, updated_at=excluded.updated_at`).run(input.provider, input.model, input.inputPerMillion, input.cachedInputPerMillion, input.cacheWritePerMillion, input.outputPerMillion, input.sourceUrl, input.effectiveAt, updatedAt)
    return this.db.prepare(`SELECT provider, model, input_per_million AS inputPerMillion, cached_input_per_million AS cachedInputPerMillion, cache_write_per_million AS cacheWritePerMillion, output_per_million AS outputPerMillion, source_url AS sourceUrl, effective_at AS effectiveAt, updated_at AS updatedAt FROM model_prices WHERE provider = ? AND model = ?`).get(input.provider, input.model) as ModelPrice
  }

  deleteModelPrice(provider: string, model: string): boolean {
    return this.db.prepare(`DELETE FROM model_prices WHERE provider = ? AND model = ?`).run(provider, model).changes > 0
  }

  // ---- Отчёт по токенам (агрегация meta ai-сообщений пользователя) --------

  /**
   * Отчёт по использованию токенов пользователя: суммы по временным бакетам и по
   * моделям + итог. Считается из meta ai-сообщений (JSON1 json_extract). Бакеты
   * времени — в UTC (created_at хранится в мс).
   */
  usageReport(userId: string, unit: UsageUnit, from?: number, to?: number, conversationId?: string): UsageReport {
    const fmt = unit === 'hour' ? '%Y-%m-%d %H:00' : unit === 'week' ? '%Y-W%W' : '%Y-%m-%d'
    // Два независимых числа: CLI сообщает фактическую цену не для всех движков,
    // а редактируемый прайс пересчитывает все ответы с известной строкой.
    const estimatedCost = `CASE WHEN mp.model IS NOT NULL THEN (
      MAX(COALESCE(json_extract(m.meta,'$.inputTokens'),0) - COALESCE(json_extract(m.meta,'$.cacheReadTokens'),0), 0) * mp.input_per_million +
      COALESCE(json_extract(m.meta,'$.cacheReadTokens'),0) * mp.cached_input_per_million +
      COALESCE(json_extract(m.meta,'$.cacheCreationTokens'),0) * mp.cache_write_per_million +
      COALESCE(json_extract(m.meta,'$.outputTokens'),0) * mp.output_per_million
    ) / 1000000.0 END`
    const sums = `
      COUNT(*) AS messages,
      COALESCE(SUM(json_extract(m.meta,'$.inputTokens')),0) AS inputTokens,
      COALESCE(SUM(json_extract(m.meta,'$.outputTokens')),0) AS outputTokens,
      COALESCE(SUM(json_extract(m.meta,'$.cacheReadTokens')),0) AS cacheReadTokens,
      COALESCE(SUM(json_extract(m.meta,'$.costUsd')),0) AS costUsd,
      COALESCE(SUM(${estimatedCost}),0) AS costFromPrices,
      MAX(CASE WHEN json_extract(m.meta,'$.costUsd') IS NULL AND mp.model IS NULL THEN 1 ELSE 0 END) AS costIncomplete`
    const dateWhere = `${from !== undefined ? 'AND m.created_at >= @from' : ''}
      ${to !== undefined ? 'AND m.created_at <= @to' : ''}`
    const where = `c.user_id = @userId AND m.role = 'ai' AND m.meta IS NOT NULL ${dateWhere}
      ${conversationId ? 'AND c.id = @conversationId' : ''}`
    const bind = { userId, ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}), ...(conversationId ? { conversationId } : {}) }
    const joins = `FROM messages m JOIN conversations c ON m.conversation_id = c.id
      LEFT JOIN model_prices mp ON mp.provider = m.engine AND mp.model = COALESCE(json_extract(m.meta,'$.model'), c.llm_model)`

    type SqlUsage<T extends UsageTotals> = Omit<T, 'costIncomplete'> & { costIncomplete?: number }
    const complete = <T extends UsageTotals>(row: SqlUsage<T>): T => ({ ...row, costIncomplete: Boolean(row.costIncomplete) } as T)
    const totals = complete(this.db.prepare(`SELECT ${sums} ${joins} WHERE ${where}`).get(bind) as SqlUsage<UsageTotals>)
    const byBucket = (this.db.prepare(`SELECT strftime('${fmt}', m.created_at/1000, 'unixepoch') AS bucket, ${sums}
      ${joins} WHERE ${where} GROUP BY bucket ORDER BY bucket ASC`).all(bind) as SqlUsage<UsageBucket>[]).map((row) => complete<UsageBucket>(row))
    const byModel = (this.db.prepare(`SELECT COALESCE(json_extract(m.meta,'$.model'), c.llm_model, '?') AS model, ${sums}
      ${joins} WHERE ${where} GROUP BY COALESCE(json_extract(m.meta,'$.model'), c.llm_model, '?') ORDER BY outputTokens DESC`).all(bind) as SqlUsage<UsageByModel>[]).map((row) => complete<UsageByModel>(row))
    // Фильтр разговоров всегда строится для всего выбранного периода, чтобы после
    // выбора одного разговора остальные варианты не исчезали из селекта.
    const conversationWhere = `c.user_id = @userId AND m.role = 'ai' AND m.meta IS NOT NULL ${dateWhere}`
    const byConversation = (this.db.prepare(`SELECT c.id AS conversationId, c.title, ${sums}
      ${joins} WHERE ${conversationWhere} GROUP BY c.id, c.title ORDER BY costUsd DESC, c.updated_at DESC`).all(bind) as SqlUsage<UsageByConversation>[]).map((row) => complete<UsageByConversation>(row))
    return { unit, conversationId: conversationId ?? null, totals, byBucket, byModel, byConversation }
  }

  /**
   * Один SQL-проход для дашборда: итоги и использованные модели всех пользователей.
   * В отличие от вызова usageReport на каждого пользователя не создаёт N запросов.
   */
  usageSummary(from?: number, to?: number): import('@voicechat/shared').UserUsageSummary[] {
    const estimatedCost = `CASE WHEN mp.model IS NOT NULL THEN (
      MAX(COALESCE(json_extract(m.meta,'$.inputTokens'),0) - COALESCE(json_extract(m.meta,'$.cacheReadTokens'),0), 0) * mp.input_per_million +
      COALESCE(json_extract(m.meta,'$.cacheReadTokens'),0) * mp.cached_input_per_million +
      COALESCE(json_extract(m.meta,'$.cacheCreationTokens'),0) * mp.cache_write_per_million +
      COALESCE(json_extract(m.meta,'$.outputTokens'),0) * mp.output_per_million
    ) / 1000000.0 END`
    const sums = `COUNT(*) AS messages,
      COALESCE(SUM(json_extract(m.meta,'$.inputTokens')),0) AS inputTokens,
      COALESCE(SUM(json_extract(m.meta,'$.outputTokens')),0) AS outputTokens,
      COALESCE(SUM(json_extract(m.meta,'$.cacheReadTokens')),0) AS cacheReadTokens,
      COALESCE(SUM(json_extract(m.meta,'$.costUsd')),0) AS costUsd,
      COALESCE(SUM(${estimatedCost}),0) AS costFromPrices,
      MAX(CASE WHEN json_extract(m.meta,'$.costUsd') IS NULL AND mp.model IS NULL THEN 1 ELSE 0 END) AS costIncomplete`
    const where = `m.role = 'ai' AND m.meta IS NOT NULL ${from !== undefined ? 'AND m.created_at >= @from' : ''} ${to !== undefined ? 'AND m.created_at <= @to' : ''}`
    const bind = { ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) }
    const joins = `FROM messages m JOIN conversations c ON m.conversation_id = c.id
      LEFT JOIN model_prices mp ON mp.provider = m.engine AND mp.model = COALESCE(json_extract(m.meta,'$.model'), c.llm_model)`
    type Row = UsageTotals & { name: string; model?: string; costIncomplete?: number }
    const complete = (row: Row): UsageTotals => ({ inputTokens: row.inputTokens, outputTokens: row.outputTokens, cacheReadTokens: row.cacheReadTokens, costUsd: row.costUsd, costFromPrices: row.costFromPrices, messages: row.messages, costIncomplete: Boolean(row.costIncomplete) })
    const totals = this.db.prepare(`SELECT c.user_id AS name, ${sums} ${joins} WHERE ${where} GROUP BY c.user_id`).all(bind) as Row[]
    const models = this.db.prepare(`SELECT c.user_id AS name, COALESCE(json_extract(m.meta,'$.model'), c.llm_model, '?') AS model, ${sums} ${joins} WHERE ${where} GROUP BY c.user_id, model ORDER BY outputTokens DESC`).all(bind) as Row[]
    const byName = new Map<string, import('@voicechat/shared').UserUsageSummary>()
    for (const user of this.listUsers()) byName.set(user.name, { name: user.name, totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, costFromPrices: 0, messages: 0, costIncomplete: false }, byModel: [] })
    for (const row of totals) byName.get(row.name)!.totals = complete(row)
    for (const row of models) byName.get(row.name)?.byModel.push({ model: row.model ?? '?', ...complete(row) })
    return [...byName.values()]
  }

  // ---- helpers ----------------------------------------------------------

  private mapConversation(row: ConversationRow, messageCount: number): Conversation {
    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount,
      claudeSessionId: row.claude_session_id,
      execTarget: row.exec_target,
      workdir: row.workdir,
      skillNames: (() => {
        try {
          const value = JSON.parse(row.skill_names ?? '[]') as unknown
          return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
        } catch {
          return []
        }
      })(),
      llmEngineId: row.llm_engine_id ?? null,
      llmProvider: row.llm_provider === 'claude' || row.llm_provider === 'codex' ? row.llm_provider : null,
      llmModel: row.llm_model,
      // Мусор в колонке (например, откат версии) читаем как «из общих настроек».
      permissionMode:
        row.permission_mode === 'plan' || row.permission_mode === 'acceptEdits' || row.permission_mode === 'bypassPermissions'
          ? row.permission_mode
          : null,
      kbContextMode: row.kb_context_mode === 'manual' || row.kb_context_mode === 'off' ? row.kb_context_mode : 'auto',
      projectId: row.project_id ?? null,
      assistantKind: row.assistant_kind === 'kanban' || row.assistant_kind === 'web-recorder' || row.assistant_kind === 'playwright-reader' ? row.assistant_kind : null,
      previewUrl: row.preview_url ?? null,
      projectPreviewUrl: row.project_id ? ((this.db.prepare(`SELECT preview_url FROM projects WHERE id = ?`).get(row.project_id) as { preview_url: string | null } | undefined)?.preview_url ?? null) : null,
      taskId: row.task_id ?? null,
      status: normStatus(row.status),
      lastExecTarget: row.last_exec_target ?? null
    }
  }


  // ---- Projects (многопользовательские) ---------------------------------

  private isProjectMember(userId: string, projectId: string): boolean {
    return (
      this.db
        .prepare(`SELECT 1 FROM project_members WHERE project_id = ? AND username = ?`)
        .get(projectId, userId) !== undefined
    )
  }

  /** Назначать задачи можно только незаблокированному участнику проекта. */
  private isActiveProjectMember(userId: string, projectId: string): boolean {
    return (
      this.db
        .prepare(`SELECT 1 FROM project_members pm JOIN users u ON u.name = pm.username WHERE pm.project_id = ? AND pm.username = ? AND u.blocked = 0`)
        .get(projectId, userId) !== undefined
    )
  }

  /** Единый серверный источник проектного права владельца. */
  isProjectOwner(userId: string, projectId: string): boolean {
    return (
      this.db
        .prepare(`SELECT 1 FROM project_members WHERE project_id = ? AND username = ? AND role = 'owner'`)
        .get(projectId, userId) !== undefined
    )
  }

  private touchProject(projectId: string, ts: number = this.now()): void {
    this.db.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`).run(ts, projectId)
  }

  /** Колонка «Готово»: попадание в неё запускает отсчёт скрытия карточки. */
  private isDoneColumn(columnId: string): boolean {
    const r = this.db.prepare(`SELECT semantic_type FROM kanban_columns WHERE id = ?`).get(columnId) as
      | { semantic_type: string }
      | undefined
    return r?.semantic_type === 'done'
  }

  /** Порог проекта «сколько дней держать завершённые на доске» (null — не скрывать). */
  private doneRetentionDays(projectId: string): number | null {
    const r = this.db.prepare(`SELECT done_retention_days AS d FROM projects WHERE id = ?`).get(projectId) as
      | { d: number | null }
      | undefined
    return r?.d ?? null
  }

  private columnInProject(projectId: string, columnId: string): boolean {
    return (
      this.db
        .prepare(`SELECT 1 FROM kanban_columns WHERE id = ? AND project_id = ?`)
        .get(columnId, projectId) !== undefined
    )
  }

  private mapProjectSummary(r: ProjectRow, myRole: string): ProjectSummary {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      gitUrl: r.git_url,
      previewUrl: r.preview_url ?? null,
      technologies: parseStringArray(r.technologies),
      skills: parseStringArray(r.skills),
      defaultSkills: {
        epic: parseStringArray(r.default_skills_epic),
        story: parseStringArray(r.default_skills_story),
        task: parseStringArray(r.default_skills_task)
      },
      createdBy: r.created_by,

      createdAt: r.created_at,
      updatedAt: r.updated_at,
      role: myRole === 'owner' ? 'owner' : 'member',
      commitPolicy: r.commit_policy === 'final_system_commit' || r.commit_policy === 'manual_user_confirmation' ? r.commit_policy : 'agent_commits',
      mergeTransport: r.merge_transport === 'github_pull_request' ? 'github_pull_request' : 'local',
      agentPlanApprovalMode: r.agent_plan_approval_mode === 'automatic' ? 'automatic' : 'manual',
      testCommand: r.test_command || undefined,
      productionDeployCommand: r.production_deploy_command || undefined,
      productionAgentId: r.production_agent_id,
      productionCheckoutPath: r.production_checkout_path || undefined,
      productionHealthCheckCommand: r.production_health_check_command || undefined,
      releaseTimeouts: {...DEFAULT_RELEASE_TIMEOUTS,...parseJsonValue<Partial<ReleaseTimeouts>>(r.release_timeouts_json,{})},
      ciBaseBranch: r.ci_base_branch,
      ciBranchTemplate: r.ci_branch_template,
      ciReuseStrategy: r.ci_reuse_strategy === 'reuse' || r.ci_reuse_strategy === 'clean' ? r.ci_reuse_strategy : 'fail',
      ciExecAuthRef: r.ci_exec_auth_ref,
      ciKbContextMode: normKbContextMode(r.ci_kb_context_mode),
      ciTestFixCycleLimit: Number.isInteger(r.ci_test_fix_cycle_limit) && r.ci_test_fix_cycle_limit >= 0 ? r.ci_test_fix_cycle_limit : 10,
      doneRetentionDays: r.done_retention_days
    }
  }

  /** Создаёт проект: владелец-участник + дефолтные колонки (в одной транзакции). */
  createProject(
    userId: string,
    args: { name: string; description?: string; gitUrl?: string; technologies?: string[]; skills?: string[]; defaultSkills?: Partial<WorkItemDefaultSkills>; commitPolicy?: 'agent_commits' | 'final_system_commit' | 'manual_user_confirmation'; mergeTransport?: 'local' | 'github_pull_request'; agentPlanApprovalMode?: 'manual' | 'automatic' }
  ): ProjectDetail {

    const id = this.newId()
    const ts = this.now()
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO projects (id, name, description, git_url, technologies, skills, created_by, created_at, updated_at, commit_policy, merge_transport, agent_plan_approval_mode, default_skills_epic, default_skills_story, default_skills_task)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          args.name,
          args.description ?? '',
          args.gitUrl ?? null,
          JSON.stringify(args.technologies ?? []),
          JSON.stringify(args.skills ?? []),
          userId,
          ts,
          ts,
          args.commitPolicy ?? 'agent_commits',
          args.mergeTransport ?? 'local',
          args.agentPlanApprovalMode ?? 'manual',
          JSON.stringify(args.defaultSkills?.epic ?? []),
          JSON.stringify(args.defaultSkills?.story ?? []),
          JSON.stringify(args.defaultSkills?.task ?? [])
        )

      this.db
        .prepare(`INSERT INTO project_members (project_id, username, role, added_at) VALUES (?, ?, 'owner', ?)`)
        .run(id, userId, ts)
      ;[
        ['Бэклог', 'backlog'],
        ['Подготовка к разработке', 'preparation'],
        ['Ready for Development', 'ready'],
        ['Development', 'development'],
        ['Component QA', 'component_qa'],
        ['Создание интеграционных автотестов', 'integration_tests'],
        ['Automated QA', 'automated_qa'],
        ['Ручное QA', 'manual_qa'],
        ['Ожидает мержа', 'awaiting_merge'],
        ['Мерж', 'merge'],
        ['Готово', 'done'],
        ['Отменено', 'cancelled'],
        ['Требуется решение', 'decision_required']
      ].forEach(([name, semantic], i) =>
        this.db.prepare(`INSERT INTO kanban_columns (id, project_id, name, semantic_type, position, hidden, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`).run(this.newId(), id, name, semantic, (i + 1) * RANK_STEP, ts)
      )
      // Скелет раздела «Разработка проекта»: обзорная статья-заготовка. Без неё
      // раздел пустой, и «Исследовать проект» нечего сверять с кодом.
      this.db
        .prepare(
          `INSERT INTO kb_documents (id, scope, owner_id, project_id, title, kind, tags, areas, body, checked_on, created_by, created_at, updated_at)
           VALUES (?, 'project', NULL, ?, ?, 'subsystem', '[\"обзор\"]', '[]', ?, NULL, ?, ?, ?)`
        )
        .run(this.newId(), id, `Разработка: ${args.name}`, projectKbSkeleton(args.name, args.description ?? ''), userId, ts, ts)
    })()
    return this.getProject(userId, id) as ProjectDetail
  }

  listProjects(userId: string): ProjectSummary[] {
    const rows = this.db
      .prepare(
        `SELECT p.*, m.role AS my_role FROM projects p
         JOIN project_members m ON m.project_id = p.id
         WHERE m.username = ? ORDER BY p.updated_at DESC`
      )
      .all(userId) as Array<ProjectRow & { my_role: string }>
    return rows.map((r) => this.mapProjectSummary(r, r.my_role))
  }

  getProject(userId: string, id: string): ProjectDetail | null {
    const row = this.db
      .prepare(
        `SELECT p.*, m.role AS my_role FROM projects p
         JOIN project_members m ON m.project_id = p.id
         WHERE p.id = ? AND m.username = ?`
      )
      .get(id, userId) as (ProjectRow & { my_role: string }) | undefined
    if (!row) return null
    const members = (
      this.db
        .prepare(`SELECT pm.username, pm.role, pm.added_at, u.blocked FROM project_members pm JOIN users u ON u.name = pm.username WHERE pm.project_id = ? ORDER BY pm.added_at ASC`)
        .all(id) as Array<ProjectMemberRow & { blocked: number }>
    ).map(
      (m): ProjectMember => ({
        username: m.username,
        role: m.role === 'owner' ? 'owner' : 'member',
        addedAt: m.added_at,
        active: m.blocked === 0
      })
    )
    const machines = (
      this.db.prepare(
        `SELECT a.id AS agent_id,
                COALESCE(pm.path,'') AS path,
                COALESCE(pm.repos_root,'') AS repos_root,
                COALESCE(pm.ssh_host,'') AS ssh_host,
                COALESCE(pm.ssh_user,'') AS ssh_user,
                COALESCE(pm.added_at, share.created_at, a.created_at) AS added_at,
                a.name, a.user_id,
                CASE WHEN share.shared = 1 THEN 1 ELSE 0 END AS shared
         FROM agents a
         LEFT JOIN project_machines pm ON pm.agent_id=a.id AND pm.project_id=?
         LEFT JOIN machine_project_shares share ON share.agent_id=a.id AND share.project_id=?
         WHERE a.user_id=? OR (share.shared=1 AND a.user_id<>?)
         ORDER BY CASE WHEN a.user_id=? THEN 0 ELSE 1 END, a.name ASC`
      ).all(id, id, userId, userId, userId) as Array<{
        agent_id: string
        path: string | null
        repos_root: string | null
        ssh_host: string | null
        ssh_user: string | null
        added_at: number
        name: string
        user_id: string
        shared: number
      }>
    ).map((x) => ({
      agentId: x.agent_id,
      name: x.name,
      owner: x.user_id,
      ownership: x.user_id === userId ? 'mine' as const : 'other' as const,
      sharedWithProject: !!x.shared,
      isMyDefault: this.getUserProjectDefaultMachine(userId, id) === x.agent_id,
      canUse: x.user_id === userId || !!x.shared,
      unavailableReason: null,
      load: this.countActiveCiRunsByAgent()[x.agent_id] ?? 0,
      online: false,
      addedAt: x.added_at,
      path: x.path ?? '',
      reposRoot: x.repos_root ?? '',
      sshHost: x.ssh_host ?? '',
      sshUser: x.ssh_user ?? ''
    }))
    return {
      ...this.mapProjectSummary(row, row.my_role),
      members,
      machines,
      defaultAgentId: row.default_agent_id ?? null
    }
  }

  /**
   * Машины проекта с именами — для MCP-моста remote. Пользователь не проверяется
   * намеренно: параметры query моста собирает сам сервер при отправке хода, а
   * доступ к эндпоинту закрыт секретом процесса.
   */
  listProjectMachines(projectId: string): Array<{ agentId: string; name: string; path: string }> {
    return (
      this.db
        .prepare(
          `SELECT pm.agent_id, pm.path, a.name FROM project_machines pm
           JOIN agents a ON a.id = pm.agent_id
           WHERE pm.project_id = ? ORDER BY a.name ASC`
        )
        .all(projectId) as Array<{ agent_id: string; path: string | null; name: string }>
    ).map((x) => ({ agentId: x.agent_id, name: x.name, path: x.path ?? '' }))
  }

  updateProject(
    userId: string,
    id: string,
    fields: {
      name?: string
      description?: string
      gitUrl?: string | null
      previewUrl?: string | null
      technologies?: string[]
      skills?: string[]
      defaultSkills?: Partial<WorkItemDefaultSkills>
      commitPolicy?: 'agent_commits' | 'final_system_commit' | 'manual_user_confirmation'
      mergeTransport?: 'local' | 'github_pull_request'
      agentPlanApprovalMode?: 'manual' | 'automatic'
      testCommand?: string
      productionDeployCommand?: string
      productionAgentId?: string | null
      productionCheckoutPath?: string
      productionHealthCheckCommand?: string
      releaseTimeouts?: ReleaseTimeouts
      ciBaseBranch?: string
      ciBranchTemplate?: string
      ciReuseStrategy?: 'reuse' | 'clean' | 'fail'
      ciExecAuthRef?: string
      ciKbContextMode?: KbContextMode
      ciTestFixCycleLimit?: number
      doneRetentionDays?: number | null
    }
  ): ProjectDetail | null {

    if (!this.isProjectOwner(userId, id)) return null
    const set: string[] = []
    const vals: unknown[] = []
    if (fields.name !== undefined) {
      set.push('name = ?')
      vals.push(fields.name)
    }
    if (fields.description !== undefined) {
      set.push('description = ?')
      vals.push(fields.description)
    }
    if (fields.gitUrl !== undefined) {
      set.push('git_url = ?')
      vals.push(fields.gitUrl)
    }
    if (fields.previewUrl !== undefined) {
      set.push('preview_url = ?')
      vals.push(fields.previewUrl)
    }
    if (fields.technologies !== undefined) {
      set.push('technologies = ?')
      vals.push(JSON.stringify(fields.technologies))
    }
    if (fields.skills !== undefined) {
      set.push('skills = ?')
      vals.push(JSON.stringify(fields.skills))
    }
    if (fields.commitPolicy !== undefined) {
      set.push('commit_policy = ?')
      vals.push(fields.commitPolicy)
    }
    if (fields.mergeTransport !== undefined) {
      set.push('merge_transport = ?')
      vals.push(fields.mergeTransport)
    }
    if (fields.agentPlanApprovalMode !== undefined) {
      set.push('agent_plan_approval_mode = ?')
      vals.push(fields.agentPlanApprovalMode)
    }
    if (fields.testCommand !== undefined) { set.push('test_command = ?'); vals.push(fields.testCommand) }
    if (fields.productionDeployCommand !== undefined) { set.push('production_deploy_command = ?'); vals.push(fields.productionDeployCommand) }
    if (fields.productionAgentId !== undefined) { set.push('production_agent_id = ?'); vals.push(fields.productionAgentId) }
    if (fields.productionCheckoutPath !== undefined) { set.push('production_checkout_path = ?'); vals.push(fields.productionCheckoutPath) }
    if (fields.productionHealthCheckCommand !== undefined) { set.push('production_health_check_command = ?'); vals.push(fields.productionHealthCheckCommand) }
    if (fields.releaseTimeouts !== undefined) { set.push('release_timeouts_json = ?'); vals.push(JSON.stringify(validateReleaseTimeouts(fields.releaseTimeouts))) }
    if (fields.ciBaseBranch !== undefined) { set.push('ci_base_branch = ?'); vals.push(fields.ciBaseBranch) }
    if (fields.ciBranchTemplate !== undefined) { set.push('ci_branch_template = ?'); vals.push(fields.ciBranchTemplate) }
    if (fields.ciReuseStrategy !== undefined) { set.push('ci_reuse_strategy = ?'); vals.push(fields.ciReuseStrategy) }
    if (fields.ciExecAuthRef !== undefined) { set.push('ci_exec_auth_ref = ?'); vals.push(fields.ciExecAuthRef) }
    if (fields.ciKbContextMode !== undefined) { set.push('ci_kb_context_mode = ?'); vals.push(normKbContextMode(fields.ciKbContextMode)) }
    if (fields.ciTestFixCycleLimit !== undefined) {
      if (!Number.isInteger(fields.ciTestFixCycleLimit) || fields.ciTestFixCycleLimit < 0) throw new Error('ciTestFixCycleLimit must be a non-negative integer')
      set.push('ci_test_fix_cycle_limit = ?'); vals.push(fields.ciTestFixCycleLimit)
    }
    if (fields.doneRetentionDays !== undefined) { set.push('done_retention_days = ?'); vals.push(fields.doneRetentionDays) }
    if (fields.defaultSkills?.epic !== undefined) { set.push('default_skills_epic = ?'); vals.push(JSON.stringify(fields.defaultSkills.epic)) }
    if (fields.defaultSkills?.story !== undefined) { set.push('default_skills_story = ?'); vals.push(JSON.stringify(fields.defaultSkills.story)) }
    if (fields.defaultSkills?.task !== undefined) { set.push('default_skills_task = ?'); vals.push(JSON.stringify(fields.defaultSkills.task)) }

    const ts = this.now()
    set.push('updated_at = ?')
    vals.push(ts)
    this.db.prepare(`UPDATE projects SET ${set.join(', ')} WHERE id = ?`).run(...vals, id)
    return this.getProject(userId, id)
  }

  deleteProject(userId: string, id: string): boolean {
    if (!this.isProjectOwner(userId, id)) return false
    // CASCADE удалит members/machines/columns/tasks.
    this.db.prepare(`DELETE FROM projects WHERE id = ?`).run(id)
    return true
  }

  private auditProjectMemberRole(
    projectId: string,
    actor: string,
    targetUser: string,
    oldRole: 'owner' | 'member' | null,
    newRole: 'owner' | 'member' | null,
    action: 'add' | 'role_change' | 'remove',
    createdAt: number
  ): void {
    this.db.prepare(
      `INSERT INTO project_member_role_audit
       (id, project_id, target_user, actor, old_role, new_role, action, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(this.newId(), projectId, targetUser, actor, oldRole, newRole, action, createdAt)
  }

  addMember(userId: string, id: string, username: string): ProjectDetail | null {
    if (!this.isProjectOwner(userId, id)) return null
    if (!this.db.prepare(`SELECT 1 FROM users WHERE name = ?`).get(username)) {
      throw new Error(`Пользователь ${username} не найден`)
    }
    const ts = this.now()
    const inserted = this.db
      .prepare(`INSERT OR IGNORE INTO project_members (project_id, username, role, added_at) VALUES (?, ?, 'member', ?)`)
      .run(id, username, ts)
    if (inserted.changes) this.auditProjectMemberRole(id, userId, username, null, 'member', 'add', ts)
    return this.getProject(userId, id)
  }

  updateMemberRole(
    userId: string,
    id: string,
    username: string,
    role: 'owner' | 'member'
  ): ProjectDetail | null {
    if (!this.isProjectOwner(userId, id)) return null
    const change = this.db.transaction(() => {
      const row = this.db
        .prepare(`SELECT role FROM project_members WHERE project_id = ? AND username = ?`)
        .get(id, username) as { role: string } | undefined
      if (!row) throw new Error('Сначала добавьте пользователя в участники проекта')
      const oldRole = row.role === 'owner' ? 'owner' : 'member'
      if (oldRole === role) return
      if (oldRole === 'owner') {
        const owners = this.db
          .prepare(`SELECT COUNT(*) AS count FROM project_members WHERE project_id = ? AND role = 'owner'`)
          .get(id) as { count: number }
        if (owners.count <= 1) {
          throw new Error('Нельзя понизить последнего владельца. Сначала назначьте другого владельца')
        }
      }
      const ts = this.now()
      this.db.prepare(`UPDATE project_members SET role = ? WHERE project_id = ? AND username = ?`).run(role, id, username)
      this.auditProjectMemberRole(id, userId, username, oldRole, role, 'role_change', ts)
      this.touchProject(id, ts)
    })
    // IMMEDIATE получает write-lock до проверки количества владельцев: два
    // параллельных понижения не могут оба увидеть устаревший count.
    change.immediate()
    return this.getProject(userId, id)
  }

  removeMember(userId: string, id: string, username: string): ProjectDetail | null {
    if (!this.isProjectOwner(userId, id)) return null
    const remove = this.db.transaction(() => {
      const row = this.db
        .prepare(`SELECT role FROM project_members WHERE project_id = ? AND username = ?`)
        .get(id, username) as { role: string } | undefined
      if (!row) return
      const oldRole = row.role === 'owner' ? 'owner' : 'member'
      if (oldRole === 'owner') {
        const owners = this.db
          .prepare(`SELECT COUNT(*) AS count FROM project_members WHERE project_id = ? AND role = 'owner'`)
          .get(id) as { count: number }
        if (owners.count <= 1) {
          throw new Error('Нельзя удалить или вывести последнего владельца. Сначала назначьте другого владельца')
        }
      }
      const ts = this.now()
      this.db.prepare(`DELETE FROM project_members WHERE project_id = ? AND username = ?`).run(id, username)
      this.db
        .prepare(`UPDATE tasks SET assignee = NULL, updated_at = ? WHERE project_id = ? AND assignee = ?`)
        .run(ts, id, username)
      this.auditProjectMemberRole(id, userId, username, oldRole, null, 'remove', ts)
      this.touchProject(id, ts)
    })
    remove.immediate()
    return this.getProject(userId, id)
  }

  listProjectMemberRoleAudit(projectId: string): Array<{
    targetUser: string
    actor: string
    oldRole: 'owner' | 'member' | null
    newRole: 'owner' | 'member' | null
    action: 'add' | 'role_change' | 'remove'
    createdAt: number
  }> {
    return (this.db.prepare(
      `SELECT target_user, actor, old_role, new_role, action, created_at
       FROM project_member_role_audit WHERE project_id = ? ORDER BY created_at, rowid`
    ).all(projectId) as Array<Record<string, unknown>>).map((row) => ({
      targetUser: String(row.target_user),
      actor: String(row.actor),
      oldRole: row.old_role === 'owner' ? 'owner' : row.old_role === 'member' ? 'member' : null,
      newRole: row.new_role === 'owner' ? 'owner' : row.new_role === 'member' ? 'member' : null,
      action: row.action as 'add' | 'role_change' | 'remove',
      createdAt: Number(row.created_at)
    }))
  }

  linkMachine(userId: string, id: string, agentId: string): ProjectDetail | null {
    if (!this.isProjectMember(userId, id)) return null
    if (!this.db.prepare(`SELECT 1 FROM agents WHERE id = ? AND user_id = ?`).get(agentId, userId)) {
      throw new Error(`Машина ${agentId} не найдена`)
    }
    this.db.prepare(
      `INSERT OR IGNORE INTO project_machines (project_id,agent_id,path,added_at,added_by) VALUES (?,?,'',?,?)`
    ).run(id, agentId, this.now(), userId)
    this.setMachineSharedWithProject(userId, id, agentId, true)
    return this.getProject(userId, id)
  }

  unlinkMachine(userId: string, id: string, agentId: string): ProjectDetail | null {
    if (!this.isProjectMember(userId, id)) return null
    this.setMachineSharedWithProject(userId, id, agentId, false)
    this.db.prepare(`UPDATE projects SET default_agent_id=NULL WHERE id=? AND default_agent_id=?`).run(id, agentId)
    return this.getProject(userId, id)
  }

  /** Задать папку проекта на конкретной машине (только владелец). */
  setProjectMachinePath(userId: string, id: string, agentId: string, path: string): ProjectDetail | null {
    if (!this.isProjectMember(userId, id)) return null
    if (!this.db.prepare(`SELECT 1 FROM agents WHERE id=? AND user_id=?`).get(agentId, userId)) return null
    this.db.prepare(
      `INSERT OR IGNORE INTO project_machines (project_id,agent_id,path,added_at,added_by) VALUES (?,?,'',?,?)`
    ).run(id, agentId, this.now(), userId)
    this.db
      .prepare(`UPDATE project_machines SET path = ? WHERE project_id = ? AND agent_id = ?`)
      .run(path, id, agentId)
    this.touchProject(id)
    return this.getProject(userId, id)
  }

  /** Корень пула рабочих копий CI на этой машине. */
  setProjectMachineReposRoot(userId: string, id: string, agentId: string, root: string): ProjectDetail | null {
    if (!this.isProjectMember(userId, id)) return null
    if (!this.db.prepare(`SELECT 1 FROM agents WHERE id=? AND user_id=?`).get(agentId, userId)) return null
    this.db.prepare(
      `INSERT OR IGNORE INTO project_machines (project_id,agent_id,path,added_at,added_by) VALUES (?,?,'',?,?)`
    ).run(id, agentId, this.now(), userId)
    this.db.prepare(`UPDATE project_machines SET repos_root = ? WHERE project_id = ? AND agent_id = ?`).run(root, id, agentId)
    return this.getProject(userId, id)
  }

  /** Явные SSH-настройки машины для ручного preview-туннеля. */
  setProjectMachineSsh(userId: string, id: string, agentId: string, sshHost: string, sshUser: string): ProjectDetail | null {
    if (!this.isProjectMember(userId, id)) return null
    if (!this.db.prepare(`SELECT 1 FROM agents WHERE id=? AND user_id=?`).get(agentId, userId)) return null
    this.db.prepare(
      `INSERT OR IGNORE INTO project_machines (project_id,agent_id,path,added_at,added_by) VALUES (?,?,'',?,?)`
    ).run(id, agentId, this.now(), userId)
    this.db.prepare(`UPDATE project_machines SET ssh_host = ?, ssh_user = ? WHERE project_id = ? AND agent_id = ?`)
      .run(sshHost.trim(), sshUser.trim(), id, agentId)
    return this.getProject(userId, id)
  }

  /** Назначить машину проекта по умолчанию (только владелец; машина должна быть в проекте). */
  setProjectDefaultMachine(userId: string, id: string, agentId: string): ProjectDetail | null {
    if (!this.isProjectOwner(userId, id)) return null
    const inProject = this.db
      .prepare(`SELECT 1 FROM project_machines WHERE project_id = ? AND agent_id = ?`)
      .get(id, agentId)
    if (!inProject) throw new Error('Машина не привязана к проекту')
    this.db.prepare(`UPDATE projects SET default_agent_id = ? WHERE id = ?`).run(agentId, id)
    this.touchProject(id)
    return this.getProject(userId, id)
  }

  /**
   * Привязать чат к проекту (или отвязать при projectId=null). При привязке
   * машина остаётся null: это динамическое наследование персонального default
   * текущего пользователя. Навыки наследуются от проекта. Гейт — членство.
   */
  setConversationProject(userId: string, convId: string, projectId: string | null): Conversation | null {
    const current = this.getConversation(userId, convId)
    if (!current) return null
    // Playwright Reader is a non-project product mode by contract.
    if (current.assistantKind === 'playwright-reader' && projectId !== null) return null
    if (projectId === null) {
      this.db.prepare(`UPDATE conversations SET project_id = NULL WHERE id = ? AND user_id = ?`).run(convId, userId)
      return this.getConversation(userId, convId)
    }
    const project = this.getProject(userId, projectId)
    if (!project) return null // не участник / проект не найден
    this.db
      .prepare(
        `UPDATE conversations SET project_id = ?, exec_target = NULL, workdir = NULL, skill_names = ?, llm_engine_id = NULL, llm_provider = NULL, llm_model = NULL WHERE id = ? AND user_id = ?`
      )
      .run(projectId, JSON.stringify(project.skills), convId, userId)
    return this.getConversation(userId, convId)
  }

  /**
   * Открыть связанный с задачей чат текущего пользователя, создав его при
   * отсутствии. Новый чат привязывается к задаче (`task_id`) и её проекту:
   * машина/папка остаются null (персональное наследование), навыки — навыки самой карточки (`Task.skills`).
   * Идемпотентно по (userId, taskId): одна задача — не более одного чата на юзера.
   * Имя по умолчанию — «Задача <заголовок>»: в общем списке чатов такой чат сразу
   * отличим от обычного разговора. Дальше его можно переименовать вручную.
   */
  openOrCreateTaskChat(userId: string, projectId: string, taskId: string): Conversation | null {
    if (!this.isProjectMember(userId, projectId)) return null
    const task = this.getTask(projectId, taskId)
    if (!task) return null
    // Связанный чат хранит только собственное переопределение; null означает
    // динамическое наследование эффективной настройки проекта.
    const existing = this.db
      .prepare(`SELECT id FROM conversations WHERE task_id = ? AND user_id = ? ORDER BY created_at ASC LIMIT 1`)
      .get(taskId, userId) as { id: string } | undefined
    if (existing) {
      this.db
        .prepare(`UPDATE conversations SET updated_at = ? WHERE id = ? AND user_id = ?`)
        .run(this.now(), existing.id, userId)
      return this.getConversation(userId, existing.id)
    }
    const id = this.newId()
    const ts = this.now()
    const title = task.title.trim() ? `Задача ${task.title.trim()}` : 'Задача'
    this.db
      .prepare(
        `INSERT INTO conversations (id, title, created_at, updated_at, claude_session_id, user_id, exec_target, workdir, skill_names, llm_engine_id, llm_provider, llm_model, project_id, task_id)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, title, ts, ts, userId, null, null, JSON.stringify(task.skills), null, null, null, projectId, taskId)
    return this.getConversation(userId, id)
  }

  // ---- Board (колонки + задачи) -----------------------------------------


  /**
   * Снапшот доски. По умолчанию задачи, завершённые дольше порога проекта
   * (`doneRetentionDays`), с доски убраны — как в Jira. Из БД они не удаляются:
   * приходят с `includeCompleted` и открываются по прямой ссылке.
   */
  getBoard(userId: string, projectId: string, opts?: { includeCompleted?: boolean }): Board | null {
    if (!this.isProjectMember(userId, projectId)) return null
    const columns = (
      this.db
        .prepare(`SELECT * FROM kanban_columns WHERE project_id = ? ORDER BY position ASC, created_at ASC`)
        .all(projectId) as ColumnRow[]
    ).map(mapColumn)
    const tasks = (
      this.db
        .prepare(
          `SELECT t.*, (SELECT c.id FROM conversations c WHERE c.task_id = t.id AND c.user_id = ?
                        ORDER BY c.created_at ASC LIMIT 1) AS chat_id,
             (SELECT w.branch FROM ci_workspaces w WHERE w.task_id=t.id AND w.pushed=1 ORDER BY w.created_at DESC LIMIT 1) AS merge_source_branch,
             (SELECT w.commit_sha FROM ci_workspaces w WHERE w.task_id=t.id AND w.pushed=1 ORDER BY w.created_at DESC LIMIT 1) AS merge_source_sha,
             (SELECT r.id FROM merge_runs r WHERE r.task_id=t.id AND r.status IN ('queued','checking','fetching','merging','resolving_conflicts','kb_update','testing','pushing') ORDER BY r.created_at DESC LIMIT 1) AS active_merge_run_id,
             (SELECT r.id FROM merge_runs r WHERE r.task_id=t.id ORDER BY r.created_at DESC LIMIT 1) AS latest_merge_run_id,
             (SELECT r.status FROM merge_runs r WHERE r.task_id=t.id AND r.status IN ('queued','checking','fetching','merging','resolving_conflicts','kb_update','testing','pushing') ORDER BY r.created_at DESC LIMIT 1) AS active_merge_status,
             EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=t.project_id AND pm.username=? AND pm.role='owner') AS merge_permitted,
             EXISTS(
               SELECT 1 FROM ci_workspaces w JOIN agents a ON a.id=w.agent_id
               WHERE w.id=(SELECT latest.id FROM ci_workspaces latest WHERE latest.task_id=t.id AND latest.pushed=1 ORDER BY latest.created_at DESC LIMIT 1)
                 AND (a.user_id=? OR EXISTS(SELECT 1 FROM project_machines pm WHERE pm.project_id=t.project_id AND pm.agent_id=a.id))
             ) AS merge_machine_bound,
             (SELECT r.merge_sha FROM merge_runs r WHERE r.task_id=t.id AND r.status='success' ORDER BY r.created_at DESC LIMIT 1) AS merged_sha,
             (SELECT r.source_sha FROM merge_runs r WHERE r.task_id=t.id AND r.status='success' ORDER BY r.created_at DESC LIMIT 1) AS merged_source_sha,
             (SELECT p.id FROM task_preparation_runs p WHERE p.task_id=t.id ORDER BY p.created_at DESC LIMIT 1) AS task_preparation_run_id,
             (SELECT p.status FROM task_preparation_runs p WHERE p.task_id=t.id ORDER BY p.created_at DESC LIMIT 1) AS task_preparation_status,
             (SELECT p.error FROM task_preparation_runs p WHERE p.task_id=t.id ORDER BY p.created_at DESC LIMIT 1) AS task_preparation_error,
             (SELECT p.log FROM task_preparation_runs p WHERE p.task_id=t.id ORDER BY p.created_at DESC LIMIT 1) AS task_preparation_log
           FROM tasks t WHERE t.project_id = ? ORDER BY t.column_id ASC, t.position ASC`
        )
        .all(userId, userId, userId, projectId) as TaskRow[]
    ).map((row) => ({ ...mapTask(row), latestRunResult: this.latestTaskRunResult(row.id) }))
    // Фильтруем на сервере: иначе payload доски рос бы бесконечно вместе с
    // колонкой «Готово». includeCompleted → порог null, скрывать нечего.
    const retention = opts?.includeCompleted ? null : this.doneRetentionDays(projectId)
    const now = this.now()
    const visible = tasks.filter((t) => !isCompletedHidden(t.doneAt, retention, now))
    const semanticByColumnId = new Map(columns.map((column) => [column.id, column.semanticType]))
    visible.sort((a, b) => {
      if (a.columnId !== b.columnId) return a.columnId.localeCompare(b.columnId)
      return compareTasksInColumn(a, b, semanticByColumnId.get(a.columnId) ?? 'custom')
    })

    return { columns, tasks: visible, ciRuns: this.latestCiRunSummaries(projectId) }
  }

  /**
   * Контекст задачи для шапки связанного чата: иерархия Эпик→Стори→Задача,
   * этап воркфлоу (колонка), машина и папка разработки, последний CI-ран.
   * `null`, если чат не привязан к задаче.
   */
  getTaskChatContext(userId: string, conversationId: string, isOnline?: (agentId: string) => boolean): TaskChatContext | null {
    const conv = this.getConversation(userId, conversationId)
    if (!conv?.taskId || !conv.projectId) return null
    const project = this.getProject(userId, conv.projectId)
    if (!project) return null
    const task = this.getTask(conv.projectId, conv.taskId)
    if (!task) return null

    const crumb = (t: Task): TaskChatCrumb => ({ id: t.id, title: t.title, key: issueKey(project.name, t) })
    const parent = task.parentId ? this.getTask(conv.projectId, task.parentId) : null
    const grandParent = parent?.parentId ? this.getTask(conv.projectId, parent.parentId) : null
    // Родитель задачи — стори или сразу эпик; у стори родитель всегда эпик.
    const story = parent?.type === 'story' ? parent : null
    const epic = parent?.type === 'epic' ? parent : grandParent?.type === 'epic' ? grandParent : null

    const column = this.db.prepare(`SELECT name, semantic_type FROM kanban_columns WHERE id = ?`).get(task.columnId) as
      | { name: string; semantic_type: string | null }
      | undefined
    const resolution = this.resolveConversationMachine(userId, conversationId, { isOnline })
    const agentId = resolution?.error ? null : resolution?.agentId ?? null
    const machine = agentId ? project.machines.find((m) => m.agentId === agentId) : undefined
    const displaySummary = this.latestCiRunSummary(task.id)
    const runRow = displaySummary ? this.db.prepare(`SELECT * FROM ci_runs WHERE id = ?`).get(displaySummary.id) as CiRunRow | undefined : undefined
    const run = runRow ? mapCiRun(runRow) : null

    return {
      conversationId: conv.id,
      projectId: project.id,
      projectName: project.name,
      epic: epic ? crumb(epic) : null,
      story: story ? crumb(story) : null,
      task: { ...crumb(task), type: task.type },
      columnName: column?.name ?? '',
      columnSemantic: (column?.semantic_type as TaskChatContext['columnSemantic']) ?? null,
      agentId: agentId ?? null,
      agentName: agentId ? this.agentName(agentId) : null,
      // Папка чата приоритетнее: пользователь мог сменить её вручную.
      workdir: conv.workdir || machine?.path || null,
      run: run ? { id: run.id, status: run.status, mode: run.mode, startedAt: run.startedAt, durationMs: run.durationMs } : null
    }
  }

  /**
   * Метки всех чатов пользователя, привязанных к задачам: ключ, тип и последний
   * ран задачи. Список бесед подсвечивается тем же состоянием, что карточка на
   * доске, но доску при этом не открывают — поэтому сводки нужны сразу, одним
   * запросом на весь список, а не по чату.
   */
  taskChatBadges(userId: string): TaskChatBadge[] {
    const rows = this.db
      .prepare(
        `SELECT c.id AS conversation_id, t.id AS task_id, t.project_id, t.seq, t.type,
                p.name AS project_name, kc.semantic_type AS column_semantic
         FROM conversations c
         JOIN tasks t ON t.id = c.task_id
         JOIN projects p ON p.id = t.project_id
         JOIN kanban_columns kc ON kc.id = t.column_id
         WHERE c.user_id = ? AND c.task_id IS NOT NULL`
      )
      .all(userId) as Array<{ conversation_id: string; task_id: string; project_id: string; seq: number; type: string; project_name: string; column_semantic: string | null }>
    return rows.map((r) => ({
      conversationId: r.conversation_id,
      projectId: r.project_id,
      taskId: r.task_id,
      key: issueKey(r.project_name, { seq: r.seq }),
      type: normWorkItemType(r.type),
      columnSemantic: (r.column_semantic as TaskChatBadge['columnSemantic']) ?? null,
      run: this.latestCiRunSummary(r.task_id)
    }))
  }

  /** Имя машины по id (для читаемой подписи в шапке чата). */
  agentName(agentId: string): string | null {
    const r = this.db.prepare(`SELECT name FROM agents WHERE id = ?`).get(agentId) as { name: string } | undefined
    return r?.name ?? null
  }

  private getTask(projectId: string, taskId: string): Task | null {
    const r = this.db.prepare(`SELECT * FROM tasks WHERE id = ? AND project_id = ?`).get(taskId, projectId) as
      | TaskRow
      | undefined
    return r ? mapTask(r) : null
  }

  createColumn(userId: string, projectId: string, name: string): KanbanColumn | null {
    if (!this.isProjectMember(userId, projectId)) return null
    const id = this.newId()
    const ts = this.now()
    const max = (
      this.db.prepare(`SELECT MAX(position) AS m FROM kanban_columns WHERE project_id = ?`).get(projectId) as {
        m: number | null
      }
    ).m
    const position = (max ?? 0) + RANK_STEP
    this.db
      .prepare(
        `INSERT INTO kanban_columns (id, project_id, name, position, hidden, created_at) VALUES (?, ?, ?, ?, 0, ?)`
      )
      .run(id, projectId, name, position, ts)
    this.touchProject(projectId, ts)
    return mapColumn({ id, project_id: projectId, name, semantic_type: 'custom', position, hidden: 0, wip_limit: null, created_at: ts })
  }

  renameColumn(userId: string, projectId: string, columnId: string, name: string): boolean {
    return this.updateColumn(userId, projectId, columnId, { name })
  }

  updateColumn(userId: string, projectId: string, columnId: string, fields: { name?: string; wipLimit?: number | null }): boolean {
    if (!this.isProjectMember(userId, projectId) || !this.columnInProject(projectId, columnId)) return false
    const set: string[] = []
    const vals: unknown[] = []
    if (fields.name !== undefined) {
      set.push('name = ?')
      vals.push(fields.name)
    }
    if (fields.wipLimit !== undefined) {
      set.push('wip_limit = ?')
      vals.push(fields.wipLimit != null && fields.wipLimit > 0 ? Math.floor(fields.wipLimit) : null)
    }
    if (!set.length) return true
    this.db.prepare(`UPDATE kanban_columns SET ${set.join(', ')} WHERE id = ? AND project_id = ?`).run(...vals, columnId, projectId)
    this.touchProject(projectId)
    return true
  }

  setColumnHidden(userId: string, projectId: string, columnId: string, hidden: boolean): boolean {
    if (!this.isProjectMember(userId, projectId) || !this.columnInProject(projectId, columnId)) return false
    this.db
      .prepare(`UPDATE kanban_columns SET hidden = ? WHERE id = ? AND project_id = ?`)
      .run(hidden ? 1 : 0, columnId, projectId)
    this.touchProject(projectId)
    return true
  }

  reorderColumns(userId: string, projectId: string, order: string[]): boolean {
    if (!this.isProjectMember(userId, projectId)) return false
    const ids = (
      this.db.prepare(`SELECT id FROM kanban_columns WHERE project_id = ?`).all(projectId) as Array<{ id: string }>
    ).map((x) => x.id)
    const known = new Set(ids)
    if (order.length !== ids.length || !order.every((o) => known.has(o))) return false
    const upd = this.db.prepare(`UPDATE kanban_columns SET position = ? WHERE id = ? AND project_id = ?`)
    this.db.transaction(() => {
      order.forEach((cid, i) => upd.run((i + 1) * RANK_STEP, cid, projectId))
    })()
    this.touchProject(projectId)
    return true
  }

  deleteColumn(userId: string, projectId: string, columnId: string): boolean {
    if (!this.isProjectMember(userId, projectId)) return false
    const semantic = this.db.prepare(`SELECT semantic_type FROM kanban_columns WHERE id = ? AND project_id = ?`).get(columnId, projectId) as { semantic_type: string } | undefined
    if (!semantic || semantic.semantic_type !== 'custom') return false
    // CASCADE удалит задачи пользовательской колонки.
    const info = this.db.prepare(`DELETE FROM kanban_columns WHERE id = ? AND project_id = ?`).run(columnId, projectId)
    if (info.changes) this.touchProject(projectId)
    return info.changes > 0
  }

  /** Навыки по умолчанию проекта для типа элемента (из настроек проекта). */
  private projectDefaultSkills(projectId: string, type: WorkItemType): string[] {
    const row = this.db
      .prepare(`SELECT default_skills_epic, default_skills_story, default_skills_task FROM projects WHERE id = ?`)
      .get(projectId) as
      | { default_skills_epic: string; default_skills_story: string; default_skills_task: string }
      | undefined
    if (!row) return []
    const raw = type === 'epic' ? row.default_skills_epic : type === 'story' ? row.default_skills_story : row.default_skills_task
    return parseStringArray(raw)
  }

  /** Машина карточки доступна владельцу лично либо через контекст проекта. */
  private validateTaskAgent(userId: string, projectId: string, agentId: string | null | undefined): string | null {
    if (agentId == null) return null
    if (!this.canUseAgent(userId, agentId, projectId)) throw new Error('Машина недоступна для этой задачи')
    return agentId
  }

  createTask(
    userId: string,
    projectId: string,
    args: {
      columnId: string
      title: string
      description?: string
      acceptanceCriteria?: string
      type?: WorkItemType
      parentId?: string | null
      priority?: TaskPriority
      assignee?: string | null
      agentId?: string | null
      labels?: string[]
      skills?: string[]
      storyPoints?: number | null
      dueDate?: number | null
      source?: string
      idempotencyKey?: string
    }
  ): Task | null {
    if (!this.isProjectMember(userId, projectId)) return null
    const key = args.idempotencyKey?.trim()
    if (key) {
      const prior = this.db.prepare(
        `SELECT task_id FROM task_creation_requests WHERE actor = ? AND idempotency_key = ?`
      ).get(userId, key) as { task_id: string } | undefined
      if (prior) return this.getTask(projectId, prior.task_id)
    }
    if (!this.columnInProject(projectId, args.columnId)) return null

    const explicit = args.assignee !== undefined && args.assignee !== null
    const userCreation = args.source !== undefined
    const createdBy = userCreation ? userId : null
    const assignee = explicit ? args.assignee! : userCreation ? userId : null
    if (assignee !== null && !this.isActiveProjectMember(assignee, projectId)) {
      throw new Error(explicit
        ? 'Исполнитель должен быть активным и незаблокированным участником проекта'
        : 'Создатель не может быть назначен исполнителем в этом проекте')
    }
    const itemType = args.type ?? 'task'
    const skills = args.skills ?? this.projectDefaultSkills(projectId, itemType)
    const parent = args.parentId ? this.getTask(projectId, args.parentId) : null
    if (itemType === 'epic' && args.parentId) throw new Error('Эпик не может иметь родителя')
    if (args.parentId && !parent) throw new Error('Родитель не найден в проекте')
    if (itemType === 'story' && parent?.type !== 'epic') throw new Error('Родителем истории может быть только эпик')
    if (itemType === 'task' && parent && parent.type !== 'story' && parent.type !== 'epic') throw new Error('Недопустимый родитель задачи')

    const id = this.newId()
    const ts = this.now()
    const created = this.db.transaction(() => {
      if (key) {
        const prior = this.db.prepare(
          `SELECT task_id FROM task_creation_requests WHERE actor = ? AND idempotency_key = ?`
        ).get(userId, key) as { task_id: string } | undefined
        if (prior) return prior.task_id
      }
      const max = this.db.prepare(
        `SELECT MAX(position) AS m FROM tasks WHERE project_id = ? AND column_id = ?`
      ).get(projectId, args.columnId) as { m: number | null }
      const seq = (this.db.prepare(
        `UPDATE projects SET task_seq = task_seq + 1 WHERE id = ? RETURNING task_seq`
      ).get(projectId) as { task_seq: number }).task_seq
      this.db.prepare(
        `INSERT INTO tasks (id, project_id, column_id, title, description, acceptance_criteria, type, parent_id, priority, assignee, created_by, created_by_name, agent_id, labels, skills, story_points, due_date, flagged, done_at, seq, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
      ).run(
        id, projectId, args.columnId, args.title, args.description ?? '',
        args.acceptanceCriteria ?? '', itemType, args.parentId ?? null,
        normPriority(args.priority ?? 'medium'), assignee, createdBy, createdBy,
        this.validateTaskAgent(userId, projectId, args.agentId),
        JSON.stringify(args.labels ?? []), JSON.stringify(skills),
        args.storyPoints ?? null, args.dueDate ?? null,
        this.isDoneColumn(args.columnId) ? ts : null, seq, (max.m ?? 0) + RANK_STEP, ts, ts
      )
      this.db.prepare(
        `INSERT INTO task_creation_audit (id, project_id, task_id, created_by, created_by_name, assignee, source, assignment_method, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(this.newId(), projectId, id, createdBy, createdBy, assignee, args.source ?? 'system', userCreation ? (explicit ? 'explicit' : 'automatic') : 'system', ts)
      if (key) this.db.prepare(
        `INSERT INTO task_creation_requests (actor, idempotency_key, task_id) VALUES (?, ?, ?)`
      ).run(userId, key, id)
      this.touchProject(projectId, ts)
      return id
    })()
    return this.getTask(projectId, created)
  }

  updateTask(
    userId: string,
    projectId: string,
    taskId: string,
    fields: { title?: string; description?: string; acceptanceCriteria?: string; type?: WorkItemType; parentId?: string | null; priority?: TaskPriority; assignee?: string | null; agentId?: string | null; labels?: string[]; skills?: string[]; storyPoints?: number | null; dueDate?: number | null; flagged?: boolean }
  ): Task | null {
    if (!this.isProjectMember(userId, projectId)) return null
    const current = this.getTask(projectId, taskId)

    if (!current) return null
    if (fields.assignee != null && !this.isActiveProjectMember(fields.assignee, projectId)) {
      throw new Error('Исполнитель должен быть активным участником проекта')
    }
    if (fields.agentId !== undefined) this.validateTaskAgent(userId, projectId, fields.agentId)
    const nextType = fields.type ?? current.type
    const nextParentId = fields.parentId === undefined ? current.parentId : fields.parentId
    if (nextParentId === taskId) throw new Error('Элемент не может быть своим родителем')
    const nextParent = nextParentId ? this.getTask(projectId, nextParentId) : null
    if (nextType === 'epic' && nextParentId) throw new Error('Эпик не может иметь родителя')
    if (nextParentId && !nextParent) throw new Error('Родитель не найден в проекте')
    if (nextType === 'story' && nextParent?.type !== 'epic') throw new Error('Родителем истории может быть только эпик')
    if (nextType === 'task' && nextParent && nextParent.type !== 'story' && nextParent.type !== 'epic') throw new Error('Недопустимый родитель задачи')
    let ancestor = nextParent
    while (ancestor) {
      if (ancestor.id === taskId) throw new Error('Циклическая иерархия')
      ancestor = ancestor.parentId ? this.getTask(projectId, ancestor.parentId) : null
    }
    const set: string[] = []
    const vals: unknown[] = []
    if (fields.title !== undefined) {
      set.push('title = ?')
      vals.push(fields.title)
    }
    if (fields.description !== undefined) {
      set.push('description = ?')
      vals.push(fields.description)
    }
    if (fields.acceptanceCriteria !== undefined) {
      set.push('acceptance_criteria = ?')
      vals.push(fields.acceptanceCriteria)
    }
    if (fields.type !== undefined) {
      set.push('type = ?')
      vals.push(fields.type)
    }
    if (fields.parentId !== undefined) {
      set.push('parent_id = ?')
      vals.push(fields.parentId)
    }
    if (fields.priority !== undefined) {
      set.push('priority = ?')
      vals.push(normPriority(fields.priority))
    }
    if (fields.assignee !== undefined) {
      set.push('assignee = ?')
      vals.push(fields.assignee)
    }
    if (fields.agentId !== undefined) {
      set.push('agent_id = ?')
      vals.push(fields.agentId)
    }
    if (fields.labels !== undefined) {
      set.push('labels = ?')
      vals.push(JSON.stringify(fields.labels.map((l) => l.trim()).filter(Boolean)))
    }
    if (fields.skills !== undefined) {
      set.push('skills = ?')
      vals.push(JSON.stringify(fields.skills.map((s) => s.trim()).filter(Boolean)))
    }
    if (fields.storyPoints !== undefined) {

      set.push('story_points = ?')
      vals.push(fields.storyPoints != null && fields.storyPoints >= 0 ? fields.storyPoints : null)
    }
    if (fields.dueDate !== undefined) {
      set.push('due_date = ?')
      vals.push(fields.dueDate)
    }
    if (fields.flagged !== undefined) {
      set.push('flagged = ?')
      vals.push(fields.flagged ? 1 : 0)
    }
    if (!set.length) return current
    const ts = this.now()
    set.push('updated_at = ?')
    vals.push(ts)
    this.db.prepare(`UPDATE tasks SET ${set.join(', ')} WHERE id = ? AND project_id = ?`).run(...vals, taskId, projectId)
    this.touchProject(projectId, ts)
    return this.getTask(projectId, taskId)
  }

  private renormalizeColumn(projectId: string, columnId: string): void {
    const rows = this.db
      .prepare(`SELECT id FROM tasks WHERE project_id = ? AND column_id = ? ORDER BY position ASC, id ASC`)
      .all(projectId, columnId) as Array<{ id: string }>
    const upd = this.db.prepare(`UPDATE tasks SET position = ? WHERE id = ?`)
    rows.forEach((r, i) => upd.run((i + 1) * RANK_STEP, r.id))
  }

  /** Переместить задачу в колонку между соседями afterId (выше) и beforeId (ниже). */
  moveTask(
    userId: string,
    projectId: string,
    taskId: string,
    args: { columnId: string; afterId?: string | null; beforeId?: string | null }
  ): Task | null {
    if (!this.isProjectMember(userId, projectId)) return null
    if (!this.getTask(projectId, taskId)) return null
    if (!this.columnInProject(projectId, args.columnId)) return null
    const ts = this.now()
    this.db.transaction(() => {
      const rankOf = (nid: string | null | undefined): number | null => {
        if (!nid) return null
        const r = this.db
          .prepare(`SELECT position FROM tasks WHERE id = ? AND project_id = ? AND column_id = ?`)
          .get(nid, projectId, args.columnId) as { position: number } | undefined
        return r ? r.position : null
      }
      let after = rankOf(args.afterId)
      let before = rankOf(args.beforeId)
      let pos: number
      if (after != null && before != null) {
        if (Math.abs(after - before) < RANK_EPS) {
          this.renormalizeColumn(projectId, args.columnId)
          after = rankOf(args.afterId)
          before = rankOf(args.beforeId)
        }
        pos = ((after ?? 0) + (before ?? (after ?? 0) + 2 * RANK_STEP)) / 2
      } else if (after != null) {
        pos = after + RANK_STEP
      } else if (before != null) {
        pos = before - RANK_STEP
      } else {
        const max = (
          this.db
            .prepare(`SELECT MAX(position) AS m FROM tasks WHERE project_id = ? AND column_id = ?`)
            .get(projectId, args.columnId) as { m: number | null }
        ).m
        pos = (max ?? 0) + RANK_STEP
      }
      // Момент попадания в «Готово» — точка отсчёта, после которой карточка
      // уходит с доски. Переезд между done-колонками отсчёт не сбрасывает,
      // возврат в работу — сбрасывает (задача снова живая).
      const done = this.isDoneColumn(args.columnId) ? 1 : 0
      this.db
        .prepare(
          `UPDATE tasks SET column_id = ?, position = ?, updated_at = ?,
                  done_at = CASE WHEN ? = 1 THEN COALESCE(done_at, ?) ELSE NULL END
           WHERE id = ? AND project_id = ?`
        )
        .run(args.columnId, pos, ts, done, ts, taskId, projectId)
    })()
    this.touchProject(projectId, ts)
    return this.getTask(projectId, taskId)
  }

  deleteTask(userId: string, projectId: string, taskId: string): boolean {
    if (!this.isProjectMember(userId, projectId)) return false
    let changes = 0
    this.db.transaction(() => {
      changes = this.db.prepare(`DELETE FROM tasks WHERE id = ? AND project_id = ?`).run(taskId, projectId).changes
    })()
    if (changes) this.touchProject(projectId)
    return changes > 0
  }

  // ============================ CI-раннер =====================
  /** Видима ли команда пользователю (глобальная — всем; проектная — участнику). */
  private ciCommandVisible(userId: string, r: CiCommandRow): boolean {
    if (r.scope === 'global') return true
    return r.project_id ? this.isProjectMember(userId, r.project_id) : false
  }

  getCiCommand(userId: string, id: string): CiCommand | null {
    const r = this.db.prepare(`SELECT * FROM ci_commands WHERE id = ? AND deleted_at IS NULL`).get(id) as CiCommandRow | undefined
    if (!r || !this.ciCommandVisible(userId, r)) return null
    return mapCiCommand(r)
  }

  /** Команды, видимые пользователю: глобальные + команды переданного проекта. */
  listCiCommands(userId: string, projectId?: string): CiCommand[] {
    const rows = this.db.prepare(`SELECT * FROM ci_commands WHERE deleted_at IS NULL ORDER BY scope DESC, name ASC`).all() as CiCommandRow[]
    return rows
      .filter((r) => (r.scope === 'global' ? true : projectId ? r.project_id === projectId && this.isProjectMember(userId, projectId) : !!r.project_id && this.isProjectMember(userId, r.project_id)))
      .map(mapCiCommand)
  }

  private ciNameTaken(scope: CiCommandScope, projectId: string | null, name: string, exceptId?: string): boolean {
    const row = this.db
      .prepare(`SELECT id FROM ci_commands WHERE deleted_at IS NULL AND scope = ? AND name = ? AND (project_id IS ? OR project_id = ?)`)
      .get(scope, name, scope === 'global' ? null : projectId, projectId) as { id: string } | undefined
    return !!row && row.id !== exceptId
  }

  createCiCommand(userId: string, input: CiCommandInput): CiCommand {
    const scope: CiCommandScope = input.scope === 'global' ? 'global' : 'project'
    const projectId = scope === 'global' ? null : input.projectId ?? null
    const name = (input.name ?? '').trim()
    if (!name) throw new Error('Имя команды обязательно')
    if (!(input.script ?? '').trim()) throw new Error('Скрипт команды обязателен')
    if (this.ciNameTaken(scope, projectId, name)) throw new Error('Команда с таким именем уже существует в этой области')
    const id = this.newId()
    const ts = this.now()
    this.db
      .prepare(
        `INSERT INTO ci_commands (id, scope, project_id, name, script, description, workdir, timeout_sec, env_json, allow_failure, is_cleanup, available_to_model, is_test, version, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
      )
      .run(
        id, scope, projectId, name, input.script ?? '', input.description ?? '', input.workdir ?? '',
        input.timeoutSec ?? null, JSON.stringify(input.env ?? {}),
        input.allowFailure ? 1 : 0, input.isCleanup ? 1 : 0, input.availableToModel === false ? 0 : 1,
        // Гейт узнаём по тексту команды: заводящий её человек мог про флаг не знать.
        input.isTest ?? isVerificationCommand({ name, script: input.script ?? '' }) ? 1 : 0,
        userId, ts, ts
      )
    return mapCiCommand(this.db.prepare(`SELECT * FROM ci_commands WHERE id = ?`).get(id) as CiCommandRow)
  }

  updateCiCommand(userId: string, id: string, input: CiCommandInput): CiCommand | null {
    const cur = this.db.prepare(`SELECT * FROM ci_commands WHERE id = ? AND deleted_at IS NULL`).get(id) as CiCommandRow | undefined
    if (!cur) return null
    const set: string[] = []
    const vals: unknown[] = []
    const nextName = input.name !== undefined ? input.name.trim() : cur.name
    if (input.name !== undefined) {
      if (!nextName) throw new Error('Имя команды обязательно')
      if (this.ciNameTaken(cur.scope === 'global' ? 'global' : 'project', cur.project_id, nextName, id)) throw new Error('Команда с таким именем уже существует в этой области')
      set.push('name = ?'); vals.push(nextName)
    }
    if (input.script !== undefined) { set.push('script = ?'); vals.push(input.script) }
    if (input.description !== undefined) { set.push('description = ?'); vals.push(input.description) }
    if (input.workdir !== undefined) { set.push('workdir = ?'); vals.push(input.workdir) }
    if (input.timeoutSec !== undefined) { set.push('timeout_sec = ?'); vals.push(input.timeoutSec) }
    if (input.env !== undefined) { set.push('env_json = ?'); vals.push(JSON.stringify(input.env)) }
    if (input.allowFailure !== undefined) { set.push('allow_failure = ?'); vals.push(input.allowFailure ? 1 : 0) }
    if (input.isCleanup !== undefined) { set.push('is_cleanup = ?'); vals.push(input.isCleanup ? 1 : 0) }
    if (input.availableToModel !== undefined) { set.push('available_to_model = ?'); vals.push(input.availableToModel ? 1 : 0) }
    if (input.isTest !== undefined) { set.push('is_test = ?'); vals.push(input.isTest ? 1 : 0) }
    // Правка текста скрипта поднимает версию (снапшоты завершённых ранов неизменны).
    if (input.script !== undefined && input.script !== cur.script) set.push('version = version + 1')
    set.push('updated_at = ?'); vals.push(this.now())
    this.db.prepare(`UPDATE ci_commands SET ${set.join(', ')} WHERE id = ?`).run(...vals, id)
    return mapCiCommand(this.db.prepare(`SELECT * FROM ci_commands WHERE id = ?`).get(id) as CiCommandRow)
  }

  softDeleteCiCommand(userId: string, id: string): boolean {
    const cur = this.db.prepare(`SELECT * FROM ci_commands WHERE id = ? AND deleted_at IS NULL`).get(id) as CiCommandRow | undefined
    if (!cur) return false
    this.db.prepare(`UPDATE ci_commands SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(this.now(), this.now(), id)
    return true
  }

  /** Привязки команды: проекты и задачи, где она используется в слотах. */
  ciCommandUsage(commandId: string): { projects: Array<{ id: string; name: string }>; tasks: Array<{ id: string; title: string }> } {
    const rows = this.db.prepare(`SELECT owner_type, owner_id FROM ci_slot_commands WHERE command_id = ?`).all(commandId) as Array<{ owner_type: string; owner_id: string }>
    const projects: Array<{ id: string; name: string }> = []
    const tasks: Array<{ id: string; title: string }> = []
    const seenP = new Set<string>()
    const seenT = new Set<string>()
    for (const r of rows) {
      if (r.owner_type === 'project' && !seenP.has(r.owner_id)) {
        seenP.add(r.owner_id)
        const p = this.db.prepare(`SELECT name FROM projects WHERE id = ?`).get(r.owner_id) as { name: string } | undefined
        if (p) projects.push({ id: r.owner_id, name: p.name })
      } else if (r.owner_type === 'task' && !seenT.has(r.owner_id)) {
        seenT.add(r.owner_id)
        const t = this.db.prepare(`SELECT title FROM tasks WHERE id = ?`).get(r.owner_id) as { title: string } | undefined
        if (t) tasks.push({ id: r.owner_id, title: t.title })
      }
    }
    return { projects, tasks }
  }

  // --- Слот-конфиг (дефолты проекта / переопределение задачи) ---

  private readSlot(ownerType: 'project' | 'task', ownerId: string, slot: CiSlot): string[] {
    return (this.db.prepare(`SELECT command_id FROM ci_slot_commands WHERE owner_type = ? AND owner_id = ? AND slot = ? ORDER BY position ASC`).all(ownerType, ownerId, slot) as Array<{ command_id: string }>).map((r) => r.command_id)
  }

  getCiSlotConfig(ownerType: 'project' | 'task', ownerId: string): CiSlotConfig {
    return { beforeModel: this.readSlot(ownerType, ownerId, 'before_model'), afterModel: this.readSlot(ownerType, ownerId, 'after_model') }
  }

  /** Есть ли у владельца хоть одна привязка (для метки «унаследовано/переопределено»). */
  hasCiSlotConfig(ownerType: 'project' | 'task', ownerId: string): boolean {
    return this.db.prepare(`SELECT 1 FROM ci_slot_commands WHERE owner_type = ? AND owner_id = ? LIMIT 1`).get(ownerType, ownerId) !== undefined
  }

  setCiSlotCommands(ownerType: 'project' | 'task', ownerId: string, slot: CiSlot, commandIds: string[]): void {
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM ci_slot_commands WHERE owner_type = ? AND owner_id = ? AND slot = ?`).run(ownerType, ownerId, slot)
      commandIds.forEach((commandId, i) => this.db.prepare(`INSERT INTO ci_slot_commands (id, owner_type, owner_id, slot, command_id, position) VALUES (?, ?, ?, ?, ?, ?)`).run(this.newId(), ownerType, ownerId, slot, commandId, i))
    })()
  }

  /**
   * Встроенный шаг «Актуализировать базу знаний» в справочнике команд. Скрипт не
   * исполняется — раннер видит `builtin` и зовёт серверный хук; строка нужна,
   * чтобы шаг вёл себя как обычная команда: двигался внутри слота и убирался из
   * проекта или задачи штатным редактором слотов.
   *
   * При первом появлении команды раздаём её в слот «после модели» всех проектов,
   * где пайплайн уже настроен, — перед шагом коммита, чтобы правки `docs/kb/*`
   * уехали тем же коммитом, что и код. Повторно (после того как шаг убрали
   * руками) команда не возвращается: строка справочника уже есть.
   */
  private ensureKbUpdateCommand(): void {
    if (this.db.prepare(`SELECT id FROM ci_commands WHERE id = ?`).get(CI_KB_UPDATE_COMMAND_ID)) return
    const ts = this.now()
    this.db
      .prepare(
        `INSERT INTO ci_commands (id, scope, project_id, name, script, description, workdir, timeout_sec, env_json, allow_failure, is_cleanup, available_to_model, builtin, version, created_by, created_at, updated_at)
         VALUES (?, 'global', NULL, ?, ?, ?, '', NULL, '{}', 0, 0, 0, 'kb_update', 1, 'system', ?, ?)`
      )
      .run(
        CI_KB_UPDATE_COMMAND_ID,
        CI_KB_UPDATE_COMMAND_NAME,
        '# Серверный шаг: скрипт не выполняется.\n# Модель сверяет базу знаний с изменениями рабочей копии (см. kb/codeUpdate.ts).',
        'Модель дописывает в базу знаний, что изменилось в этом ране: темы docs/kb/*.md в рабочей копии и статьи раздела проекта. Ошибка шага останавливает ран.',
        ts,
        ts
      )
  }

  /**
   * Идемпотентная миграция development pipeline. Удаляет только известные
   * системные интеграционные команды из after_model; строки справочника и любые
   * пользовательские команды сохраняются для истории и других интерфейсов.
   */
  private pruneDevelopmentAfterModelCommands(): void {
    const rows = this.db.prepare(`
      SELECT s.id, c.name, c.script, c.builtin, c.is_cleanup, c.is_test
      FROM ci_slot_commands s
      JOIN ci_commands c ON c.id = s.command_id
      WHERE s.slot = 'after_model'
    `).all() as Array<{ id:string; name:string; script:string; builtin:string|null; is_cleanup:number; is_test:number }>
    const remove = this.db.prepare(`DELETE FROM ci_slot_commands WHERE id = ?`)
    const tx = this.db.transaction(() => {
      for (const row of rows) {
        const legacy = row.builtin === 'kb_update'
          || !!row.is_cleanup
          || !!row.is_test
          || isMergeToBaseStepLike(row.name, row.script)
          || isProductionDeployStepLike(row.name, row.script)
        if (legacy) remove.run(row.id)
      }
    })
    tx()
  }

  /** Эффективные слоты задачи: её переопределение либо дефолты проекта. */
  resolveTaskSlots(projectId: string, taskId: string): CiSlotConfig {
    if (this.hasCiSlotConfig('task', taskId)) return this.getCiSlotConfig('task', taskId)
    return this.getCiSlotConfig('project', projectId)
  }

  getCiLlmConfig(ownerType: 'project' | 'task', ownerId: string): CiLlmConfig | null {
    const row = this.db.prepare(`SELECT llm_engine_id, provider, model, mode, clarify_level, clarify_max FROM ci_llm_configs WHERE owner_type = ? AND owner_id = ?`).get(ownerType, ownerId) as
      | { llm_engine_id: string | null; provider: string; model: string; mode: string; clarify_level: string; clarify_max: number }
      | undefined
    if (!row) return null
    return {
      ...(row.llm_engine_id ? { llmEngineId: row.llm_engine_id } : {}),
      provider: row.provider === 'codex' ? 'codex' : 'claude',
      model: row.model,
      mode: normRunMode(row.mode),
      clarifyLevel: normClarifyLevel(row.clarify_level),
      clarifyMax: clampClarifyMax(row.clarify_max)
    }
  }

  setCiLlmConfig(ownerType: 'project' | 'task', ownerId: string, config: CiLlmConfig): CiLlmConfig {
    const provider = config.provider === 'codex' ? 'codex' : 'claude'
    const model = config.model.trim() || (provider === 'codex' ? 'gpt-5.4' : DEFAULT_CI_CLAUDE_MODEL)
    const next: CiLlmConfig = {
      ...(config.llmEngineId ? { llmEngineId: config.llmEngineId } : {}),
      provider,
      model,
      mode: normRunMode(config.mode),
      clarifyLevel: normClarifyLevel(config.clarifyLevel),
      clarifyMax: clampClarifyMax(config.clarifyMax)
    }
    this.db
      .prepare(
        `INSERT INTO ci_llm_configs (owner_type, owner_id, llm_engine_id, provider, model, mode, clarify_level, clarify_max)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_type, owner_id) DO UPDATE SET llm_engine_id=excluded.llm_engine_id, provider=excluded.provider, model=excluded.model,
           mode=excluded.mode, clarify_level=excluded.clarify_level, clarify_max=excluded.clarify_max`
      )
      .run(ownerType, ownerId, next.llmEngineId, next.provider, next.model, next.mode, next.clarifyLevel, next.clarifyMax)
    return next
  }

  /** Снять переопределение (задача снова наследует настройку проекта). */
  clearCiLlmConfig(ownerType: 'project' | 'task', ownerId: string): boolean {
    return this.db.prepare(`DELETE FROM ci_llm_configs WHERE owner_type = ? AND owner_id = ?`).run(ownerType, ownerId).changes > 0
  }

  /** Переопределение executor/provider/model одного автоматического этапа. */
  getCiStageLlmConfig(ownerType: 'project' | 'task', ownerId: string, stage: CiUsageKind): CiStageLlmSelection | null {
    const row = this.db.prepare(`SELECT llm_engine_id, provider, model FROM ci_stage_llm_configs WHERE owner_type = ? AND owner_id = ? AND stage = ?`).get(ownerType, ownerId, stage) as
      | { llm_engine_id: string | null; provider: string | null; model: string | null }
      | undefined
    if (!row) return null
    return {
      ...(row.llm_engine_id !== null ? { llmEngineId: row.llm_engine_id } : {}),
      ...(row.provider ? { provider: row.provider === 'codex' ? 'codex' : 'claude' } : {}),
      ...(row.model !== null ? { model: row.model } : {})
    }
  }

  setCiStageLlmConfig(ownerType: 'project' | 'task', ownerId: string, stage: CiUsageKind, config: CiStageLlmSelection): CiStageLlmSelection {
    if (!CI_USAGE_KINDS.includes(stage)) throw new Error(`Неизвестный этап workflow: ${stage}`)
    const next: CiStageLlmSelection = {
      ...(config.llmEngineId !== undefined ? { llmEngineId: config.llmEngineId } : {}),
      ...(config.provider ? { provider: config.provider === 'codex' ? 'codex' : 'claude' } : {}),
      ...(typeof config.model === 'string' ? { model: config.model.trim() } : {})
    }
    this.db.prepare(`INSERT INTO ci_stage_llm_configs (owner_type, owner_id, stage, llm_engine_id, provider, model)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_type, owner_id, stage) DO UPDATE SET llm_engine_id=excluded.llm_engine_id, provider=excluded.provider, model=excluded.model`)
      .run(ownerType, ownerId, stage, next.llmEngineId ?? null, next.provider ?? null, next.model ?? null)
    return next
  }

  clearCiStageLlmConfig(ownerType: 'project' | 'task', ownerId: string, stage: CiUsageKind): boolean {
    return this.db.prepare(`DELETE FROM ci_stage_llm_configs WHERE owner_type = ? AND owner_id = ? AND stage = ?`).run(ownerType, ownerId, stage).changes > 0
  }

  /** Эффективная тройка: стадия задачи → стадия проекта → модель проекта → системный fallback. */
  resolveTaskStageLlmConfig(projectId: string, taskId: string, stage: CiUsageKind, fallback?: CiStageLlmSnapshot): CiStageLlmSnapshot {
    const project = this.getCiLlmConfig('project', projectId)
    return resolveCiStageLlm({
      taskStage: this.getCiStageLlmConfig('task', taskId, stage),
      projectStage: this.getCiStageLlmConfig('project', projectId, stage),
      projectModel: project ? { llmEngineId: project.llmEngineId ?? null, provider: project.provider, model: project.model } : fallback ?? null,
      systemFallback: fallback ?? { llmEngineId: null, provider: DEFAULT_CI_LLM_CONFIG.provider, model: DEFAULT_CI_LLM_CONFIG.model }
    })
  }

  /** Пользовательские LLM-настройки — последний уровень наследования CI. */
  ciLlmDefaultsForUser(userId: string): CiLlmConfig {
    const settings = this.getSettings(userId)
    return {
      ...DEFAULT_CI_LLM_CONFIG,
      ...(settings.llmEngineId ? { llmEngineId: settings.llmEngineId } : {}),
      provider: settings.llmProvider,
      model: settings.llmProvider === 'codex' ? settings.codexModel : settings.model
    }
  }

  /** Эффективная конфигурация: задача → проект → пользователь → системный дефолт. */
  resolveTaskLlmConfig(projectId: string, taskId: string, userId?: string): CiLlmConfig {
    return this.getCiLlmConfig('task', taskId)
      ?? this.getCiLlmConfig('project', projectId)
      ?? (userId ? this.ciLlmDefaultsForUser(userId) : { ...DEFAULT_CI_LLM_CONFIG })
  }

  /** Найти системную колонку проекта для автоматического перехода CI. */
  getColumnIdBySemantic(projectId: string, semanticType: KanbanColumnSemanticType): string | null {
    const row = this.db.prepare(`SELECT id FROM kanban_columns WHERE project_id = ? AND semantic_type = ? ORDER BY position LIMIT 1`).get(projectId, semanticType) as { id: string } | undefined
    return row?.id ?? null
  }

  /** Публичный доступ к задаче для CI-раннера (по членству проекта). */
  getCiTask(userId: string, projectId: string, taskId: string): Task | null {
    if (!this.isProjectMember(userId, projectId)) return null
    return this.getTask(projectId, taskId)
  }

  /**
   * Учёт «влито в прод-ветку, но прод не пересобран»: в проекте держим ОДНУ
   * открытую карточку «Пересборка прода», описание которой — список вмерженных
   * задач (строка на задачу). Идемпотентно: повторный ран той же задачи строку
   * не дублирует, а уехавшая в done карточка не мешает завести новую. Всё в
   * транзакции — иначе параллельные раны проекта наплодят дубли карточки.
   * `null`, если в проекте нет колонки `ready` (создавать карточку некуда).
   */
  ensureProdRebuildTask(userId: string, projectId: string, line: string): { task: Task; created: boolean; appended: boolean } | null {
    if (!this.isProjectMember(userId, projectId)) return null
    const entry = line.trim()
    if (!entry) return null
    return this.db.transaction(() => {
      const open = this.db
        .prepare(
          `SELECT t.id FROM tasks t JOIN kanban_columns c ON c.id = t.column_id
           WHERE t.project_id = ? AND t.title = ? AND COALESCE(c.semantic_type, '') != 'done'
           ORDER BY t.created_at ASC, t.id ASC LIMIT 1`
        )
        .get(projectId, PROD_REBUILD_TASK_TITLE) as { id: string } | undefined
      if (!open) {
        const columnId = this.getColumnIdBySemantic(projectId, 'ready')
        if (!columnId) return null
        const task = this.createTask(userId, projectId, {
          columnId,
          title: PROD_REBUILD_TASK_TITLE,
          description: `${PROD_REBUILD_TASK_INTRO}\n\n${entry}`,
          type: 'task',
          assignee: null
        })
        return task ? { task, created: true, appended: true } : null
      }
      const current = this.getTask(projectId, open.id)
      if (!current) return null
      if (current.description.split('\n').some((l) => l.trim() === entry)) return { task: current, created: false, appended: false }
      const description = `${current.description.replace(/\s+$/, '')}\n${entry}`
      const updated = this.updateTask(userId, projectId, open.id, { description })
      return updated ? { task: updated, created: false, appended: true } : null
    })()
  }

  // --- Глобальные настройки CI ---

  getCiSettings(): CiGlobalSettings {
    const r = this.db.prepare(`SELECT * FROM ci_settings WHERE id = 1`).get() as Record<string, number | string | null> | undefined
    if (!r) {
      const d = DEFAULT_CI_GLOBAL_SETTINGS
      this.db.prepare(`INSERT INTO ci_settings (id, max_fix_attempts, fix_time_limit_ms, fix_token_limit, default_step_timeout_sec, metrics_window, max_concurrent_runs, max_model_command_calls, interaction_wait_ms, stage_models, bash_output_limit_chars, read_output_limit_chars, read_window_max_lines, grep_match_limit, grep_output_limit_chars) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(d.maxFixAttempts, d.fixTimeLimitMs, d.fixTokenLimit, d.defaultStepTimeoutSec, d.metricsWindow, d.maxConcurrentRuns, d.maxModelCommandCalls, d.interactionWaitMs, JSON.stringify(d.stageModels), d.bashOutputLimitChars, d.readOutputLimitChars, d.readWindowMaxLines, d.grepMatchLimit, d.grepOutputLimitChars)
      return { ...d, stageModels: { ...d.stageModels } }
    }
    const d = DEFAULT_CI_GLOBAL_SETTINGS
    return {
      maxFixAttempts: r.max_fix_attempts as number, fixTimeLimitMs: r.fix_time_limit_ms as number, fixTokenLimit: r.fix_token_limit as number,
      defaultStepTimeoutSec: r.default_step_timeout_sec as number, metricsWindow: r.metrics_window as number,
      maxConcurrentRuns: r.max_concurrent_runs as number, maxModelCommandCalls: r.max_model_command_calls as number,
      interactionWaitMs: (r.interaction_wait_ms as number) ?? d.interactionWaitMs,
      stageModels: normCiStageModels(parseJsonObject(r.stage_models)),
      bashOutputLimitChars: (r.bash_output_limit_chars as number) ?? d.bashOutputLimitChars,
      readOutputLimitChars: (r.read_output_limit_chars as number) ?? d.readOutputLimitChars,
      readWindowMaxLines: (r.read_window_max_lines as number) ?? d.readWindowMaxLines,
      grepMatchLimit: (r.grep_match_limit as number) ?? d.grepMatchLimit,
      grepOutputLimitChars: (r.grep_output_limit_chars as number) ?? d.grepOutputLimitChars
    }
  }

  updateCiSettings(patch: Partial<CiGlobalSettings>): CiGlobalSettings {
    const cur = this.getCiSettings()
    const next = { ...cur, ...patch, stageModels: patch.stageModels ? normCiStageModels({ ...cur.stageModels, ...patch.stageModels }) : cur.stageModels }
    this.db.prepare(`UPDATE ci_settings SET max_fix_attempts=?, fix_time_limit_ms=?, fix_token_limit=?, default_step_timeout_sec=?, metrics_window=?, max_concurrent_runs=?, max_model_command_calls=?, interaction_wait_ms=?, stage_models=?, bash_output_limit_chars=?, read_output_limit_chars=?, read_window_max_lines=?, grep_match_limit=?, grep_output_limit_chars=? WHERE id=1`).run(next.maxFixAttempts, next.fixTimeLimitMs, next.fixTokenLimit, next.defaultStepTimeoutSec, next.metricsWindow, next.maxConcurrentRuns, next.maxModelCommandCalls, next.interactionWaitMs, JSON.stringify(next.stageModels), next.bashOutputLimitChars, next.readOutputLimitChars, next.readWindowMaxLines, next.grepMatchLimit, next.grepOutputLimitChars)
    return next
  }

  // --- Раны и шаги ---

  createCiRun(args: { projectId: string; taskId: string; agentId: string | null; agentOwnerId?: string | null; agentOwnerName?: string; agentSelectionSource?: 'explicit' | 'task_pinned' | 'project_default' | 'user_project_default' | 'fallback' | 'unknown'; triggeredBy: string; prevColumnId: string | null; runColumnId?: string | null; slotProgress: CiSlotProgress; llmEngineId?: string | null; llmProvider?: 'claude' | 'codex'; llmModel?: string; mode?: CiRunMode; clarifyLevel?: CiClarifyLevel; clarifyMax?: number; conversationId?: string | null; kbContextMode?: KbContextMode }): CiRun {
    const id = this.newId()
    const ts = this.now()
    this.db.prepare(`INSERT INTO ci_runs (id, project_id, task_id, agent_id, agent_owner_id, agent_owner_name, agent_selection_source, status, triggered_by, prev_column_id, run_column_id, llm_engine_id, llm_provider, llm_model, mode, clarify_level, clarify_max, conversation_id, kb_context_mode, slot_progress_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, args.projectId, args.taskId, args.agentId, args.agentOwnerId ?? null, args.agentOwnerName ?? 'неизвестно', args.agentSelectionSource ?? 'unknown', args.triggeredBy, args.prevColumnId, args.runColumnId ?? null, args.llmEngineId ?? null, args.llmProvider ?? 'claude', args.llmModel ?? DEFAULT_CI_CLAUDE_MODEL, normRunMode(args.mode), normClarifyLevel(args.clarifyLevel), clampClarifyMax(args.clarifyMax), args.conversationId ?? null, normKbContextMode(args.kbContextMode), JSON.stringify(args.slotProgress), ts)
    return mapCiRun(this.db.prepare(`SELECT * FROM ci_runs WHERE id = ?`).get(id) as CiRunRow)
  }

  /**
   * Сколько незавершённых ранов сейчас закреплено за каждой машиной — для
   * распределения параллельных запусков. Ран с пустым `agent_id` (карточки до
   * появления выбора машины) выполняется на машине проекта по умолчанию, поэтому
   * учитывается за ней: без этого такая машина выглядит свободной и собирает всё.
   */
  countActiveCiRunsByAgent(): Record<string, number> {
    const rows = this.db.prepare(
      `SELECT COALESCE(r.agent_id, p.default_agent_id) AS agent_id, COUNT(*) AS n
       FROM ci_runs r LEFT JOIN projects p ON p.id = r.project_id
       WHERE r.status IN ('queued', 'running', 'awaiting_input')
       GROUP BY COALESCE(r.agent_id, p.default_agent_id)`
    ).all() as Array<{ agent_id: string | null; n: number }>
    const counts: Record<string, number> = {}
    for (const row of rows) if (row.agent_id) counts[row.agent_id] = row.n
    return counts
  }

  getCiRunRaw(runId: string): CiRun | null {
    const r = this.db.prepare(`SELECT * FROM ci_runs WHERE id = ?`).get(runId) as CiRunRow | undefined
    return r ? mapCiRun(r) : null
  }

  activeCiRunForTask(taskId: string): CiRun | null {
    const r = this.db.prepare(
      `SELECT * FROM ci_runs WHERE task_id = ? AND status IN ('queued', 'running', 'awaiting_input') ORDER BY created_at DESC, rowid DESC LIMIT 1`
    ).get(taskId) as CiRunRow | undefined
    return r ? mapCiRun(r) : null
  }

  getCiRun(userId: string, runId: string): CiRunDetail | null {
    const r = this.db.prepare(`SELECT * FROM ci_runs WHERE id = ?`).get(runId) as CiRunRow | undefined
    if (!r || !this.isProjectMember(userId, r.project_id)) return null
    const run = mapCiRun(r)
    const steps = (this.db.prepare(`SELECT * FROM ci_run_steps WHERE run_id = ? ORDER BY position ASC, id ASC`).all(runId) as CiRunStepRow[]).map(mapCiRunStep)
    const fixAttempts = (this.db.prepare(`SELECT f.* FROM ci_fix_attempts f JOIN ci_run_steps s ON s.id = f.run_step_id WHERE s.run_id = ? ORDER BY f.created_at ASC`).all(runId) as CiFixRow[]).map(mapCiFix)
    const stageRuns = this.listCiStageRuns(runId)
    return { run, executionLlm: this.ciExecutionLlm(run, stageRuns), stageRuns, steps, fixAttempts, interactions: this.listCiInteractions(runId) }
  }

  listCiRunsForTask(userId: string, projectId: string, taskId: string): CiRun[] {
    if (!this.isProjectMember(userId, projectId)) return []
    return (this.db.prepare(`SELECT * FROM ci_runs WHERE task_id = ? ORDER BY created_at DESC`).all(taskId) as CiRunRow[]).map(mapCiRun)
  }

  updateCiRun(runId: string, patch: { status?: CiStatus; runColumnId?: string | null; terminalColumnId?: string | null; agentId?: string | null; workspaceId?: string | null; startedAt?: number; finishedAt?: number; durationMs?: number; slotProgress?: CiSlotProgress; llmEngineId?: string | null; llmProvider?: 'claude' | 'codex'; llmModel?: string; mode?: CiRunMode; conversationId?: string | null; modelSessionId?: string | null; fixContext?: CiFixDiagnosticContext | null }): CiRun | null {
    const set: string[] = []
    const vals: unknown[] = []
    if (patch.status !== undefined) { set.push('status = ?'); vals.push(patch.status) }
    if (patch.runColumnId !== undefined) { set.push('run_column_id = ?'); vals.push(patch.runColumnId) }
    if (patch.terminalColumnId !== undefined) { set.push('terminal_column_id = ?'); vals.push(patch.terminalColumnId) }
    if (patch.agentId !== undefined) { set.push('agent_id = ?'); vals.push(patch.agentId) }
    if (patch.workspaceId !== undefined) { set.push('workspace_id = ?'); vals.push(patch.workspaceId) }
    if (patch.startedAt !== undefined) { set.push('started_at = ?'); vals.push(patch.startedAt) }
    if (patch.finishedAt !== undefined) { set.push('finished_at = ?'); vals.push(patch.finishedAt) }
    if (patch.durationMs !== undefined) { set.push('duration_ms = ?'); vals.push(patch.durationMs) }
    if (patch.slotProgress !== undefined) { set.push('slot_progress_json = ?'); vals.push(JSON.stringify(patch.slotProgress)) }
    if (patch.llmEngineId !== undefined) { set.push('llm_engine_id = ?'); vals.push(patch.llmEngineId) }
    if (patch.llmProvider !== undefined) { set.push('llm_provider = ?'); vals.push(patch.llmProvider) }
    if (patch.llmModel !== undefined) { set.push('llm_model = ?'); vals.push(patch.llmModel) }
    if (patch.mode !== undefined) { set.push('mode = ?'); vals.push(normRunMode(patch.mode)) }
    if (patch.conversationId !== undefined) { set.push('conversation_id = ?'); vals.push(patch.conversationId) }
    if (patch.modelSessionId !== undefined) { set.push('model_session_id = ?'); vals.push(patch.modelSessionId) }
    if (patch.fixContext !== undefined) { set.push('fix_context_json = ?'); vals.push(patch.fixContext ? JSON.stringify(patch.fixContext) : null) }
    if (!set.length) return this.getCiRunRaw(runId)
    this.db.prepare(`UPDATE ci_runs SET ${set.join(', ')} WHERE id = ?`).run(...vals, runId)
    return this.getCiRunRaw(runId)
  }

  createCiStageRun(args: { runId: string; taskId: string; stage: CiUsageKind; llm: CiStageLlmSnapshot }): CiStageRun {
    const id = this.newId()
    const ts = this.now()
    this.db.prepare(`INSERT INTO ci_stage_runs (id, run_id, task_id, stage, status, llm_engine_id, llm_provider, llm_model, created_at)
      VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)`)
      .run(id, args.runId, args.taskId, args.stage, args.llm.llmEngineId, args.llm.provider, args.llm.model, ts)
    return this.listCiStageRuns(args.runId).find((stage) => stage.id === id)!
  }

  updateCiStageRun(id: string, patch: { status?: CiStatus; outcome?: string | null; startedAt?: number; finishedAt?: number; durationMs?: number }): CiStageRun | null {
    const set: string[] = []
    const values: unknown[] = []
    if (patch.status !== undefined) { set.push('status = ?'); values.push(patch.status) }
    if (patch.outcome !== undefined) { set.push('outcome = ?'); values.push(patch.outcome) }
    if (patch.startedAt !== undefined) { set.push('started_at = ?'); values.push(patch.startedAt) }
    if (patch.finishedAt !== undefined) { set.push('finished_at = ?'); values.push(patch.finishedAt) }
    if (patch.durationMs !== undefined) { set.push('duration_ms = ?'); values.push(patch.durationMs) }
    if (!set.length) return null
    this.db.prepare(`UPDATE ci_stage_runs SET ${set.join(', ')} WHERE id = ?`).run(...values, id)
    const row = this.db.prepare(`SELECT run_id FROM ci_stage_runs WHERE id = ?`).get(id) as { run_id: string } | undefined
    return row ? this.listCiStageRuns(row.run_id).find((stage) => stage.id === id) ?? null : null
  }

  private ciExecutionLlm(run: CiRun, stageRuns: CiStageRun[]): CiExecutionLlmSnapshot {
    const stage = [...stageRuns].reverse().find((item) => ['queued', 'running', 'awaiting_input'].includes(item.status))
      ?? stageRuns.at(-1)
    const base = {
      llmEngineId: run.llmEngineId ?? null, provider: run.llmProvider ?? null,
      model: run.llmModel || null
    }
    if (stage) return {
      source: 'stage', stage: stage.stage, llmEngineId: stage.llm.llmEngineId ?? null,
      provider: stage.llm.provider ?? null, model: stage.llm.model || null, base
    }
    return {
      source: 'run', stage: null, ...base, base
    }
  }

  listCiStageRuns(runId: string): CiStageRun[] {
    const rows = this.db.prepare(`SELECT * FROM ci_stage_runs WHERE run_id = ? ORDER BY created_at, rowid`).all(runId) as Array<Record<string, string | number | null>>
    const usage = this.listCiRunUsage(runId)
    return rows.map((row) => {
      const startedAt = row.started_at as number | null
      const finishedAt = row.finished_at as number | null
      return {
        id: row.id as string,
        runId: row.run_id as string,
        taskId: row.task_id as string,
        stage: row.stage as CiUsageKind,
        status: normCiStatus(row.status as string),
        llm: { llmEngineId: row.llm_engine_id as string | null, provider: row.llm_provider === 'codex' ? 'codex' : 'claude', model: row.llm_model as string },
        startedAt,
        finishedAt,
        durationMs: row.duration_ms as number | null,
        usage: ciUsageTotals(usage.filter((item) => item.kind === row.stage && (startedAt === null || item.at >= startedAt) && (finishedAt === null || item.at <= finishedAt))),
        outcome: row.outcome as string | null
      }
    })
  }

  /**
   * Раны, оставшиеся активными после остановки процесса (рестарт контейнера,
   * падение): исполнителя в памяти уже нет, а карточка задачи всё ещё считает CI
   * занятым и не даёт запустить его заново. При старте сервера закрываем такие
   * раны и их незавершённые шаги.
   */
  failInterruptedCiRuns(): CiRun[] {
    const rows = this.db
      .prepare(`SELECT * FROM ci_runs WHERE status IN ('queued', 'running', 'awaiting_input')`)
      .all() as CiRunRow[]
    const ts = this.now()
    for (const r of rows) {
      this.db.prepare(`UPDATE ci_run_steps SET status = 'failed', finished_at = ? WHERE run_id = ? AND status IN ('running', 'awaiting_input')`).run(ts, r.id)
      this.db.prepare(`UPDATE ci_run_steps SET status = 'skipped' WHERE run_id = ? AND status = 'queued'`).run(r.id)
      this.db.prepare(`UPDATE ci_interactions SET status = 'cancelled', answered_at = ? WHERE run_id = ? AND status = 'pending'`).run(ts, r.id)
      this.db.prepare(`UPDATE ci_runs SET status = 'failed', finished_at = ?, duration_ms = ? WHERE id = ?`).run(ts, r.started_at ? ts - r.started_at : null, r.id)
      this.addCiEvent({ projectId: r.project_id, runId: r.id, type: 'run.finished', actorType: 'system', payload: { status: 'failed', reason: 'server_restart' } })
    }
    return rows.map((r) => this.getCiRunRaw(r.id)).filter((r): r is CiRun => r !== null)
  }

  addCiRunStep(args: { runId: string; slot: CiSlot | null; position: number; kind: CiStepKind; parentStepId?: string | null; initiatedBy?: CiInitiatedBy; commandId?: string | null; commandSnapshot?: string | null; title: string; workdir?: string | null; status?: CiStatus }): CiRunStep {
    const id = this.newId()
    this.db.prepare(`INSERT INTO ci_run_steps (id, run_id, slot, position, kind, parent_step_id, initiated_by, command_id, command_snapshot, title, workdir, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, args.runId, args.slot, args.position, args.kind, args.parentStepId ?? null, args.initiatedBy ?? 'system', args.commandId ?? null, args.commandSnapshot ?? null, args.title, args.workdir ?? null, args.status ?? 'queued')
    return mapCiRunStep(this.db.prepare(`SELECT * FROM ci_run_steps WHERE id = ?`).get(id) as CiRunStepRow)
  }

  updateCiRunStep(stepId: string, patch: { status?: CiStatus; exitCode?: number | null; attempt?: number; fixedByModel?: boolean; startedAt?: number; finishedAt?: number; durationMs?: number }): CiRunStep | null {
    const set: string[] = []
    const vals: unknown[] = []
    if (patch.status !== undefined) { set.push('status = ?'); vals.push(patch.status) }
    if (patch.exitCode !== undefined) { set.push('exit_code = ?'); vals.push(patch.exitCode) }
    if (patch.attempt !== undefined) { set.push('attempt = ?'); vals.push(patch.attempt) }
    if (patch.fixedByModel !== undefined) { set.push('fixed_by_model = ?'); vals.push(patch.fixedByModel ? 1 : 0) }
    if (patch.startedAt !== undefined) { set.push('started_at = ?'); vals.push(patch.startedAt) }
    if (patch.finishedAt !== undefined) { set.push('finished_at = ?'); vals.push(patch.finishedAt) }
    if (patch.durationMs !== undefined) { set.push('duration_ms = ?'); vals.push(patch.durationMs) }
    if (!set.length) { const r = this.db.prepare(`SELECT * FROM ci_run_steps WHERE id = ?`).get(stepId) as CiRunStepRow | undefined; return r ? mapCiRunStep(r) : null }
    this.db.prepare(`UPDATE ci_run_steps SET ${set.join(', ')} WHERE id = ?`).run(...vals, stepId)
    const r = this.db.prepare(`SELECT * FROM ci_run_steps WHERE id = ?`).get(stepId) as CiRunStepRow | undefined
    return r ? mapCiRunStep(r) : null
  }

  // --- Лог (потоковый, с монотонным seq для реплея) ---

  appendCiLog(runId: string, stepId: string, stream: 'stdout' | 'stderr' | 'system', chunk: string): CiLogLine {
    const at = this.now()
    const row = this.db.prepare(`SELECT COALESCE(MAX(seq), 0) AS m FROM ci_run_logs WHERE run_id = ?`).get(runId) as { m: number }
    const seq = row.m + 1
    this.db.prepare(`INSERT INTO ci_run_logs (id, run_id, step_id, seq, stream, chunk, at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(this.newId(), runId, stepId, seq, stream, chunk, at)
    return { runId, stepId, seq, stream, chunk, at }
  }

  getCiRunLog(userId: string, runId: string): CiLogLine[] {
    const r = this.db.prepare(`SELECT project_id FROM ci_runs WHERE id = ?`).get(runId) as { project_id: string } | undefined
    if (!r || !this.isProjectMember(userId, r.project_id)) return []
    return (this.db.prepare(`SELECT * FROM ci_run_logs WHERE run_id = ? ORDER BY seq ASC`).all(runId) as CiLogRow[]).map(mapCiLog)
  }

  // --- fix-loop ---

  // --- Интеракции рана (вопросы модели / одобрение плана) ---

  /** Создать паузу рана. Монотонный `seq` — как у лога, для устойчивого порядка. */
  addCiInteraction(args: {
    runId: string
    stepId: string
    kind: CiInteractionKind
    questions?: QuestionSpec[]
    planText?: string | null
    conversationId?: string | null
  }): CiInteraction {
    const id = this.newId()
    const row = this.db.prepare(`SELECT MAX(seq) AS m FROM ci_interactions WHERE run_id = ?`).get(args.runId) as { m: number | null }
    const seq = (row?.m ?? 0) + 1
    this.db
      .prepare(
        `INSERT INTO ci_interactions (id, run_id, step_id, seq, kind, questions_json, plan_text, status, conversation_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      )
      .run(id, args.runId, args.stepId, seq, args.kind, JSON.stringify(args.questions ?? []), args.planText ?? null, args.conversationId ?? null, this.now())
    return mapCiInteraction(this.db.prepare(`SELECT * FROM ci_interactions WHERE id = ?`).get(id) as CiInteractionRow)
  }

  getCiInteraction(id: string): CiInteraction | null {
    const r = this.db.prepare(`SELECT * FROM ci_interactions WHERE id = ?`).get(id) as CiInteractionRow | undefined
    return r ? mapCiInteraction(r) : null
  }

  listCiInteractions(runId: string): CiInteraction[] {
    return (this.db.prepare(`SELECT * FROM ci_interactions WHERE run_id = ? ORDER BY seq ASC`).all(runId) as CiInteractionRow[]).map(mapCiInteraction)
  }

  /** Запомнить id продублированного в чат сообщения. */
  setCiInteractionMessage(id: string, conversationId: string, messageId: string): void {
    this.db.prepare(`UPDATE ci_interactions SET conversation_id = ?, message_id = ? WHERE id = ?`).run(conversationId, messageId, id)
  }

  /**
   * Ответить на паузу. Условие `status = 'pending'` в WHERE делает первый ответ
   * победителем: второй (из ленты или из чата) не проходит и получает `null`.
   */
  answerCiInteraction(id: string, args: { userId: string; text?: string | null; decision?: CiPlanDecision | null }): CiInteraction | null {
    const changed = this.db
      .prepare(`UPDATE ci_interactions SET status = 'answered', answer_text = ?, decision = ?, answered_at = ?, answered_by = ? WHERE id = ? AND status = 'pending'`)
      .run(args.text ?? null, args.decision ?? null, this.now(), args.userId, id).changes
    return changed > 0 ? this.getCiInteraction(id) : null
  }

  /** Снять паузу без ответа (таймаут/отмена рана). */
  cancelCiInteraction(id: string): CiInteraction | null {
    this.db.prepare(`UPDATE ci_interactions SET status = 'cancelled', answered_at = ? WHERE id = ? AND status = 'pending'`).run(this.now(), id)
    return this.getCiInteraction(id)
  }

  addCiFixAttempt(args: { runStepId: string; attemptNo: number; diagnosis: string; action: string; result: CiFixAttempt['result']; diff?: string | null; changedFiles?: string[]; targetedTests?: CiTargetedTestRun[]; fullRerun?: CiFixAttempt['fullRerun']; failures?: CiTestFailure[]; durationMs?: number | null; tokensUsed?: number | null }): CiFixAttempt {
    const id = this.newId()
    this.db.prepare(`INSERT INTO ci_fix_attempts (id, run_step_id, attempt_no, diagnosis, action, result, diff, changed_files_json, targeted_tests_json, full_rerun_json, failures_json, duration_ms, tokens_used, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, args.runStepId, args.attemptNo, args.diagnosis, args.action, args.result, args.diff ?? null, JSON.stringify(args.changedFiles ?? []), JSON.stringify(args.targetedTests ?? []), args.fullRerun ? JSON.stringify(args.fullRerun) : null, JSON.stringify(args.failures ?? []), args.durationMs ?? null, args.tokensUsed ?? null, this.now())
    return mapCiFix(this.db.prepare(`SELECT * FROM ci_fix_attempts WHERE id = ?`).get(id) as CiFixRow)
  }

  // --- Расход модели по ходам рана ---

  /**
   * Записать расход одного хода CLI. Стоимость сохраняем только ту, что сообщил
   * сам CLI: оценку по прайсу отчёт считает на лету, иначе смена цен переписала
   * бы историю задним числом.
   */
  addCiRunUsage(args: {
    runId: string
    stepId: string | null
    kind: CiUsageKind
    provider: 'claude' | 'codex'
    model: string
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
    costUsd?: number | null
    durationMs?: number | null
    numTurns?: number | null
    /** Семантика `inputTokens`; по умолчанию — приведённая («вход без кэша»). */
    inputSemantics?: CiInputSemantics
  }): CiRunUsage {
    const id = this.newId()
    const at = this.now()
    this.db
      .prepare(
        `INSERT INTO ci_run_usage (id, run_id, step_id, kind, provider, model, input_tokens, output_tokens,
                                   cache_read_tokens, cache_creation_tokens, cost_usd, duration_ms, num_turns,
                                   input_semantics, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id, args.runId, args.stepId, args.kind, args.provider, args.model,
        Math.max(0, Math.round(args.inputTokens ?? 0)), Math.max(0, Math.round(args.outputTokens ?? 0)),
        Math.max(0, Math.round(args.cacheReadTokens ?? 0)), Math.max(0, Math.round(args.cacheCreationTokens ?? 0)),
        args.costUsd ?? null, args.durationMs ?? null, args.numTurns ?? null,
        args.inputSemantics ?? 'no_cache', at
      )
    return mapCiRunUsage(this.db.prepare(`SELECT * FROM ci_run_usage WHERE id = ?`).get(id) as CiRunUsageRow)
  }

  /** Строки расхода рана (в порядке ходов). Гейта нет: зовётся из отчётов. */
  listCiRunUsage(runId: string): CiRunUsage[] {
    return (this.db.prepare(`SELECT * FROM ci_run_usage WHERE run_id = ? ORDER BY at ASC, rowid ASC`).all(runId) as CiRunUsageRow[]).map(mapCiRunUsage)
  }

  /**
   * Прибавить вызовы инструментов хода к счётчику рана. Метрика, поэтому
   * упавшая запись гасится вызывающим — как и у расхода. Нулевые виды не пишем:
   * «нет строки» = «счётчика у рана нет», и отчёт должен уметь это отличать от
   * настоящего нуля вызовов.
   */
  addCiRunToolCalls(runId: string, calls: Partial<CiToolCalls>, chars?: Partial<CiToolChars>): void {
    const at = this.now()
    const upsert = this.db.prepare(
      `INSERT INTO ci_run_tool_calls (run_id, tool, calls, chars, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(run_id, tool) DO UPDATE SET calls = calls + excluded.calls,
         chars = chars + excluded.chars, updated_at = excluded.updated_at`
    )
    for (const kind of CI_TOOL_KINDS) {
      const n = calls[kind] ?? 0
      const c = Math.max(0, Math.round(chars?.[kind] ?? 0))
      // Объём без вызовов бывает: ответ пришёл, а вызов посчитан другим видом
      // (в `tool_result` имени инструмента нет) — такую строку писать надо.
      if (n > 0 || c > 0) upsert.run(runId, kind, Math.round(n), c, at)
    }
  }

  /** Счётчик вызовов инструментов рана; null — у рана его нет (ран до фичи). */
  ciRunToolCalls(runId: string): CiToolCalls | null {
    const rows = this.db.prepare(`SELECT tool, calls FROM ci_run_tool_calls WHERE run_id = ?`).all(runId) as Array<{ tool: string; calls: number }>
    if (!rows.length) return null
    const calls: CiToolCalls = { ...EMPTY_CI_TOOL_CALLS }
    for (const row of rows) {
      const kind = CI_TOOL_KINDS.find((k) => k === row.tool)
      if (kind) calls[kind] += row.calls
    }
    return calls
  }

  /**
   * Пробелы базы знаний, о которых сообщила модель (блок `kb-gaps` в её ответе).
   * Ключ — (ран, вопрос): fix-loop и следующие ходы называют тот же пробел
   * снова, а два одинаковых пункта в промпте шага актуализации дают две записи
   * об одном и том же. При повторе берётся более полный ответ: вторая попытка
   * обычно знает больше первой.
   *
   * Пробел без ответа не пишется вовсе — заносить в базу нечего (фильтрует
   * `parseKbGaps`). Метрика по духу: упавшую запись гасит вызывающий.
   */
  addCiRunKbGaps(runId: string, stepId: string | null, gaps: KbGapNote[]): void {
    const at = this.now()
    const upsert = this.db.prepare(
      `INSERT INTO ci_run_kb_gaps (run_id, question, answer, topic, step_id, at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id, question) DO UPDATE SET
         answer = CASE WHEN length(excluded.answer) > length(answer) THEN excluded.answer ELSE answer END,
         topic = COALESCE(excluded.topic, topic), step_id = excluded.step_id`
    )
    for (const gap of gaps) {
      if (!gap.question.trim() || !gap.answer.trim()) continue
      upsert.run(runId, gap.question.trim(), gap.answer.trim(), gap.topic?.trim() || null, stepId, at)
    }
  }

  /** Пробелы рана в порядке появления: раньше назван — раньше в промпте шага. */
  ciRunKbGaps(runId: string): KbGapNote[] {
    return (this.db
      .prepare(`SELECT question, answer, topic FROM ci_run_kb_gaps WHERE run_id = ? ORDER BY at ASC, rowid ASC`)
      .all(runId) as Array<{ question: string; answer: string; topic: string | null }>)
      .map((row) => ({ question: row.question, answer: row.answer, ...(row.topic ? { topic: row.topic } : {}) }))
  }

  /**
   * Вопросы рана, на которые база знаний не ответила вовсе (`empty`/`error`) —
   * объективная половина пробелов: она есть даже тогда, когда модель забыла
   * назвать пробел блоком `kb-gaps`. Один вопрос — одна строка (модель повторяет
   * запросы), а вопрос, который позже ВСЁ ЖЕ был отвечен тем же текстом, из
   * списка выпадает: там пробела нет, была неудачная попытка.
   */
  kbUsageRunGaps(runId: string, limit = 12): Array<{ query: string; reason: string }> {
    return (this.db
      .prepare(
        `SELECT q.query AS query, MAX(COALESCE(q.error, '')) AS reason, MIN(q.created_at) AS at
           FROM kb_usage_queries q
          WHERE q.ci_run_id = ? AND q.status IN ('empty', 'error')
            AND NOT EXISTS (SELECT 1 FROM kb_usage_queries d
                             WHERE d.ci_run_id = q.ci_run_id AND d.query = q.query AND d.status = 'delivered')
          GROUP BY q.query
          ORDER BY at ASC
          LIMIT ?`
      )
      .all(runId, Math.max(1, Math.min(limit, 50))) as Array<{ query: string; reason: string; at: number }>)
      .map((row) => ({ query: row.query, reason: row.reason || 'база знаний не ответила' }))
  }

  /**
   * Объём ответов инструментов рана (символы по видам); null — метрики у рана
   * нет. Ран до метрики и ран, где ответы были пустыми, — разные вещи: колонка
   * `chars` у старых строк нулевая, поэтому «нет строк» и «есть нули» различаем
   * по наличию строк самой таблицы.
   */
  ciRunToolChars(runId: string): CiToolChars | null {
    const rows = this.db.prepare(`SELECT tool, chars FROM ci_run_tool_calls WHERE run_id = ?`).all(runId) as Array<{ tool: string; chars: number }>
    if (!rows.length) return null
    const chars: CiToolChars = { ...EMPTY_CI_TOOL_CHARS }
    for (const row of rows) {
      const kind = CI_TOOL_KINDS.find((k) => k === row.tool)
      if (kind) chars[kind] += row.chars ?? 0
    }
    return chars
  }

  /**
   * Записать тяжёлый ответ инструмента и оставить у рана только верхушку по
   * объёму (`CI_TOOL_RESPONSES_KEEP`): это метрика «кто раздул контекст», а не
   * архив ленты — она и так целиком в `ci_run_logs`.
   */
  addCiRunToolResponse(args: {
    runId: string
    stepId: string | null
    tool: string
    kind: CiToolKind
    label: string
    chars: number
    originalChars?: number | null
  }): void {
    const id = this.newId()
    this.db.prepare(
      `INSERT INTO ci_run_tool_responses (id, run_id, step_id, tool, kind, label, chars, original_chars, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, args.runId, args.stepId, args.tool, args.kind, args.label.slice(0, 300),
      Math.max(0, Math.round(args.chars)), args.originalChars ?? null, this.now()
    )
    this.db.prepare(
      `DELETE FROM ci_run_tool_responses WHERE run_id = ? AND id NOT IN (
         SELECT id FROM ci_run_tool_responses WHERE run_id = ? ORDER BY chars DESC, at ASC LIMIT ?
       )`
    ).run(args.runId, args.runId, CI_TOOL_RESPONSES_KEEP)
  }

  /** Самые тяжёлые ответы инструментов рана — от тяжёлого к лёгкому. */
  ciRunToolResponses(runId: string, limit = CI_TOOL_RESPONSES_SHOWN): CiRunToolResponse[] {
    return (this.db.prepare(
      `SELECT * FROM ci_run_tool_responses WHERE run_id = ? ORDER BY chars DESC, at ASC LIMIT ?`
    ).all(runId, limit) as Array<{ step_id: string | null; tool: string; kind: string; label: string; chars: number; original_chars: number | null; at: number }>)
      .map((row) => ({
        tool: row.tool,
        kind: CI_TOOL_KINDS.find((k) => k === row.kind) ?? 'other',
        label: row.label,
        chars: row.chars,
        originalChars: row.original_chars,
        stepId: row.step_id,
        at: row.at
      }))
  }

  /** Финальный агрегат: список файлов остаётся в логе, в БД сохраняются только числа. */
  calculateAndSaveCiKbHit(runId: string): ReturnType<typeof calculateKbHit> {
    const sections = (this.db.prepare(
      `SELECT s.document_id, s.anchor, s.related_files FROM kb_usage_sections s
       JOIN kb_usage_queries q ON q.id = s.query_id
       WHERE q.ci_run_id = ? AND q.status = 'delivered' ORDER BY q.created_at, s.position`
    ).all(runId) as Array<{ document_id: string; anchor: string; related_files: string }>).map((row) => ({
      documentId: row.document_id, anchor: row.anchor, relatedFiles: parseStringArray(row.related_files)
    }))
    const chunks = (this.db.prepare(`SELECT chunk FROM ci_run_logs WHERE run_id = ? ORDER BY seq`).all(runId) as Array<{ chunk: string }>).map((row) => row.chunk)
    if (!chunks.length) return null
    const metric = calculateKbHit(sections, filesReadFromCiLog(chunks))
    if (!metric) return null
    this.db.prepare(`INSERT INTO ci_run_kb_metrics (run_id, sections_delivered, sections_hit, hit_ratio, calculated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET sections_delivered = excluded.sections_delivered,
      sections_hit = excluded.sections_hit, hit_ratio = excluded.hit_ratio, calculated_at = excluded.calculated_at`)
      .run(runId, metric.sectionsDelivered, metric.sectionsHit, metric.hitRatio, this.now())
    return metric
  }

  private ciKbHit(runId: string): { sectionsDelivered: number; sectionsHit: number; hitRatio: number } | null {
    const row = this.db.prepare(`SELECT sections_delivered, sections_hit, hit_ratio FROM ci_run_kb_metrics WHERE run_id = ?`).get(runId) as
      { sections_delivered: number; sections_hit: number; hit_ratio: number } | undefined
    return row ? { sectionsDelivered: row.sections_delivered, sectionsHit: row.sections_hit, hitRatio: row.hit_ratio } : null
  }

  /**
   * Отчёт по рану: сводка, агрегаты расхода и все шаги с длительностями. Гейт —
   * членство в проекте рана (как у ленты), поэтому чужой получает null → 404.
   * У старых ранов строк расхода нет: шаги и время на месте, расход — нули.
   */
  ciRunReport(userId: string, runId: string): CiRunReport | null {
    const run = this.getCiRunRaw(runId)
    if (!run || !this.isProjectMember(userId, run.projectId)) return null
    return this.buildCiRunReport(run)
  }

  /**
   * Отчёт по задаче: все её раны (повторы и отмены — тоже расход) и итог по ним.
   * Порядок — от свежего рана к старому, как в списке ранов задачи.
   */
  ciTaskReport(userId: string, projectId: string, taskId: string): CiTaskReport | null {
    if (!this.isProjectMember(userId, projectId)) return null
    if (!this.db.prepare(`SELECT 1 FROM tasks WHERE id = ? AND project_id = ?`).get(taskId, projectId)) return null
    const runs = (this.db
      .prepare(`SELECT * FROM ci_runs WHERE task_id = ? AND project_id = ? ORDER BY created_at DESC, rowid DESC`)
      .all(taskId, projectId) as CiRunRow[])
      .map((r) => this.buildCiRunReport(mapCiRun(r)))
    return { projectId, taskId, runs, ...ciTaskTotals(runs) }
  }

  private buildCiRunReport(run: CiRun): CiRunReport {
    const usage = this.listCiRunUsage(run.id)
    const byStep = new Map<string, CiRunUsage[]>()
    for (const u of usage) {
      if (!u.stepId) continue
      const list = byStep.get(u.stepId) ?? []
      list.push(u)
      byStep.set(u.stepId, list)
    }
    const steps: CiRunReportStep[] = (this.db
      .prepare(`SELECT * FROM ci_run_steps WHERE run_id = ? ORDER BY position ASC, id ASC`)
      .all(run.id) as CiRunStepRow[])
      .map(mapCiRunStep)
      .map((s) => ({
        id: s.id, parentStepId: s.parentStepId, title: s.title, slot: s.slot, kind: s.kind,
        initiatedBy: s.initiatedBy, status: s.status, attempt: s.attempt, fixedByModel: s.fixedByModel,
        exitCode: s.exitCode, durationMs: s.durationMs,
        usage: byStep.has(s.id) ? ciUsageTotals(byStep.get(s.id)!) : null
      }))
    const fixAttempts = (this.db
      .prepare(`SELECT COUNT(*) AS n FROM ci_fix_attempts f JOIN ci_run_steps s ON s.id = f.run_step_id WHERE s.run_id = ?`)
      .get(run.id) as { n: number }).n
    return {
      runId: run.id, projectId: run.projectId, taskId: run.taskId, status: run.status, mode: run.mode,
      provider: run.llmProvider, model: run.llmModel, startedAt: run.startedAt, finishedAt: run.finishedAt,
      durationMs: run.durationMs, createdAt: run.createdAt, fixAttempts,
      totals: ciUsageTotals(usage), stages: ciUsageStages(usage), steps, kbHit: this.ciKbHit(run.id),
      toolCalls: this.ciRunToolCalls(run.id),
      toolChars: this.ciRunToolChars(run.id),
      toolResponses: this.ciRunToolResponses(run.id)
    }
  }

  // --- Рабочие директории ---

  createCiWorkspace(args: { projectId: string; taskId: string; agentId: string | null; path: string }): CiWorkspace {
    const id = this.newId()
    this.db.prepare(`INSERT INTO ci_workspaces (id, project_id, task_id, agent_id, path, state, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?)`).run(id, args.projectId, args.taskId, args.agentId, args.path, this.now())
    return mapCiWorkspace(this.db.prepare(`SELECT * FROM ci_workspaces WHERE id = ?`).get(id) as CiWorkspaceRow)
  }

  getCiWorkspaceById(id: string): CiWorkspace | null {
    const r = this.db.prepare(`SELECT * FROM ci_workspaces WHERE id = ?`).get(id) as CiWorkspaceRow | undefined
    return r ? mapCiWorkspace(r) : null
  }

  findActiveCiWorkspace(projectId: string, taskId: string): CiWorkspace | null {
    const r = this.db.prepare(`SELECT * FROM ci_workspaces WHERE project_id = ? AND task_id = ? AND state = 'active' ORDER BY created_at DESC LIMIT 1`).get(projectId, taskId) as CiWorkspaceRow | undefined
    return r ? mapCiWorkspace(r) : null
  }

  findLatestCiWorkspace(projectId: string, taskId: string): CiWorkspace | null {
    const r = this.db.prepare(`SELECT * FROM ci_workspaces WHERE project_id = ? AND task_id = ? ORDER BY created_at DESC LIMIT 1`).get(projectId, taskId) as CiWorkspaceRow | undefined
    return r ? mapCiWorkspace(r) : null
  }

  /** Последний workspace с отправленной веткой — источник правды merge-рана.
   *  Более новая неотправленная запись (начатый dev-ран) его не заслоняет. */
  findLatestPushedCiWorkspace(projectId: string, taskId: string): CiWorkspace | null {
    const r = this.db.prepare(`SELECT * FROM ci_workspaces WHERE project_id = ? AND task_id = ? AND pushed = 1 ORDER BY created_at DESC LIMIT 1`).get(projectId, taskId) as CiWorkspaceRow | undefined
    return r ? mapCiWorkspace(r) : null
  }

  taskTimeline(userId: string, projectId: string, taskId: string): TaskTimeline | null {
    if (!this.getProject(userId, projectId)) return null
    const task = this.db.prepare(`SELECT id, created_at, updated_at, done_at FROM tasks WHERE id = ? AND project_id = ?`).get(taskId, projectId) as { id: string; created_at: number; updated_at: number; done_at: number | null } | undefined
    if (!task) return null

    type Raw = {
      id: string; type: string; title: string; status: string; attempt: number
      queued: number | null; started: number | null; finished: number | null
      executor: string | null; machine: string | null; model: string | null
      reason_code: string | null; reason_message: string | null; kind: string
      position: number | null
    }
    const rows: Raw[] = []
    const append = (sql: string): void => {
      rows.push(...this.db.prepare(sql).all(taskId) as Raw[])
    }

    append(`SELECT r.id, 'development' type, 'Development' title, r.status, ROW_NUMBER() OVER (ORDER BY r.created_at, r.id) attempt,
      r.created_at queued, r.started_at started, r.finished_at finished, r.triggered_by executor, a.name machine,
      (SELECT NULLIF(u.model, '') FROM ci_run_usage u WHERE u.run_id=r.id ORDER BY u.at LIMIT 1) model,
      NULL reason_code, NULL reason_message, 'ci' kind, 20 position
      FROM ci_runs r LEFT JOIN agents a ON a.id=r.agent_id WHERE r.task_id=?`)
    append(`SELECT s.id, 'development_step:' || COALESCE(s.command_id, s.kind || ':' || s.title) type, s.title,
      s.status, s.attempt, NULL queued, s.started_at started, s.finished_at finished, r.triggered_by executor, a.name machine,
      (SELECT NULLIF(u.model, '') FROM ci_run_usage u WHERE u.run_id=r.id AND u.step_id=s.id ORDER BY u.at LIMIT 1) model,
      CASE WHEN s.status IN ('failed','timeout','cancelled','skipped') THEN 'step_' || s.status END reason_code,
      CASE WHEN s.exit_code IS NOT NULL AND s.exit_code <> 0 THEN 'exit ' || s.exit_code END reason_message,
      'ci_step' kind, 21 position FROM ci_run_steps s JOIN ci_runs r ON r.id=s.run_id LEFT JOIN agents a ON a.id=r.agent_id WHERE r.task_id=?`)
    append(`SELECT r.id, 'task_preparation' type, 'Создание и подготовка задачи' title, r.status, r.attempt,
      r.created_at queued, NULL started, r.finished_at finished, NULL executor, NULL machine, NULL model,
      CASE WHEN r.error IS NOT NULL THEN 'preparation_error' END reason_code, r.error reason_message, 'task_preparation' kind, 10 position
      FROM task_preparation_runs r WHERE r.task_id=?`)
    append(`SELECT r.id, 'component_qa' type, 'Component QA' title, r.status, r.attempt,
      r.created_at queued, r.started_at started, r.finished_at finished, NULL executor, NULL machine, NULL model,
      r.failure_classification reason_code, CASE WHEN length(r.blocker_reasons_json)>2 THEN r.blocker_reasons_json END reason_message,
      'component_qa' kind, 30 position FROM component_qa_runs r WHERE r.task_id=?`)
    append(`SELECT r.id, 'integration_tests' type, 'Создание и запуск интеграционных тестов' title, r.status, r.attempt,
      r.created_at queued, r.started_at started, r.finished_at finished, NULL executor, NULL machine, NULL model,
      r.failure_classification reason_code, COALESCE(r.failure_reason, r.stale_reason) reason_message,
      'integration_tests' kind, 40 position FROM integration_test_runs r WHERE r.task_id=?`)
    append(`SELECT r.id, r.stage type,
      CASE r.stage WHEN 'automated_qa' THEN 'Automated QA' WHEN 'component_qa' THEN 'Component QA' ELSE 'Интеграционные тесты' END title,
      r.status, r.attempt, r.created_at queued, r.started_at started, r.finished_at finished, r.triggered_by executor,
      NULL machine, NULLIF(r.llm_model,'') model,
      CASE WHEN r.error IS NOT NULL THEN 'qa_error' WHEN length(r.gate_reasons_json)>2 THEN 'gate_failed' END reason_code,
      COALESCE(r.error, CASE WHEN length(r.gate_reasons_json)>2 THEN r.gate_reasons_json END) reason_message,
      'qa_stage' kind, CASE r.stage WHEN 'component_qa' THEN 30 WHEN 'integration_tests' THEN 40 ELSE 50 END position
      FROM qa_stage_runs r WHERE r.task_id=?`)
    append(`SELECT r.id, 'manual_qa_preparation' type, 'Подготовка ручного тестирования' title, r.status, r.attempt,
      r.created_at queued, NULL started, r.finished_at finished, NULL executor, NULL machine, NULL model,
      CASE WHEN r.error IS NOT NULL THEN 'qa_preparation_error' END reason_code, r.error reason_message,
      'qa_preparation' kind, 60 position FROM qa_preparation_runs r WHERE r.task_id=?`)
    append(`SELECT r.id, 'manual_qa' type, 'Ручное тестирование' title, r.status,
      ROW_NUMBER() OVER (ORDER BY r.started_at, r.id) attempt, NULL queued, r.started_at started, r.finished_at finished,
      COALESCE(r.tester_id,r.initiated_by) executor, NULL machine, NULL model,
      CASE WHEN r.stale_reason IS NOT NULL THEN 'stale' END reason_code, r.stale_reason reason_message,
      'qa_session' kind, 70 position FROM qa_sessions r WHERE r.task_id=?`)
    append(`SELECT r.id, 'merge' type, 'Merge и push' title, r.status,
      ROW_NUMBER() OVER (ORDER BY r.created_at, r.id) attempt, r.created_at queued, r.started_at started, r.finished_at finished,
      r.triggered_by executor, a.name machine, NULL model,
      CASE WHEN r.error IS NOT NULL THEN 'merge_error' END reason_code, r.error reason_message,
      'merge' kind, 80 position FROM merge_runs r LEFT JOIN agents a ON a.id=r.agent_id WHERE r.task_id=?`)

    const normalize = (status: string): TaskTimelineStatus => {
      if (status === 'queued') return 'queued'
      if (status === 'running' || status === 'active' || ['checking','fetching','merging','resolving_conflicts','kb_update','testing','pushing'].includes(status)) return 'running'
      if (status === 'awaiting_input') return 'awaiting_input'
      if (['success','passed','done'].includes(status)) return 'succeeded'
      if (status === 'cancelled') return 'cancelled'
      if (status === 'skipped') return 'skipped'
      return 'failed'
    }
    const waitingRows = this.db.prepare(`SELECT i.run_id, i.created_at started, i.answered_at finished
      FROM ci_interactions i JOIN ci_runs r ON r.id=i.run_id WHERE r.task_id=? ORDER BY i.seq`).all(taskId) as Array<{ run_id: string; started: number; finished: number | null }>
    const toInterval = (start: number, end: number | null) => ({ startedAt: timelineIso(start)!, finishedAt: timelineIso(end), durationMs: timelineDuration(start, end) })
    const attempts = rows.map((row): TaskTimelineAttempt & { _position: number | null; _type: string; _title: string; _rawStart: number | null; _rawFinish: number | null; _active: Array<{ start: number; end: number | null }>; _queue: Array<{ start: number; end: number | null }>; _waiting: Array<{ start: number; end: number | null }> } => {
      const waiting = row.kind === 'ci' ? waitingRows.filter((item) => item.run_id === row.id).map((item) => ({ start: item.started, end: item.finished })) : []
      const active = row.started == null ? [] : subtractTimelineIntervals([{ start: row.started, end: row.finished }], waiting)
      const queue = row.queued != null && row.started != null ? [{ start: row.queued, end: row.started }] : []
      const status = normalize(row.status)
      return {
        id: `${row.kind}:${row.id}`, number: row.attempt, status,
        queuedAt: timelineIso(row.queued), startedAt: timelineIso(row.started), finishedAt: timelineIso(row.finished),
        queueIntervals: queue.map((item) => toInterval(item.start, item.end)),
        activeIntervals: active.map((item) => toInterval(item.start, item.end)),
        awaitingInputIntervals: waiting.map((item) => toInterval(item.start, item.end)),
        queueDuration: queue.length ? mergedTimelineDuration(queue) : row.queued == null || row.started == null ? null : 0,
        activeDuration: row.started == null ? null : mergedTimelineDuration(active),
        awaitingInputDuration: waiting.length ? mergedTimelineDuration(waiting) : 0,
        calendarDuration: timelineDuration(row.queued ?? row.started, row.finished),
        executor: row.executor, machine: row.machine, model: row.model,
        reason: row.reason_code || row.reason_message ? { code: row.reason_code, message: row.reason_message } : null,
        runs: [{ id: row.id, kind: row.kind }],
        dataComplete: row.started != null && (row.finished != null || ['running','awaiting_input'].includes(status)),
        _position: row.position, _type: row.type, _title: row.title, _rawStart: row.started, _rawFinish: row.finished,
        _active: active, _queue: queue, _waiting: waiting
      }
    })

    const grouped = new Map<string, typeof attempts>()
    for (const attempt of attempts) grouped.set(attempt._type, [...(grouped.get(attempt._type) ?? []), attempt])
    const stages: TaskTimelineStage[] = [...grouped.entries()].map(([type, items]) => {
      items.sort((a, b) => a.number - b.number || a.id.localeCompare(b.id))
      const latest = items[items.length - 1]
      const starts = items.map((item) => item._rawStart).filter((value): value is number => value != null)
      const finishes = items.map((item) => item._rawFinish).filter((value): value is number => value != null)
      const queued = items.map((item) => item.queuedAt ? Date.parse(item.queuedAt) : null).filter((value): value is number => value != null)
      const allTerminal = items.every((item) => ['succeeded','failed','cancelled','skipped'].includes(item.status))
      return {
        id: `stage:${type}`, type, title: latest._title, status: latest.status,
        queuedAt: timelineIso(queued.length ? Math.min(...queued) : null),
        startedAt: timelineIso(starts.length ? Math.min(...starts) : null),
        finishedAt: timelineIso(allTerminal && finishes.length ? Math.max(...finishes) : null),
        queueDuration: items.some((item) => item.queueDuration != null) ? mergedTimelineDuration(items.flatMap((item) => item._queue)) : null,
        activeDuration: items.some((item) => item.activeDuration != null) ? mergedTimelineDuration(items.flatMap((item) => item._active)) : null,
        awaitingInputDuration: mergedTimelineDuration(items.flatMap((item) => item._waiting)),
        calendarDuration: timelineDuration(queued.length ? Math.min(...queued) : starts.length ? Math.min(...starts) : null, allTerminal && finishes.length ? Math.max(...finishes) : null),
        attemptCount: items.filter((item) => item.status !== 'skipped' || item.runs.length > 0).length,
        successfulDuration: items.filter((item) => item.status === 'succeeded').reduce((sum, item) => sum + (item.calendarDuration ?? 0), 0),
        unsuccessfulDuration: items.filter((item) => ['failed','cancelled'].includes(item.status)).reduce((sum, item) => sum + (item.calendarDuration ?? 0), 0),
        executor: latest.executor, machine: latest.machine, model: latest.model, reason: latest.reason,
        runs: items.flatMap((item) => item.runs), attempts: items.map(({ _position, _type, _title, _rawStart, _rawFinish, _active, _queue, _waiting, ...attempt }) => attempt),
        workflowPosition: latest._position, dataComplete: items.every((item) => item.dataComplete)
      }
    }).sort((a, b) => (a.workflowPosition ?? Number.MAX_SAFE_INTEGER) - (b.workflowPosition ?? Number.MAX_SAFE_INTEGER)
      || (a.queuedAt || a.startedAt ? Date.parse(a.queuedAt ?? a.startedAt!) : task.created_at)
        - (b.queuedAt || b.startedAt ? Date.parse(b.queuedAt ?? b.startedAt!) : task.created_at)
      || a.id.localeCompare(b.id))

    if (task.done_at != null) stages.push({
      id: 'stage:completion', type: 'completion', title: 'Завершение', status: 'succeeded',
      queuedAt: null, startedAt: timelineIso(task.done_at), finishedAt: timelineIso(task.done_at),
      queueDuration: null, activeDuration: 0, awaitingInputDuration: 0, calendarDuration: 0,
      attemptCount: 0, successfulDuration: 0, unsuccessfulDuration: 0, executor: null, machine: null, model: null,
      reason: null, runs: [], attempts: [], workflowPosition: 100, dataComplete: true
    })
    const starts = attempts.map((item) => item._rawStart).filter((value): value is number => value != null)
    const facts = [task.created_at, task.updated_at, task.done_at, ...rows.flatMap((row) => [row.queued, row.started, row.finished]), ...waitingRows.flatMap((row) => [row.started, row.finished])]
      .filter((value): value is number => value != null)
    return {
      version: 1, taskId, generatedAt: new Date(this.now()).toISOString(),
      summary: {
        createdAt: timelineIso(task.created_at)!,
        firstStartedAt: timelineIso(starts.length ? Math.min(...starts) : null),
        finishedAt: timelineIso(task.done_at),
        calendarDuration: timelineDuration(task.created_at, task.done_at),
        activeDuration: mergedTimelineDuration(attempts.flatMap((item) => item._active)),
        queueDuration: mergedTimelineDuration(attempts.flatMap((item) => item._queue)),
        awaitingInputDuration: mergedTimelineDuration(attempts.flatMap((item) => item._waiting)),
        lastChangedAt: timelineIso(Math.max(...facts))!
      },
      stages
    }
  }

  findLatestCiRunForTask(projectId: string, taskId: string): CiRun | null {
    const row = this.db.prepare(`SELECT id FROM ci_runs WHERE project_id=? AND task_id=? ORDER BY created_at DESC LIMIT 1`).get(projectId, taskId) as { id:string } | undefined
    return row ? this.getCiRunRaw(row.id) : null
  }

  recordCiWorkspaceRevision(workspaceId: string, branch: string, commitSha: string): void {
    this.db.prepare(`UPDATE ci_workspaces SET branch=?, commit_sha=?, pushed=1 WHERE id=?`).run(branch, commitSha, workspaceId)
  }

  releaseCiWorkspace(workspaceId: string, releasedByStepId: string | null): void {
    this.db.prepare(`UPDATE ci_workspaces SET state = 'released', released_by_step_id = ? WHERE id = ?`).run(releasedByStepId, workspaceId)
  }

  setCiWorkspaceSize(workspaceId: string, sizeBytes: number): void {
    this.db.prepare(`UPDATE ci_workspaces SET size_bytes = ? WHERE id = ?`).run(sizeBytes, workspaceId)
  }

  /** Отчёт по занятому месту: активные + осиротевшие (задача закрыта/удалена). */
  listCiWorkspaceReport(userId: string, projectId?: string): CiWorkspaceReportItem[] {
    const rows = (projectId
      ? this.db.prepare(`SELECT * FROM ci_workspaces WHERE project_id = ? ORDER BY created_at DESC`).all(projectId)
      : this.db.prepare(`SELECT * FROM ci_workspaces ORDER BY created_at DESC`).all()) as CiWorkspaceRow[]
    const out: CiWorkspaceReportItem[] = []
    for (const r of rows) {
      if (!this.isProjectMember(userId, r.project_id)) continue
      const task = this.db.prepare(`SELECT t.title, c.semantic_type FROM tasks t LEFT JOIN kanban_columns c ON c.id = t.column_id WHERE t.id = ?`).get(r.task_id) as { title: string; semantic_type: string } | undefined
      const taskClosed = !task || task.semantic_type === 'done'
      out.push({ ...mapCiWorkspace(r), taskTitle: task?.title ?? null, orphaned: r.state === 'active' && taskClosed })
    }
    return out
  }

  // --- Предложения модели ---

  addCiSuggestion(args: { commandId: string; runStepId: string | null; reason: string; proposedScript: string }): CiCommandSuggestion {
    // Однотипные (та же команда + та же причина) группируются со счётчиком.
    const existing = this.db.prepare(`SELECT * FROM ci_command_suggestions WHERE command_id = ? AND reason = ? AND status = 'new'`).get(args.commandId, args.reason) as CiSuggestionRow | undefined
    if (existing) {
      this.db.prepare(`UPDATE ci_command_suggestions SET occurrences = occurrences + 1, proposed_script = ?, run_step_id = ? WHERE id = ?`).run(args.proposedScript, args.runStepId, existing.id)
      return mapCiSuggestion(this.db.prepare(`SELECT * FROM ci_command_suggestions WHERE id = ?`).get(existing.id) as CiSuggestionRow)
    }
    const id = this.newId()
    this.db.prepare(`INSERT INTO ci_command_suggestions (id, command_id, run_step_id, reason, proposed_script, status, occurrences, created_at) VALUES (?, ?, ?, ?, ?, 'new', 1, ?)`).run(id, args.commandId, args.runStepId, args.reason, args.proposedScript, this.now())
    return mapCiSuggestion(this.db.prepare(`SELECT * FROM ci_command_suggestions WHERE id = ?`).get(id) as CiSuggestionRow)
  }

  listCiSuggestions(userId: string, projectId?: string): CiCommandSuggestion[] {
    const rows = this.db.prepare(`SELECT s.* FROM ci_command_suggestions s JOIN ci_commands c ON c.id = s.command_id WHERE s.status = 'new' ORDER BY s.created_at DESC`).all() as Array<CiSuggestionRow>
    return rows.filter((s) => {
      const c = this.db.prepare(`SELECT scope, project_id FROM ci_commands WHERE id = ?`).get(s.command_id) as { scope: string; project_id: string | null } | undefined
      if (!c) return false
      if (c.scope === 'global') return true
      return c.project_id ? this.isProjectMember(userId, c.project_id) && (!projectId || c.project_id === projectId) : false
    }).map(mapCiSuggestion)
  }

  countNewCiSuggestions(commandId: string): number {
    const r = this.db.prepare(`SELECT COUNT(*) AS n FROM ci_command_suggestions WHERE command_id = ? AND status = 'new'`).get(commandId) as { n: number }
    return r.n
  }

  resolveCiSuggestion(userId: string, id: string, accept: boolean): CiCommandSuggestion | null {
    const s = this.db.prepare(`SELECT * FROM ci_command_suggestions WHERE id = ?`).get(id) as CiSuggestionRow | undefined
    if (!s) return null
    this.db.transaction(() => {
      this.db.prepare(`UPDATE ci_command_suggestions SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`).run(accept ? 'accepted' : 'rejected', userId, this.now(), id)
      if (accept) {
        // Принятие создаёт новую версию команды (текст скрипта заменяется).
        this.db.prepare(`UPDATE ci_commands SET script = ?, version = version + 1, updated_at = ? WHERE id = ?`).run(s.proposed_script, this.now(), s.command_id)
      }
    })()
    return mapCiSuggestion(this.db.prepare(`SELECT * FROM ci_command_suggestions WHERE id = ?`).get(id) as CiSuggestionRow)
  }

  // --- Аудит / история ---

  addCiEvent(args: { projectId: string; runId?: string | null; commandId?: string | null; type: string; actorType: CiEventActor; actorId?: string | null; payload?: Record<string, unknown> }): void {
    this.db.prepare(`INSERT INTO ci_events (id, project_id, run_id, command_id, type, actor_type, actor_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(this.newId(), args.projectId, args.runId ?? null, args.commandId ?? null, args.type, args.actorType, args.actorId ?? null, JSON.stringify(args.payload ?? {}), this.now())
  }

  // --- Метрики (на лету, окно metrics_window) ---

  ciCommandMetrics(userId: string, projectId: string): CiCommandMetric[] {
    if (!this.isProjectMember(userId, projectId)) return []
    const window = this.getCiSettings().metricsWindow
    const cmds = this.db.prepare(`SELECT DISTINCT command_id FROM ci_run_steps s JOIN ci_runs r ON r.id = s.run_id WHERE r.project_id = ? AND s.command_id IS NOT NULL AND s.kind = 'command'`).all(projectId) as Array<{ command_id: string }>
    const out: CiCommandMetric[] = []
    for (const { command_id } of cmds) {
      const rows = this.db.prepare(`SELECT s.status, s.duration_ms FROM ci_run_steps s JOIN ci_runs r ON r.id = s.run_id WHERE r.project_id = ? AND s.command_id = ? AND s.kind = 'command' AND s.status IN ('success','failed','timeout') ORDER BY s.finished_at DESC LIMIT ?`).all(projectId, command_id, window) as Array<{ status: string; duration_ms: number | null }>
      if (!rows.length) continue
      const succ = rows.filter((r) => r.status === 'success' && r.duration_ms != null).map((r) => r.duration_ms as number).sort((a, b) => a - b)
      const median = succ.length ? succ[Math.floor((succ.length - 1) / 2)] : null
      const avg = succ.length ? Math.round(succ.reduce((a, b) => a + b, 0) / succ.length) : null
      const p90 = succ.length ? succ[Math.min(succ.length - 1, Math.floor(succ.length * 0.9))] : null
      const successRate = rows.length ? rows.filter((r) => r.status === 'success').length / rows.length : 0
      out.push({ projectId, commandId: command_id, medianMs: median, avgMs: avg, p90Ms: p90, samples: succ.length, successRate })
    }
    return out
  }

  ciModelWorkMetric(userId: string, projectId: string): CiModelWorkMetric {
    if (!this.isProjectMember(userId, projectId)) return { projectId, avgMs: null, samples: 0 }
    const rows = this.db.prepare(`SELECT s.duration_ms FROM ci_run_steps s JOIN ci_runs r ON r.id = s.run_id WHERE r.project_id = ? AND s.kind = 'model_work' AND s.status = 'success' AND s.duration_ms IS NOT NULL ORDER BY s.finished_at DESC LIMIT 10`).all(projectId) as Array<{ duration_ms: number }>
    if (!rows.length) return { projectId, avgMs: null, samples: 0 }
    return { projectId, avgMs: Math.round(rows.reduce((a, r) => a + r.duration_ms, 0) / rows.length), samples: rows.length }
  }

  /**
   * Последний актуальный процесс среди всех workflow-ранов задачи. Новый старт
   * сразу вытесняет прежнюю ошибку. cancelled нейтрален, stale считается skipped.
   */
  latestTaskRunResult(taskId: string): TaskRunResult | null {
    const row = this.db.prepare(`
      SELECT id, kind, status, created_at, finished_at FROM (
        SELECT id, 'preparation' kind, status, created_at, finished_at, rowid seq, 1 rank FROM task_preparation_runs WHERE task_id = ?
        UNION ALL SELECT id, 'development', status, created_at, finished_at, rowid, 2 FROM ci_runs WHERE task_id = ?
        UNION ALL SELECT id, stage, status, created_at, finished_at, rowid, 3 FROM qa_stage_runs WHERE task_id = ?
        UNION ALL SELECT id, 'component_qa', status, created_at, finished_at, rowid, 4 FROM component_qa_runs WHERE task_id = ?
        UNION ALL SELECT id, 'integration_tests', status, created_at, finished_at, rowid, 5 FROM integration_test_runs WHERE task_id = ?
        UNION ALL SELECT id, 'qa_preparation', status, created_at, finished_at, rowid, 6 FROM qa_preparation_runs WHERE task_id = ?
        UNION ALL SELECT id, 'manual_qa', status, started_at, finished_at, rowid, 7 FROM qa_sessions WHERE task_id = ?
        UNION ALL SELECT id, 'merge', status, created_at, finished_at, rowid, 8 FROM merge_runs WHERE task_id = ?
      ) ORDER BY created_at DESC,
        CASE WHEN status IN ('queued','running','awaiting_input','waiting_for_answer','validating','active','checking','fetching','merging','resolving_conflicts','kb_update','testing','pushing','deploying','production_checks','rolling_back') THEN 1 ELSE 0 END DESC,
        seq DESC, rank DESC LIMIT 1
    `).get(taskId, taskId, taskId, taskId, taskId, taskId, taskId, taskId) as
      | { id: string; kind: TaskRunResult['kind']; status: string; created_at: number; finished_at: number | null }
      | undefined
    if (!row) return null

    return { id: row.id, kind: row.kind, status: row.status, outcome: normalizeTaskRunOutcome(row.status), createdAt: row.created_at, finishedAt: row.finished_at }
  }

  /**
   * Единый серверный селектор состояния задачи. Активный ран всегда главный.
   * Отмена/skip остаются последней попыткой, но не вытесняют предыдущий успех.
   * Терминальные ошибки и отмены актуальны лишь в колонке, зафиксированной при
   * завершении; ручной перенос немедленно убирает их с поверхностей задачи.
   */
  latestCiRunSummaries(projectId: string): CiRunSummary[] {
    const rows = this.db.prepare(`SELECT * FROM ci_runs WHERE project_id = ? ORDER BY created_at DESC, rowid DESC`).all(projectId) as CiRunRow[]
    const columns = new Map((this.db.prepare(`SELECT id, column_id FROM tasks WHERE project_id = ?`).all(projectId) as Array<{ id: string; column_id: string }>).map((r) => [r.id, r.column_id]))
    const grouped = new Map<string, CiRunRow[]>()
    for (const row of rows) grouped.set(row.task_id, [...(grouped.get(row.task_id) ?? []), row])
    const out: CiRunSummary[] = []
    for (const [taskId, taskRows] of grouped) {
      const summary = this.taskCiDisplaySummary(taskRows, columns.get(taskId) ?? null)
      if (summary) out.push(summary)
    }
    return out
  }

  /** Единая отображаемая сводка одной задачи; null — значимого результата нет. */
  latestCiRunSummary(taskId: string): CiRunSummary | null {
    const rows = this.db.prepare(`SELECT * FROM ci_runs WHERE task_id = ? ORDER BY created_at DESC, rowid DESC`).all(taskId) as CiRunRow[]
    const task = this.db.prepare(`SELECT column_id FROM tasks WHERE id = ?`).get(taskId) as { column_id: string } | undefined
    return this.taskCiDisplaySummary(rows, task?.column_id ?? null)
  }

  private taskCiDisplaySummary(rows: CiRunRow[], currentColumnId: string | null): CiRunSummary | null {
    const active = rows.find((row) => ['queued', 'running', 'awaiting_input'].includes(row.status))
    if (active) return this.ciRunSummary(active)
    const latest = rows[0]
    const relevant = (row: CiRunRow): boolean =>
      row.status === 'success' || (row.terminal_column_id != null && row.terminal_column_id === currentColumnId)
    let primary = rows.find((row) => relevant(row) && row.status !== 'cancelled' && row.status !== 'skipped')
    if (!primary && latest && relevant(latest)) primary = latest
    if (!primary) return null
    const summary = this.ciRunSummary(primary)
    if (latest && relevant(latest) && latest.id !== primary.id && (latest.status === 'cancelled' || latest.status === 'skipped')) {
      summary.latestAttempt = this.ciRunSummary(latest)
    }
    return summary
  }

  private ciRunSummary(row: CiRunRow): CiRunSummary {
    const run = mapCiRun(row)
    const stepRows = this.db.prepare(`SELECT * FROM ci_run_steps WHERE run_id = ? ORDER BY position ASC, id ASC`).all(row.id) as CiRunStepRow[]
    const steps = stepRows.map(mapCiRunStep)
    const modelActive = run.status === 'running' && steps.some((step) => step.kind === 'model_work' && step.status === 'running')
    const historyRows = this.db.prepare(`
      SELECT s.title, s.duration_ms
      FROM ci_run_steps s
      JOIN ci_runs r ON r.id = s.run_id
      WHERE r.project_id = ? AND r.status = 'success' AND s.status = 'success'
        AND s.duration_ms IS NOT NULL AND s.duration_ms > 0
      ORDER BY r.finished_at DESC
      LIMIT 200
    `).all(row.project_id) as Array<{ title: string; duration_ms: number }>
    const history: Record<string, number[]> = {}
    for (const item of historyRows) (history[item.title] ??= []).push(item.duration_ms)
    return {
      id: run.id,
      taskId: run.taskId,
      status: run.status,
      slotProgress: run.slotProgress,
      durationMs: run.durationMs,
      modelActive,
      awaitingInput: run.status === 'awaiting_input',
      progress: buildCiAutomationProgress(run, steps, history),
      executionLlm: this.ciExecutionLlm(run, this.listCiStageRuns(run.id)),
      terminalColumnId: run.terminalColumnId
    }
  }

  // ---- Использование базы знаний (телеметрия обращений модели) -----------
  //
  // Пишем только то, что видела модель: авто-инъекцию контекста перед ходом и
  // вызовы mcp__kb__*. Статус `pending` в БД не хранится — он живёт лишь в
  // WS-кадре, а строка появляется один раз, уже терминальной (нет UPDATE-мусора
  // и висящих pending после падения процесса).

  /** Записать состоявшееся обращение. `seq` монотонен внутри разговора. */
  addKbUsage(args: {
    /** Заранее сгенерированный id: тот же, что ушёл в кадр `pending`. */
    id?: string
    userId: string
    conversationId: string
    /** Снимок проекта на момент обращения (чат может сменить проект позже). */
    projectId?: string | null
    turnId?: string | null
    messageId?: string | null
    /** Ран и шаг CI-раннера, если обращение случилось в ходе рана. */
    ciRunId?: string | null
    ciStepId?: string | null
    source: KbUsageSource
    status?: Exclude<KbUsageStatus, 'pending'>
    query: string
    confidence?: 'high' | 'medium' | 'low' | null
    injected?: boolean
    /** Точная длина текста, пришедшего модели. */
    chars: number
    bundleTokens?: number | null
    promptChars?: number | null
    turnInputTokens?: number | null
    durationMs?: number | null
    error?: string | null
    sections?: Array<{
      documentId: string
      title?: string
      heading?: string
      anchor?: string
      sourcePath?: string
      relatedFiles?: string[]
      chars: number
      score?: number | null
      matchTypes?: KbMatchType[]
      freshness?: KbFreshness
    }>
  }): KbUsageQuery {
    const id = args.id ?? this.newId()
    const createdAt = this.now()
    const status = args.status ?? 'delivered'
    const estTokens = estimateKbTokens(args.chars)
    const sections: KbUsageSectionRef[] = (args.sections ?? []).map((item) => ({
      documentId: item.documentId,
      title: item.title ?? '',
      heading: item.heading ?? '',
      anchor: item.anchor ?? '',
      sourcePath: item.sourcePath ?? '',
      relatedFiles: item.relatedFiles ?? [],
      chars: item.chars,
      estimatedTokens: estimateKbTokens(item.chars),
      score: item.score ?? null,
      matchTypes: item.matchTypes ?? [],
      freshness: item.freshness ?? 'unknown'
    }))
    const insertQuery = this.db.prepare(
      `INSERT INTO kb_usage_queries (id, seq, user_id, conversation_id, project_id, turn_id, message_id, ci_run_id,
         ci_step_id, source, status, query, confidence, injected, sections_count, chars, est_tokens, bundle_tokens,
         prompt_chars, turn_input_tokens, duration_ms, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const insertSection = this.db.prepare(
      `INSERT INTO kb_usage_sections (id, query_id, document_id, title, heading, anchor, source_path, related_files, chars, est_tokens,
         score, match_types, freshness, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    // Одна транзакция: MAX(seq)+1 считается внутри неё, иначе параллельные
    // обращения одного разговора получили бы один и тот же курсор.
    let seq = 0
    this.db.transaction(() => {
      const row = this.db
        .prepare(`SELECT COALESCE(MAX(seq), 0) AS m FROM kb_usage_queries WHERE conversation_id = ?`)
        .get(args.conversationId) as { m: number }
      seq = row.m + 1
      insertQuery.run(
        id, seq, args.userId, args.conversationId, args.projectId ?? null, args.turnId ?? null, args.messageId ?? null,
        args.ciRunId ?? null, args.ciStepId ?? null,
        args.source, status, args.query, args.confidence ?? null, args.injected ? 1 : 0, sections.length, args.chars,
        estTokens, args.bundleTokens ?? null, args.promptChars ?? null, args.turnInputTokens ?? null,
        args.durationMs ?? null, args.error ?? null, createdAt
      )
      sections.forEach((section, position) => {
        insertSection.run(
          this.newId(), id, section.documentId, section.title, section.heading, section.anchor, section.sourcePath, JSON.stringify(section.relatedFiles),
          section.chars, section.estimatedTokens, section.score, JSON.stringify(section.matchTypes), section.freshness,
          position
        )
      })
    })()
    return {
      id,
      seq,
      conversationId: args.conversationId,
      projectId: args.projectId ?? null,
      turnId: args.turnId ?? null,
      messageId: args.messageId ?? null,
      ciRunId: args.ciRunId ?? null,
      ciStepId: args.ciStepId ?? null,
      source: args.source,
      status,
      query: args.query,
      confidence: args.confidence ?? null,
      injected: Boolean(args.injected),
      sectionsCount: sections.length,
      chars: args.chars,
      estimatedTokens: estTokens,
      bundleTokens: args.bundleTokens ?? null,
      promptChars: args.promptChars ?? null,
      turnInputTokens: args.turnInputTokens ?? null,
      durationMs: args.durationMs ?? null,
      error: args.error ?? null,
      createdAt,
      sections
    }
  }

  /**
   * Дописать в обращения хода итоги самого хода: id сохранённого сообщения,
   * размер промпта и суммарный вход. Известны они только после `claude.done`,
   * а обращения записаны раньше — поэтому отдельный шаг, а не поле в addKbUsage.
   */
  attachKbUsageTurn(args: { turnId: string; messageId?: string | null; promptChars?: number | null; turnInputTokens?: number | null }): number {
    const set: string[] = []
    const vals: unknown[] = []
    if (args.messageId !== undefined) { set.push('message_id = ?'); vals.push(args.messageId) }
    if (args.promptChars !== undefined) { set.push('prompt_chars = ?'); vals.push(args.promptChars) }
    if (args.turnInputTokens !== undefined) { set.push('turn_input_tokens = ?'); vals.push(args.turnInputTokens) }
    if (!set.length) return 0
    const info = this.db.prepare(`UPDATE kb_usage_queries SET ${set.join(', ')} WHERE turn_id = ?`).run(...vals, args.turnId)
    return info.changes
  }

  /**
   * Последний курсор обращений разговора. Нужен трекеру: кадр `pending` строки в
   * БД не имеет, а клиент отбрасывает кадры с seq ≤ lastSeq.
   */
  kbUsageLastSeq(conversationId: string): number {
    return (this.db
      .prepare(`SELECT COALESCE(MAX(seq), 0) AS m FROM kb_usage_queries WHERE conversation_id = ?`)
      .get(conversationId) as { m: number }).m
  }

  /**
   * Продвинуть границу просмотра только вперёд. Проверка владельца выполняется до
   * upsert, поэтому строку другого пользователя нельзя ни читать, ни менять.
   */
  markKbUsageViewed(userId: string, conversationId: string, lastSeq: number): { lastSeq: number; unreadCount: number } | null {
    if (!this.getConversation(userId, conversationId)) return null
    const boundary = Math.max(0, Math.min(Math.trunc(lastSeq), this.kbUsageLastSeq(conversationId)))
    this.db.prepare(
      `INSERT INTO kb_usage_views (user_id, conversation_id, last_seq, viewed_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, conversation_id) DO UPDATE SET
         last_seq = MAX(kb_usage_views.last_seq, excluded.last_seq),
         viewed_at = CASE WHEN excluded.last_seq > kb_usage_views.last_seq THEN excluded.viewed_at ELSE kb_usage_views.viewed_at END`
    ).run(userId, conversationId, boundary, this.now())
    return { lastSeq: this.kbUsageViewedSeq(userId, conversationId), unreadCount: this.kbUsageUnreadCount(userId, conversationId) }
  }

  private kbUsageViewedSeq(userId: string, conversationId: string): number {
    const row = this.db.prepare(`SELECT last_seq FROM kb_usage_views WHERE user_id = ? AND conversation_id = ?`)
      .get(userId, conversationId) as { last_seq: number } | undefined
    return row?.last_seq ?? 0
  }

  private kbUsageUnreadCount(userId: string, conversationId: string): number {
    return (this.db.prepare(
      `SELECT COUNT(*) AS n FROM kb_usage_queries
       WHERE conversation_id = ? AND seq > ?`
    ).get(conversationId, this.kbUsageViewedSeq(userId, conversationId)) as { n: number }).n
  }

  /** Отчёт по чату: свой чат (изоляция по владельцу) — иначе null → 404 у роута. */
  kbUsageReport(userId: string, conversationId: string, limit = 40): KbChatUsage | null {
    const conv = this.getConversation(userId, conversationId)
    if (!conv) return null
    const totals = this.kbUsageTotals('q.conversation_id = ?', [conversationId])
    const sections = this.kbUsageSections('q.conversation_id = ?', [conversationId])
    const recent = this.kbUsageQueries('q.conversation_id = ?', [conversationId], limit)
    return {
      conversationId,
      projectId: conv.projectId ?? null,
      kbContextMode: conv.kbContextMode ?? 'auto',
      lastSeq: this.kbUsageLastSeq(conversationId),
      unreadCount: this.kbUsageUnreadCount(userId, conversationId),
      totals,
      sections,
      recent
    }
  }

  /** Агрегат по всем чатам проекта: только участнику проекта — иначе null. */
  kbUsageProjectReport(userId: string, projectId: string, limit = 40): KbProjectUsage | null {
    if (!this.isProjectMember(userId, projectId)) return null
    const totals = this.kbUsageTotals('q.project_id = ?', [projectId])
    const sections = this.kbUsageSections('q.project_id = ?', [projectId], { withConversations: true })
    const conversations = (this.db
      .prepare(
        `SELECT q.conversation_id, COALESCE(c.title, '') AS title, COUNT(*) AS queries, SUM(q.chars) AS chars,
                SUM(q.est_tokens) AS est_tokens, MAX(q.created_at) AS last_at
           FROM kb_usage_queries q LEFT JOIN conversations c ON c.id = q.conversation_id
          WHERE q.project_id = ?
          GROUP BY q.conversation_id
          ORDER BY last_at DESC`
      )
      .all(projectId) as Array<{ conversation_id: string; title: string; queries: number; chars: number; est_tokens: number; last_at: number }>)
      .map((r) => ({ conversationId: r.conversation_id, title: r.title, queries: r.queries, chars: r.chars, estimatedTokens: r.est_tokens, lastAt: r.last_at }))
    return { projectId, totals, sections, recent: this.kbUsageQueries('q.project_id = ?', [projectId], limit), conversations }
  }

  /**
   * Обращения к БЗ внутри одного CI-рана. Гейт — членство в проекте рана (как у
   * ленты), поэтому чужой пользователь получает null → 404 у роута.
   */
  kbUsageRunReport(userId: string, runId: string, limit = 40): KbRunUsageReport | null {
    const run = this.getCiRunRaw(runId)
    if (!run || !this.isProjectMember(userId, run.projectId)) return null
    return {
      runId,
      projectId: run.projectId,
      taskId: run.taskId,
      kbContextMode: run.kbContextMode,
      conversationId: run.conversationId,
      totals: this.kbUsageTotals('q.ci_run_id = ?', [runId]),
      sections: this.kbUsageSections('q.ci_run_id = ?', [runId]),
      recent: this.kbUsageQueries('q.ci_run_id = ?', [runId], limit)
    }
  }

  /**
   * Агрегат по ВСЕМ ранам задачи (блок в модалке задачи). Срез задаётся
   * подзапросом по `ci_runs`, а не сохранённым task_id в самой телеметрии:
   * привязка «обращение → ран» одна, и дублировать её нечем.
   */
  kbUsageTaskReport(userId: string, projectId: string, taskId: string, limit = 40): KbTaskUsageReport | null {
    if (!this.isProjectMember(userId, projectId)) return null
    if (!this.db.prepare(`SELECT 1 FROM tasks WHERE id = ? AND project_id = ?`).get(taskId, projectId)) return null
    const where = 'q.ci_run_id IN (SELECT id FROM ci_runs WHERE task_id = ? AND project_id = ?)'
    const params = [taskId, projectId]
    const runs = (this.db
      .prepare(`SELECT COUNT(DISTINCT q.ci_run_id) AS n FROM kb_usage_queries q WHERE ${where}`)
      .get(...params) as { n: number }).n
    return {
      projectId,
      taskId,
      runs,
      totals: this.kbUsageTotals(where, params),
      sections: this.kbUsageSections(where, params),
      recent: this.kbUsageQueries(where, params, limit)
    }
  }

  /**
   * Итоги по обращениям — ОТДЕЛЬНЫМ запросом, без JOIN с разделами: иначе суммы
   * размножились бы по числу разделов каждого обращения.
   */
  private kbUsageTotals(where: string, params: unknown[]): KbUsageTotals {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS queries,
                SUM(CASE WHEN q.status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
                SUM(CASE WHEN q.status = 'empty' THEN 1 ELSE 0 END) AS empty,
                SUM(CASE WHEN q.status = 'error' THEN 1 ELSE 0 END) AS errors,
                SUM(CASE WHEN q.source <> 'auto' THEN 1 ELSE 0 END) AS tool_queries,
                SUM(q.sections_count) AS sections, SUM(q.chars) AS chars, SUM(q.est_tokens) AS est_tokens,
                MAX(q.created_at) AS last_at
           FROM kb_usage_queries q WHERE ${where}`
      )
      .get(...params) as {
        queries: number; delivered: number | null; empty: number | null; errors: number | null
        tool_queries: number | null; sections: number | null; chars: number | null; est_tokens: number | null
        last_at: number | null
      }
    const documents = (this.db
      .prepare(
        `SELECT COUNT(DISTINCT s.document_id) AS n FROM kb_usage_sections s
           JOIN kb_usage_queries q ON q.id = s.query_id WHERE ${where}`
      )
      .get(...params) as { n: number }).n
    // Промпт одного хода общий для всех его обращений — берём его по одному разу
    // на turn_id, иначе доля «сколько из промпта от БЗ» была бы заниженной.
    const promptChars = (this.db
      .prepare(
        `SELECT COALESCE(SUM(prompt_chars), 0) AS n FROM (
           SELECT COALESCE(q.turn_id, q.id) AS turn, MAX(q.prompt_chars) AS prompt_chars
             FROM kb_usage_queries q WHERE ${where} AND q.prompt_chars IS NOT NULL GROUP BY turn)`
      )
      .get(...params) as { n: number }).n
    return {
      queries: row.queries,
      delivered: row.delivered ?? 0,
      empty: row.empty ?? 0,
      errors: row.errors ?? 0,
      toolQueries: row.tool_queries ?? 0,
      sections: row.sections ?? 0,
      documents,
      chars: row.chars ?? 0,
      estimatedTokens: row.est_tokens ?? 0,
      promptChars,
      lastAt: row.last_at ?? null
    }
  }

  /**
   * Разделы в разрезе произвольного среза обращений (`where` — по алиасу `q`).
   * Один запрос на чат, проект, ран и задачу: иначе четыре копии одного GROUP BY
   * неизбежно разъедутся в мелочах вроде порядка сортировки.
   */
  private kbUsageSections(where: string, params: unknown[], opts: { withConversations?: boolean } = {}): KbUsageSectionAggregate[] {
    const conversations = opts.withConversations ? ', COUNT(DISTINCT q.conversation_id) AS conversations' : ''
    return (this.db
      .prepare(
        `SELECT s.document_id, s.anchor, MAX(s.title) AS title, MAX(s.heading) AS heading,
                MAX(s.source_path) AS source_path, MAX(s.freshness) AS freshness, COUNT(*) AS times,
                SUM(CASE WHEN q.source = 'auto' THEN 1 ELSE 0 END) AS auto_times, SUM(s.chars) AS chars,
                SUM(s.est_tokens) AS est_tokens, MAX(q.created_at) AS last_at${conversations}
           FROM kb_usage_sections s JOIN kb_usage_queries q ON q.id = s.query_id
          WHERE ${where}
          GROUP BY s.document_id, s.anchor
          ORDER BY times DESC, chars DESC`
      )
      .all(...params) as KbSectionAggRow[]).map(mapKbSectionAggregate)
  }

  /** Последние обращения (новые сверху) вместе с их разделами. */
  private kbUsageQueries(where: string, params: unknown[], limit: number): KbUsageQuery[] {
    const rows = this.db
      .prepare(`SELECT q.* FROM kb_usage_queries q WHERE ${where} ORDER BY q.created_at DESC, q.seq DESC LIMIT ?`)
      .all(...params, Math.max(1, Math.min(limit, 200))) as KbUsageQueryRow[]
    if (!rows.length) return []
    const placeholders = rows.map(() => '?').join(',')
    const sections = this.db
      .prepare(`SELECT * FROM kb_usage_sections WHERE query_id IN (${placeholders}) ORDER BY position ASC`)
      .all(...rows.map((r) => r.id)) as KbUsageSectionRow[]
    const byQuery = new Map<string, KbUsageSectionRef[]>()
    for (const item of sections) {
      const list = byQuery.get(item.query_id) ?? []
      list.push(mapKbUsageSection(item))
      byQuery.set(item.query_id, list)
    }
    return rows.map((row) => mapKbUsageQuery(row, byQuery.get(row.id) ?? []))
  }

  // ---- Статьи базы знаний (разделы «Настройки пользователя» и «Разработка») ----
  //
  // Раздел «Использование» лежит в файлах репозитория (docs/kb) и одинаков для
  // всех; здесь — то, что пишут пользователь и модель. Проверку доступа делает
  // слой БЗ (kb/access.ts): методы ниже принадлежностью только помечают строки,
  // фильтровать по ней обязан вызывающий.

  /** Статьи по фильтру принадлежности. Без фильтра — все (для сборки индекса). */
  kbDocuments(filter: { scope?: KbScope; projectId?: string | null; ownerId?: string | null } = {}): KbStoredDocument[] {
    const where: string[] = []
    const params: unknown[] = []
    if (filter.scope) {
      where.push('scope = ?')
      params.push(filter.scope)
    }
    if (filter.projectId !== undefined && filter.projectId !== null) {
      where.push('project_id = ?')
      params.push(filter.projectId)
    }
    if (filter.ownerId !== undefined && filter.ownerId !== null) {
      where.push('owner_id = ?')
      params.push(filter.ownerId)
    }
    const rows = this.db
      .prepare(`SELECT * FROM kb_documents${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC`)
      .all(...params) as KbDocumentRow[]
    return rows.map(mapKbDocument)
  }

  kbDocumentById(id: string): KbStoredDocument | null {
    const row = this.db.prepare(`SELECT * FROM kb_documents WHERE id = ?`).get(id) as KbDocumentRow | undefined
    return row ? mapKbDocument(row) : null
  }

  /**
   * Версия набора статей: количество + максимум updated_at. Индекс БЗ держится в
   * памяти и пересобирается только при смене версии — иначе каждый поиск платил
   * бы за перечитывание всех статей.
   */
  kbDocumentsVersion(): string {
    const row = this.db.prepare(`SELECT COUNT(*) AS n, IFNULL(MAX(updated_at), 0) AS ts FROM kb_documents`).get() as {
      n: number
      ts: number
    }
    return `${row.n}:${row.ts}`
  }

  /** Создать статью или переписать существующую (id задаёт вызывающий). */
  saveKbDocument(args: {
    id?: string | null
    scope: KbScope
    ownerId?: string | null
    projectId?: string | null
    title: string
    body: string
    kind?: KbDocumentKind
    tags?: string[]
    areas?: string[]
    checkedOn?: string | null
    createdBy?: string
  }): KbStoredDocument {
    const ts = this.now()
    const existing = args.id ? this.kbDocumentById(args.id) : null
    const id = existing?.id ?? args.id ?? this.newId()
    if (existing) {
      this.db
        .prepare(
          `UPDATE kb_documents SET title = ?, body = ?, kind = ?, tags = ?, areas = ?, checked_on = ?, updated_at = ? WHERE id = ?`
        )
        .run(
          args.title,
          args.body,
          args.kind ?? existing.kind,
          JSON.stringify(args.tags ?? existing.tags),
          JSON.stringify(args.areas ?? existing.areas),
          args.checkedOn ?? existing.checkedOn,
          ts,
          id
        )
    } else {
      this.db
        .prepare(
          `INSERT INTO kb_documents (id, scope, owner_id, project_id, title, kind, tags, areas, body, checked_on, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          args.scope,
          args.ownerId ?? null,
          args.projectId ?? null,
          args.title,
          args.kind ?? 'subsystem',
          JSON.stringify(args.tags ?? []),
          JSON.stringify(args.areas ?? []),
          args.body,
          args.checkedOn ?? null,
          args.createdBy ?? args.ownerId ?? '',
          ts,
          ts
        )
    }
    return this.kbDocumentById(id) as KbStoredDocument
  }

  setTaskPreviewReady(projectId: string, taskId: string, ready: boolean): void {
    this.db.prepare(`UPDATE tasks SET preview_ready=?, updated_at=? WHERE id=? AND project_id=?`).run(ready ? 1 : 0, this.now(), taskId, projectId)
  }

  // ============== Структурированное ручное QA =================
  private canQa(userId: string, projectId: string): boolean {
    const row = this.db.prepare(`SELECT role, qa_permission FROM project_members WHERE project_id = ? AND username = ?`).get(projectId, userId) as { role: string; qa_permission: number } | undefined
    return !!row && (row.role === 'owner' || !!row.qa_permission)
  }

  private mapComponentQaRun(row: Record<string, unknown>): ComponentQaRun {
    const status = row.status as ComponentQaRun['status']
    return {
      id:String(row.id), projectId:String(row.project_id), taskId:String(row.task_id),
      developmentRunId:String(row.development_run_id), linkedFixRunId:row.linked_fix_run_id as string|null,
      branch:String(row.branch), commitSha:String(row.commit_sha), attempt:Number(row.attempt), status,
      uiImpact:row.ui_impact as ComponentQaRun['uiImpact'], readinessRunId:String(row.readiness_run_id),
      readinessVersion:String(row.readiness_version),
      scenarios:parseJsonValue<ComponentQaScenarioSnapshot[]>(String(row.scenarios_json ?? '[]'), []),
      components:parseJsonValue(String(row.components_json ?? '[]'), []),
      commands:parseJsonValue<ComponentQaCommandResult[]>(String(row.commands_json ?? '[]'), []),
      artifacts:parseJsonValue<ComponentQaArtifact[]>(String(row.artifacts_json ?? '[]'), []),
      failureClassification:row.failure_classification as ComponentQaRun['failureClassification'],
      blockerReasons:parseStringArray(String(row.blocker_reasons_json ?? '[]')), summary:String(row.summary ?? ''),
      log:String(row.log ?? ''), storybookUrl:row.storybook_url as string|null, createdAt:Number(row.created_at),
      startedAt:row.started_at == null ? null : Number(row.started_at), finishedAt:row.finished_at == null ? null : Number(row.finished_at),
      staleReason:row.stale_reason as string|null, canCancel:status === 'queued' || status === 'running',
      canRetry:['failed','blocked','cancelled','stale'].includes(status)
    }
  }

  getComponentQaRun(userId: string, runId: string): ComponentQaRun | null {
    const row = this.db.prepare(`SELECT r.* FROM component_qa_runs r JOIN project_members m ON m.project_id=r.project_id WHERE r.id=? AND m.username=?`).get(runId,userId) as Record<string,unknown>|undefined
    return row ? this.mapComponentQaRun(row) : null
  }

  getComponentQaTaskState(userId: string, projectId: string, taskId: string): ComponentQaTaskState | null {
    if (!this.isProjectMember(userId,projectId)) return null
    const task = this.db.prepare(`SELECT t.id,c.semantic_type FROM tasks t JOIN kanban_columns c ON c.id=t.column_id WHERE t.id=? AND t.project_id=?`).get(taskId,projectId) as {id:string;semantic_type:string}|undefined
    if (!task) return null
    const runs=(this.db.prepare(`SELECT * FROM component_qa_runs WHERE task_id=? ORDER BY attempt DESC,created_at DESC`).all(taskId) as Record<string,unknown>[]).map((row)=>this.mapComponentQaRun(row))
    const activeRun=runs.find((run)=>run.status==='queued'||run.status==='running') ?? null
    const latestRun=runs[0] ?? null
    const prep=this.db.prepare(`SELECT readiness_json FROM task_preparation_runs WHERE task_id=? AND status='success' AND readiness_json IS NOT NULL ORDER BY created_at DESC LIMIT 1`).get(taskId) as {readiness_json:string}|undefined
    const readiness=prep ? parseJsonValue<DevelopmentReadiness|null>(prep.readiness_json,null) : null
    const workspace=this.findLatestPushedCiWorkspace(projectId,taskId)
    const launchReasons:string[]=[]
    if (task.semantic_type!=='component_qa') launchReasons.push('task_not_in_component_qa')
    if (!workspace?.branch || !workspace.commitSha) launchReasons.push('missing_development_workspace')
    if (!readiness) launchReasons.push('missing_readiness_snapshot')
    else launchReasons.push(...componentQaLaunchReasons(readiness))
    let gateReasons:string[]=[]
    if (latestRun && workspace && readiness) gateReasons=canCompleteComponentQa({
      run:latestRun,currentCommitSha:workspace.commitSha ?? '',currentReadinessVersion:componentQaSemanticVersion(readiness),
      acceptanceCriteriaConflict:readiness.acceptanceCriteriaConflict
    }).reasons
    return {activeRun,latestRun,runs,launchReasons,canStart:!activeRun&&launchReasons.length===0,canComplete:gateReasons.length===0&&!!latestRun,gateReasons}
  }

  startComponentQaRun(userId: string, projectId: string, taskId: string): ComponentQaRun {
    if (!this.canQa(userId,projectId)) throw new Error('QA permission required')
    return this.db.transaction(()=>{
      const task=this.db.prepare(`SELECT c.semantic_type FROM tasks t JOIN kanban_columns c ON c.id=t.column_id WHERE t.id=? AND t.project_id=?`).get(taskId,projectId) as {semantic_type:string}|undefined
      if (!task) throw new Error('task not found')
      if (task.semantic_type!=='component_qa') throw new Error('task must be in component_qa')
      const workspace=this.findLatestPushedCiWorkspace(projectId,taskId)
      if (!workspace?.branch || !workspace.commitSha || !workspace.agentId || !workspace.path) throw new Error('missing current development workspace')
      const dev=this.db.prepare(`SELECT id FROM ci_runs WHERE project_id=? AND task_id=? AND workspace_id=? AND status='success' ORDER BY created_at DESC LIMIT 1`).get(projectId,taskId,workspace.id) as {id:string}|undefined
      if (!dev) throw new Error('successful development run not found')
      const prep=this.db.prepare(`SELECT id,readiness_json FROM task_preparation_runs WHERE task_id=? AND status='success' AND readiness_json IS NOT NULL ORDER BY created_at DESC LIMIT 1`).get(taskId) as {id:string;readiness_json:string}|undefined
      if (!prep) throw new Error('missing readiness snapshot')
      const readiness=parseJsonValue<DevelopmentReadiness|null>(prep.readiness_json,null)
      if (!readiness || !readiness.uiImpact) throw new Error('missing readiness snapshot')
      this.db.prepare(`UPDATE component_qa_runs SET status='stale',stale_reason='development_sha_changed',finished_at=? WHERE task_id=? AND commit_sha<>? AND status IN ('queued','running')`).run(this.now(),taskId,workspace.commitSha)
      const version=componentQaSemanticVersion(readiness)
      this.db.prepare(`UPDATE component_qa_runs SET status='stale',stale_reason='scenario_version_changed',finished_at=? WHERE task_id=? AND readiness_version<>? AND status IN ('queued','running')`).run(this.now(),taskId,version)
      const active=this.db.prepare(`SELECT * FROM component_qa_runs WHERE task_id=? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1`).get(taskId) as Record<string,unknown>|undefined
      if (active) return this.mapComponentQaRun(active)
      const reasons=componentQaLaunchReasons(readiness)
      const attempt=Number((this.db.prepare(`SELECT COALESCE(MAX(attempt),0)+1 AS n FROM component_qa_runs WHERE task_id=?`).get(taskId) as {n:number}).n)
      const id=this.newId(), now=this.now()
      const componentCases=readiness.testCases.filter((item)=>item.testType==='ui'||item.testType==='automated'||item.testType==='mixed')
      const scenarios:ComponentQaScenarioSnapshot[]=componentCases.map((testCase)=>({testCase,version:1,semanticHash:version,status:'pending',actualResult:'',diagnostic:''}))
      const status:ComponentQaRun['status']=readiness.uiImpact==='none'?'skipped':reasons.length?'blocked':'queued'
      this.db.prepare(`INSERT INTO component_qa_runs (id,project_id,task_id,development_run_id,branch,commit_sha,attempt,status,ui_impact,readiness_run_id,readiness_version,scenarios_json,components_json,blocker_reasons_json,summary,created_at,finished_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,projectId,taskId,dev.id,workspace.branch,workspace.commitSha,attempt,status,readiness.uiImpact,prep.id,version,JSON.stringify(scenarios),JSON.stringify(readiness.affectedComponents),JSON.stringify(reasons),readiness.uiImpact==='none'?'Component QA не применим: uiImpact=none':reasons.length?'Component QA заблокирован обязательными входными данными':'',now,status==='queued'?null:now)
      if (status==='skipped') {
        const target=this.getColumnIdBySemantic(projectId,'integration_tests')
        if (!target || !canTransitionWorkflow('component_qa','integration_tests','automation')) throw new Error('integration_tests transition unavailable')
        this.moveTask(userId,projectId,taskId,{columnId:target})
      }
      return this.getComponentQaRun(userId,id)!
    })()
  }

  componentQaExecutionContext(runId:string):{agentId:string;workdir:string;commands:string[]}|null {
    const row=this.db.prepare(`SELECT w.agent_id,w.path,p.test_command FROM component_qa_runs r JOIN ci_runs d ON d.id=r.development_run_id JOIN ci_workspaces w ON w.id=d.workspace_id JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.status='queued' AND w.commit_sha=r.commit_sha AND w.pushed=1`).get(runId) as {agent_id:string|null;path:string;test_command:string|null}|undefined
    if (!row?.agent_id||!row.path) return null
    return {agentId:row.agent_id,workdir:row.path,commands:testStages(row.test_command??'',['npm run test:storybook'])}
  }

  markComponentQaRunning(id:string):void {
    this.db.prepare(`UPDATE component_qa_runs SET status='running',started_at=COALESCE(started_at,?) WHERE id=? AND status='queued'`).run(this.now(),id)
  }

  appendComponentQaLog(id:string,stream:'stdout'|'stderr',chunk:string):void {
    const prefix=stream==='stderr'?'[stderr] ':''
    this.db.prepare(`UPDATE component_qa_runs SET log=substr(log || ?, -500000) WHERE id=? AND status='running'`).run(prefix+chunk,id)
  }

  finishComponentQaRun(userId:string,runId:string,input:{status:'passed'|'failed'|'blocked';scenarios:ComponentQaScenarioSnapshot[];commands:ComponentQaCommandResult[];artifacts?:ComponentQaArtifact[];summary:string;storybookUrl?:string|null;failureClassification?:ComponentQaRun['failureClassification'];blockerReasons?:string[]}):ComponentQaRun {
    const run=this.getComponentQaRun(userId,runId)
    if (!run || run.status!=='running') throw new Error('component QA run is not running')
    this.db.prepare(`UPDATE component_qa_runs SET status=?,scenarios_json=?,commands_json=?,artifacts_json=?,summary=?,storybook_url=?,failure_classification=?,blocker_reasons_json=?,finished_at=? WHERE id=? AND status='running'`).run(input.status,JSON.stringify(input.scenarios),JSON.stringify(input.commands),JSON.stringify(input.artifacts??[]),input.summary,input.storybookUrl??null,input.failureClassification??null,JSON.stringify(input.blockerReasons??[]),this.now(),runId)
    return this.getComponentQaRun(userId,runId)!
  }

  completeComponentQaRun(userId:string,projectId:string,taskId:string,runId:string):ComponentQaRun {
    if (!this.canQa(userId,projectId)) throw new Error('QA permission required')
    const run=this.getComponentQaRun(userId,runId)
    const workspace=this.findLatestPushedCiWorkspace(projectId,taskId)
    const prep=this.db.prepare(`SELECT readiness_json FROM task_preparation_runs WHERE task_id=? AND status='success' AND readiness_json IS NOT NULL ORDER BY created_at DESC LIMIT 1`).get(taskId) as {readiness_json:string}|undefined
    if (!run||run.taskId!==taskId||!workspace?.commitSha||!prep) throw new Error('component QA state incomplete')
    const readiness=parseJsonValue<DevelopmentReadiness|null>(prep.readiness_json,null)
    if (!readiness) throw new Error('component QA state incomplete')
    const gate=canCompleteComponentQa({run,currentCommitSha:workspace.commitSha,currentReadinessVersion:componentQaSemanticVersion(readiness),acceptanceCriteriaConflict:readiness.acceptanceCriteriaConflict})
    if (!gate.allowed) throw new Error(`component QA gate incomplete: ${gate.reasons.join(', ')}`)
    const task=this.db.prepare(`SELECT c.semantic_type FROM tasks t JOIN kanban_columns c ON c.id=t.column_id WHERE t.id=? AND t.project_id=?`).get(taskId,projectId) as {semantic_type:string}|undefined
    if (task?.semantic_type!=='component_qa'||!canTransitionWorkflow('component_qa','integration_tests','automation')) throw new Error('workflow transition conflict')
    const target=this.getColumnIdBySemantic(projectId,'integration_tests')
    if (!target) throw new Error('integration_tests column not found')
    this.moveTask(userId,projectId,taskId,{columnId:target})
    return run
  }

  cancelComponentQaRun(userId:string,runId:string):ComponentQaRun {
    const run=this.getComponentQaRun(userId,runId)
    if (!run) throw new Error('component QA run not found')
    if (!this.canQa(userId,run.projectId)) throw new Error('QA permission required')
    this.db.prepare(`UPDATE component_qa_runs SET status='cancelled',summary='Component QA отменён пользователем',finished_at=? WHERE id=? AND status IN ('queued','running')`).run(this.now(),runId)
    return this.getComponentQaRun(userId,runId)!
  }

  linkComponentQaFixRun(userId:string,runId:string,fixRunId:string):ComponentQaRun {
    const run=this.getComponentQaRun(userId,runId)
    if (!run||!this.canQa(userId,run.projectId)) throw new Error('QA permission required')
    this.db.prepare(`UPDATE component_qa_runs SET status='failed',linked_fix_run_id=?,failure_classification='implementation_defect',finished_at=COALESCE(finished_at,?) WHERE id=?`).run(fixRunId,this.now(),runId)
    return this.getComponentQaRun(userId,runId)!
  }

  failInterruptedComponentQaRuns():string[] {
    const rows=this.db.prepare(`SELECT id FROM component_qa_runs WHERE status IN ('queued','running')`).all() as Array<{id:string}>
    this.db.prepare(`UPDATE component_qa_runs SET status='blocked',failure_classification='infrastructure',blocker_reasons_json='["server_restarted"]',summary='Component QA прерван перезапуском сервера',finished_at=? WHERE status IN ('queued','running')`).run(this.now())
    return rows.map((row)=>row.id)
  }

  // ============== Создание интеграционных автотестов =================
  private mapIntegrationTestRun(row:Record<string,unknown>):IntegrationTestRun {
    const status=row.status as IntegrationTestRun['status']
    return {
      id:String(row.id),projectId:String(row.project_id),taskId:String(row.task_id),
      developmentRunId:row.development_run_id==null?'':String(row.development_run_id),linkedFixRunId:row.linked_fix_run_id as string|null,
      branch:String(row.branch),commitSha:String(row.commit_sha),attempt:Number(row.attempt),status,
      readinessRunId:String(row.readiness_run_id),snapshotVersion:String(row.snapshot_version),
      testCases:parseJsonValue(String(row.test_cases_json??'[]'),[]),automationLinks:parseJsonValue(String(row.automation_links_json??'[]'),[]),
      commands:parseJsonValue<IntegrationTestCommandResult[]>(String(row.commands_json??'[]'),[]),
      log:String(row.log??''),failureClassification:row.failure_classification as IntegrationTestRun['failureClassification'],
      failureReason:row.failure_reason as string|null,blockerReasons:parseStringArray(String(row.blocker_reasons_json??'[]')),
      summary:String(row.summary??''),createdAt:Number(row.created_at),startedAt:row.started_at==null?null:Number(row.started_at),
      finishedAt:row.finished_at==null?null:Number(row.finished_at),staleReason:row.stale_reason as IntegrationTestRun['staleReason'],
      canCancel:status==='queued'||status==='running',canRetry:['failed','blocked','cancelled','stale'].includes(status)
    }
  }

  getIntegrationTestRun(userId:string,runId:string):IntegrationTestRun|null {
    const row=this.db.prepare(`SELECT r.* FROM integration_test_runs r JOIN project_members m ON m.project_id=r.project_id WHERE r.id=? AND m.username=?`).get(runId,userId) as Record<string,unknown>|undefined
    return row?this.mapIntegrationTestRun(row):null
  }

  private currentIntegrationInputs(projectId:string,taskId:string) {
    const task=this.db.prepare(`SELECT c.semantic_type FROM tasks t JOIN kanban_columns c ON c.id=t.column_id WHERE t.id=? AND t.project_id=?`).get(taskId,projectId) as {semantic_type:string}|undefined
    const workspace=this.findLatestPushedCiWorkspace(projectId,taskId)
    const prep=this.db.prepare(`SELECT id,readiness_json FROM task_preparation_runs WHERE task_id=? AND status='success' AND readiness_json IS NOT NULL ORDER BY created_at DESC LIMIT 1`).get(taskId) as {id:string;readiness_json:string}|undefined
    const readiness=prep?parseJsonValue<DevelopmentReadiness|null>(prep.readiness_json,null):null
    const dev=workspace?this.db.prepare(`SELECT id FROM ci_runs WHERE project_id=? AND task_id=? AND workspace_id=? AND status='success' ORDER BY created_at DESC LIMIT 1`).get(projectId,taskId,workspace.id) as {id:string}|undefined:undefined
    return {task,workspace,prep,readiness,dev}
  }

  getIntegrationTestTaskState(userId:string,projectId:string,taskId:string):IntegrationTestTaskState|null {
    if(!this.isProjectMember(userId,projectId)) return null
    const input=this.currentIntegrationInputs(projectId,taskId)
    if(!input.task) return null
    const runs=(this.db.prepare(`SELECT * FROM integration_test_runs WHERE task_id=? ORDER BY attempt DESC,created_at DESC`).all(taskId) as Record<string,unknown>[]).map((row)=>this.mapIntegrationTestRun(row))
    const activeRun=runs.find((run)=>run.status==='queued'||run.status==='running')??null
    const latestRun=runs[0]??null
    const reasons:string[]=[]
    if(input.task.semantic_type!=='integration_tests') reasons.push('task_not_in_integration_tests')
    if(!input.workspace?.branch||!input.workspace.commitSha||!input.workspace.agentId||!input.workspace.path||!input.workspace.pushed) reasons.push('missing_pushed_development_workspace')
    if(!input.dev) reasons.push('successful_development_run_not_found')
    if(!input.prep||!input.readiness) reasons.push('missing_readiness_snapshot')
    const cases=input.readiness?.testCases??[]
    const gate=latestRun&&input.workspace?.commitSha&&input.readiness?integrationTestGate(latestRun,input.workspace.commitSha,cases):{allowed:false,reasons:['integration_test_run_missing']}
    return {activeRun,latestRun,runs,testCases:cases,launchReasons:reasons,canStart:!activeRun&&reasons.length===0,canComplete:gate.allowed,gateReasons:gate.reasons}
  }

  startIntegrationTestRun(userId:string,projectId:string,taskId:string):IntegrationTestRun {
    if(!this.canQa(userId,projectId)) throw new Error('QA permission required')
    return this.db.transaction(()=>{
      const input=this.currentIntegrationInputs(projectId,taskId)
      const reasons:string[]=[]
      if(!input.task) throw new Error('task not found')
      if(input.task.semantic_type!=='integration_tests') reasons.push('task_not_in_integration_tests')
      if(!input.workspace?.branch||!input.workspace.commitSha||!input.workspace.agentId||!input.workspace.path||!input.workspace.pushed) reasons.push('missing_pushed_development_workspace')
      if(!input.dev) reasons.push('successful_development_run_not_found')
      if(!input.prep||!input.readiness) reasons.push('missing_readiness_snapshot')
      const currentSha=input.workspace?.commitSha??''
      const cases=input.readiness?.testCases??[]
      const version=integrationTestSemanticVersion(cases)
      const ts=this.now()
      this.db.prepare(`UPDATE integration_test_runs SET status='stale',stale_reason='sha_changed',finished_at=? WHERE task_id=? AND commit_sha<>? AND status IN ('queued','running','passed','failed','blocked','cancelled','skipped')`).run(ts,taskId,currentSha)
      this.db.prepare(`UPDATE integration_test_runs SET status='stale',stale_reason='snapshot_changed',finished_at=? WHERE task_id=? AND snapshot_version<>? AND status IN ('queued','running','passed','failed','blocked','cancelled','skipped')`).run(ts,taskId,version)
      const active=this.db.prepare(`SELECT * FROM integration_test_runs WHERE task_id=? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1`).get(taskId) as Record<string,unknown>|undefined
      if(active) return this.mapIntegrationTestRun(active)
      const requiredAutomatable=cases.filter((item)=>item.required&&item.automatable)
      const invalidExcluded=cases.filter((item)=>item.required&&!item.automatable&&(!item.notAutomatedReason.trim()||!item.alternativeManualVerification.trim()))
      const skipped=reasons.length===0&&requiredAutomatable.length===0&&invalidExcluded.length===0
      const status:IntegrationTestRun['status']=skipped?'skipped':reasons.length?'blocked':'queued'
      const attempt=Number((this.db.prepare(`SELECT COALESCE(MAX(attempt),0)+1 n FROM integration_test_runs WHERE task_id=?`).get(taskId) as {n:number}).n)
      const id=this.newId()
      this.db.prepare(`INSERT INTO integration_test_runs (id,project_id,task_id,development_run_id,branch,commit_sha,attempt,status,readiness_run_id,snapshot_version,test_cases_json,blocker_reasons_json,summary,created_at,finished_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,projectId,taskId,input.dev?.id??null,input.workspace?.branch??'',currentSha,attempt,status,input.prep?.id??'',version,JSON.stringify(cases),JSON.stringify(reasons),skipped?'Нет обязательных automatable-кейсов':reasons.length?'Запуск заблокирован предусловиями':'',ts,status==='queued'?null:ts)
      if(skipped){
        const target=this.getColumnIdBySemantic(projectId,'automated_qa')
        if(!target||!canTransitionWorkflow('integration_tests','automated_qa','automation')) throw new Error('automated_qa transition unavailable')
        this.moveTask(userId,projectId,taskId,{columnId:target})
      }
      return this.getIntegrationTestRun(userId,id)!
    })()
  }

  integrationTestExecutionContext(runId:string):{agentId:string;workdir:string;commands:string[]}|null {
    const row=this.db.prepare(`SELECT w.agent_id,w.path,p.test_command FROM integration_test_runs r JOIN ci_runs d ON d.id=r.development_run_id JOIN ci_workspaces w ON w.id=d.workspace_id JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.status='queued' AND w.commit_sha=r.commit_sha AND w.pushed=1`).get(runId) as {agent_id:string|null;path:string;test_command:string|null}|undefined
    return row?.agent_id&&row.path?{agentId:row.agent_id,workdir:row.path,commands:testStages(row.test_command??'',['npm run affected-check'])}:null
  }
  markIntegrationTestRunning(id:string):void { this.db.prepare(`UPDATE integration_test_runs SET status='running',started_at=COALESCE(started_at,?) WHERE id=? AND status='queued'`).run(this.now(),id) }
  appendIntegrationTestLog(id:string,chunk:string):void { this.db.prepare(`UPDATE integration_test_runs SET log=substr(log||?,-500000) WHERE id=? AND status='running'`).run(chunk,id) }
  finishIntegrationTestRun(userId:string,runId:string,input:{status:'passed'|'failed'|'blocked';commands:IntegrationTestCommandResult[];summary:string;failureClassification?:IntegrationTestRun['failureClassification'];failureReason?:string|null;blockerReasons?:string[]}):IntegrationTestRun {
    const run=this.getIntegrationTestRun(userId,runId)
    if(!run||run.status!=='running') throw new Error('integration test run is not running')
    this.db.prepare(`UPDATE integration_test_runs SET status=?,commands_json=?,summary=?,failure_classification=?,failure_reason=?,blocker_reasons_json=?,finished_at=? WHERE id=? AND status='running'`).run(input.status,JSON.stringify(input.commands),input.summary,input.failureClassification??null,input.failureReason??null,JSON.stringify(input.blockerReasons??[]),this.now(),runId)
    return this.getIntegrationTestRun(userId,runId)!
  }
  recordIntegrationAutomationLinks(userId:string,runId:string,links:Array<{testId:string;path:string}>,commitSha:string):IntegrationTestRun {
    const run=this.getIntegrationTestRun(userId,runId)
    if(!run||run.status!=='running') throw new Error('integration test run is not running')
    const prep=this.db.prepare(`SELECT readiness_json FROM task_preparation_runs WHERE id=? AND status='success'`).get(run.readinessRunId) as {readiness_json:string}|undefined
    const readiness=prep?parseJsonValue<DevelopmentReadiness|null>(prep.readiness_json,null):null
    if(!readiness) throw new Error('readiness snapshot missing')
    const now=this.now(), created=links.map((item)=>({testId:item.testId,path:item.path,updatedAt:now,commitSha}))
    readiness.testCases=readiness.testCases.map((testCase)=>({...testCase,automationLinks:[...testCase.automationLinks.filter((link)=>link.commitSha!==commitSha),...created.filter((link)=>link.testId===testCase.id)]}))
    this.db.prepare(`UPDATE task_preparation_runs SET readiness_json=? WHERE id=?`).run(JSON.stringify(readiness),run.readinessRunId)
    this.db.prepare(`UPDATE integration_test_runs SET commit_sha=?,test_cases_json=?,automation_links_json=? WHERE id=?`).run(commitSha,JSON.stringify(readiness.testCases),JSON.stringify(created),runId)
    this.db.prepare(`UPDATE ci_workspaces SET commit_sha=? WHERE id=(SELECT workspace_id FROM ci_runs WHERE id=?)`).run(commitSha,run.developmentRunId)
    return this.getIntegrationTestRun(userId,runId)!
  }
  completeIntegrationTestRun(userId:string,projectId:string,taskId:string,runId:string):IntegrationTestRun {
    if(!this.canQa(userId,projectId)) throw new Error('QA permission required')
    return this.db.transaction(()=>{
      const run=this.getIntegrationTestRun(userId,runId),input=this.currentIntegrationInputs(projectId,taskId)
      if(!run||run.taskId!==taskId||!input.workspace?.commitSha||!input.readiness) throw new Error('integration test state incomplete')
      const gate=integrationTestGate(run,input.workspace.commitSha,input.readiness.testCases)
      if(!gate.allowed) throw new Error(`integration test gate incomplete: ${gate.reasons.join(', ')}`)
      if(input.task?.semantic_type!=='integration_tests'||!canTransitionWorkflow('integration_tests','automated_qa','automation')) throw new Error('workflow transition conflict')
      const target=this.getColumnIdBySemantic(projectId,'automated_qa')
      if(!target) throw new Error('automated_qa column not found')
      this.moveTask(userId,projectId,taskId,{columnId:target})
      return run
    })()
  }
  cancelIntegrationTestRun(userId:string,runId:string):IntegrationTestRun {
    const run=this.getIntegrationTestRun(userId,runId)
    if(!run||!this.canQa(userId,run.projectId)) throw new Error('QA permission required')
    this.db.prepare(`UPDATE integration_test_runs SET status='cancelled',summary='Ран отменён пользователем',finished_at=? WHERE id=? AND status IN ('queued','running')`).run(this.now(),runId)
    return this.getIntegrationTestRun(userId,runId)!
  }
  linkIntegrationTestFixRun(userId:string,runId:string,fixRunId:string):IntegrationTestRun {
    const run=this.getIntegrationTestRun(userId,runId)
    if(!run||!this.canQa(userId,run.projectId)) throw new Error('QA permission required')
    this.db.prepare(`UPDATE integration_test_runs SET linked_fix_run_id=? WHERE id=? AND linked_fix_run_id IS NULL`).run(fixRunId,runId)
    return this.getIntegrationTestRun(userId,runId)!
  }
  failInterruptedIntegrationTestRuns():string[] {
    const rows=this.db.prepare(`SELECT id FROM integration_test_runs WHERE status IN ('queued','running')`).all() as Array<{id:string}>
    this.db.prepare(`UPDATE integration_test_runs SET status='blocked',failure_classification='infrastructure',failure_reason='server_restarted',blocker_reasons_json='["server_restarted"]',summary='Ран прерван перезапуском сервера',finished_at=? WHERE status IN ('queued','running')`).run(this.now())
    return rows.map((row)=>row.id)
  }

  /**
   * Идемпотентно создаёт отдельный merge-ран и в той же SQLite-транзакции
   * переводит карточку в системную колонку merge. Все значения ветки/машины
   * берутся из серверных записей, а не из тела HTTP-запроса.
   */
  startMergeRun(userId: string, projectId: string, taskId: string, agentIdOverride?: string | null, llmOverride?: { provider?: LlmProvider; model?: string }): MergeRun {
    return this.db.transaction(() => {
      const existing = this.db.prepare(`SELECT * FROM merge_runs WHERE task_id=? AND status IN ('queued','checking','fetching','merging','resolving_conflicts','kb_update','testing','pushing') ORDER BY created_at DESC LIMIT 1`).get(taskId) as Record<string, unknown> | undefined
      if (existing) return this.mapMergeRun(existing)

      const row = this.db.prepare(`SELECT t.*, c.semantic_type, p.ci_base_branch, p.default_agent_id, pm.role
        FROM tasks t JOIN kanban_columns c ON c.id=t.column_id JOIN projects p ON p.id=t.project_id
        JOIN project_members pm ON pm.project_id=p.id AND pm.username=?
        WHERE t.id=? AND t.project_id=?`).get(userId, taskId, projectId) as (TaskRow & { semantic_type: string; ci_base_branch: string; default_agent_id: string | null; role: string }) | undefined
      if (!row) throw new Error('task not found')
      if (row.semantic_type !== 'awaiting_merge' && row.semantic_type !== 'merge') throw new Error('task must be in awaiting_merge or merge')
      if ((row.ci_base_branch || 'main') !== 'main') throw new Error('merge target must be main')

      const workspace = this.db.prepare(`SELECT branch,commit_sha,agent_id FROM ci_workspaces WHERE task_id=? AND project_id=? AND pushed=1 AND branch IS NOT NULL ORDER BY created_at DESC LIMIT 1`).get(taskId, projectId) as { branch: string; commit_sha: string | null; agent_id: string | null } | undefined
      if (!workspace?.branch || !workspace.commit_sha || !/^(?!-)(?!.*\.\.)(?!.*[~^:?*\\[\\]\\\\])[A-Za-z0-9._/-]+$/.test(workspace.branch)) throw new Error('prepared task branch or pushed source SHA not found')
      const agentId = agentIdOverride ?? workspace.agent_id
      if (!agentId || !this.canUseAgent(userId, agentId, projectId)) throw new Error(agentIdOverride ? 'merge machine is not available to user or project' : 'prepared workspace machine is not available to user or project')
      if (agentId !== workspace.agent_id && !this.getProjectMachine(projectId, agentId)) throw new Error('selected merge machine has no project repository settings')
      if (!this.db.prepare(`SELECT id FROM kanban_columns WHERE project_id=? AND semantic_type='merge'`).get(projectId)) throw new Error('merge column not found')

      const settings = this.getSettings(userId)
      const globalLlm = this.ciLlmDefaultsForUser(userId)
      const development = this.findLatestCiRunForTask(projectId, taskId)
      const stageLlm = this.resolveTaskStageLlmConfig(projectId, taskId, 'kb_update', development
        ? { llmEngineId: development.llmEngineId ?? null, provider: development.llmProvider, model: development.llmModel }
        : { llmEngineId: globalLlm.llmEngineId ?? null, provider: globalLlm.provider, model: globalLlm.model })
      const requestedProvider = llmOverride?.provider ?? stageLlm.provider
      const requestedModel = (llmOverride?.model ?? stageLlm.model ?? '').trim()
      const access = this.getUserLlmAccess(userId)
      const provider = isProviderAllowed(access, requestedProvider) ? requestedProvider : firstAllowedProvider(access)
      if (!provider) throw new Error('Нет доступных движков и моделей для merge-рана')
      const providerDefaultModel = provider === 'codex'
        ? (settings.codexModel.trim() || DEFAULT_CODEX_MODEL)
        : (settings.model.trim() && settings.model !== 'default' ? settings.model.trim() : DEFAULT_CI_CLAUDE_MODEL)
      const modelCandidate = provider === requestedProvider && requestedModel && requestedModel !== 'default' ? requestedModel : providerDefaultModel
      const model = clampModel(access, provider, modelCandidate)
      if (!model) throw new Error('Нет доступных моделей для merge-рана')
      const fallbackReason = provider !== requestedProvider ? 'provider_unavailable' : model !== modelCandidate ? 'model_unavailable' : null
      const role = this.getUser(userId)?.role ?? 'developer'
      const engine = this.resolveLlmEngine(stageLlm.llmEngineId ?? settings.llmEngineId, provider, role)

      const id = this.newId(), now = this.now()
      this.db.prepare(`INSERT INTO merge_runs (id,project_id,task_id,status,triggered_by,source_branch,target_branch,source_sha,agent_id,llm_engine_id,llm_provider,llm_model,requested_llm_provider,requested_llm_model,llm_fallback_reason,stage,started_at,created_at,log)
        VALUES (?,?,?,'queued',?,?,'main',?,?,?,?,?,?,?,?,'queued',?,?,?)`).run(id, projectId, taskId, userId, workspace.branch, workspace.commit_sha, agentId, engine.engine?.id ?? null, provider, model, requestedProvider, requestedModel || null, fallbackReason, now, now, `[${new Date(now).toISOString()}] merge requested by ${userId}\\n`)
      this.db.prepare(`UPDATE tasks SET column_id=(SELECT id FROM kanban_columns WHERE project_id=? AND semantic_type='merge'), updated_at=? WHERE id=?`).run(projectId, now, taskId)
      return this.mapMergeRun(this.db.prepare(`SELECT * FROM merge_runs WHERE id=?`).get(id) as Record<string, unknown>)
    })()
  }

  getMergeRun(userId: string, runId: string): MergeRun | null {
    const row = this.db.prepare(`SELECT r.* FROM merge_runs r JOIN project_members m ON m.project_id=r.project_id AND m.username=? WHERE r.id=?`).get(userId, runId) as Record<string, unknown> | undefined
    return row ? this.mapMergeRun(row) : null
  }

  getMergeRunRaw(runId: string): MergeRun | null {
    const row = this.db.prepare(`SELECT * FROM merge_runs WHERE id=?`).get(runId) as Record<string, unknown> | undefined
    return row ? this.mapMergeRun(row) : null
  }

  listActiveMergeRuns(): MergeRun[] {
    return (this.db.prepare(`SELECT * FROM merge_runs WHERE status IN ('queued','checking','fetching','merging','resolving_conflicts','kb_update','testing','pushing') ORDER BY created_at`).all() as Record<string, unknown>[]).map((row) => this.mapMergeRun(row))
  }

  updateMergeRun(runId: string, fields: Partial<Pick<MergeRun, 'status' | 'stage' | 'sourceSha' | 'targetSha' | 'mergeSha' | 'conflicts' | 'stages' | 'checks' | 'error' | 'recommendedAction' | 'log' | 'pushStartedAt' | 'startedAt' | 'finishedAt' | 'deployId' | 'deployVersion' | 'productionStatus' | 'llmEngineId' | 'llmProvider' | 'llmModel'>>): MergeRun | null {
    const names: Record<string, string> = { sourceSha:'source_sha', targetSha:'target_sha', mergeSha:'merge_sha', conflicts:'conflicts_json', stages:'stages_json', checks:'checks_json', recommendedAction:'recommended_action', pushStartedAt:'push_started_at', startedAt:'started_at', finishedAt:'finished_at', deployId:'deploy_id', deployVersion:'deploy_version', productionStatus:'production_status', llmEngineId:'llm_engine_id', llmProvider:'llm_provider', llmModel:'llm_model' }
    const set: string[] = [], values: unknown[] = []
    for (const [key, value] of Object.entries(fields)) {
      set.push(`${names[key] ?? key}=?`)
      values.push(key === 'conflicts' || key === 'stages' || key === 'checks' ? JSON.stringify(value) : value)
    }
    if (!set.length) return this.getMergeRunRaw(runId)
    this.db.prepare(`UPDATE merge_runs SET ${set.join(',')} WHERE id=?`).run(...values, runId)
    return this.getMergeRunRaw(runId)
  }

  appendMergeLog(runId: string, chunk: string): MergeRun | null {
    this.db.prepare(`UPDATE merge_runs SET log=log || ? WHERE id=?`).run(chunk, runId)
    return this.getMergeRunRaw(runId)
  }

  moveMergeTask(projectId: string, taskId: string, semanticType: 'done' | 'merge' | 'awaiting_merge' | 'decision_required'): void {
    const now = this.now()
    this.db.prepare(`UPDATE tasks SET column_id=(SELECT id FROM kanban_columns WHERE project_id=? AND semantic_type=?), done_at=?, updated_at=? WHERE id=? AND project_id=?`)
      .run(projectId, semanticType, semanticType === 'done' ? now : null, now, taskId, projectId)
  }

  retryMergeRun(userId: string, runId: string, agentIdOverride?: string | null, unpin?: boolean): MergeRun {
    const previous = this.getMergeRun(userId, runId)
    if (!previous) throw new Error('merge run not found')
    if (ACTIVE_MERGE_STATUSES.includes(previous.status)) return previous
    // Retry is an explicit user decision: failed/cancelled runs already stay in
    // merge, while decision_required returns there before creating the next run.
    this.moveMergeTask(previous.projectId, previous.taskId, 'merge')
    const next = this.startMergeRun(userId, previous.projectId, previous.taskId, agentIdOverride ?? previous.agentId, {
      provider: previous.requestedLlmProvider ?? previous.llmProvider,
      model: previous.requestedLlmModel ?? previous.llmModel
    })
    if (unpin || previous.conflicts.length > 0 || /stale source/i.test(previous.error ?? '')) return this.updateMergeRun(next.id, { sourceSha: null }) ?? next
    return next
  }

  listMergeRuns(userId: string, projectId: string, taskId: string, limit = 20): MergeRun[] {
    if (!this.isProjectMember(userId, projectId)) return []
    return (this.db.prepare(`SELECT * FROM merge_runs WHERE task_id=? AND project_id=? ORDER BY created_at DESC LIMIT ?`).all(taskId, projectId, limit) as Record<string, unknown>[]).map((row) => this.mapMergeRun(row))
  }

  getProjectMachine(projectId: string, agentId: string): { agentId: string; path: string; reposRoot: string | null } | null {
    const row = this.db.prepare(`SELECT agent_id, path, repos_root FROM project_machines WHERE project_id=? AND agent_id=?`).get(projectId, agentId) as { agent_id: string; path: string; repos_root: string | null } | undefined
    return row ? { agentId: row.agent_id, path: row.path, reposRoot: row.repos_root } : null
  }

  upsertTaskRepository(projectId: string, taskId: string, agentId: string, path: string, kind: TaskRepository['kind']): void {
    this.db.prepare(`INSERT INTO task_repositories (id,project_id,task_id,agent_id,path,kind,state,created_at) VALUES (?,?,?,?,?,?,'active',?)
      ON CONFLICT(task_id,agent_id,path) DO UPDATE SET state='active', deleted_at=NULL, kind=excluded.kind`).run(this.newId(), projectId, taskId, agentId, path, kind, this.now())
  }

  markTaskRepositoryDeleted(taskId: string, agentId: string, path: string): void {
    this.db.prepare(`UPDATE task_repositories SET state='deleted', deleted_at=? WHERE task_id=? AND agent_id=? AND path=? AND state='active'`).run(this.now(), taskId, agentId, path)
  }

  listActiveTaskRepositories(taskId: string): TaskRepository[] {
    return (this.db.prepare(`SELECT r.*, a.name AS machine_name FROM task_repositories r LEFT JOIN agents a ON a.id=r.agent_id WHERE r.task_id=? AND r.state='active' ORDER BY r.created_at`).all(taskId) as Record<string, unknown>[]).map(mapTaskRepository)
  }

  listTaskRepositories(userId: string, projectId: string, taskId: string): TaskRepository[] {
    if (!this.isProjectMember(userId, projectId)) return []
    return (this.db.prepare(`SELECT r.*, a.name AS machine_name FROM task_repositories r LEFT JOIN agents a ON a.id=r.agent_id WHERE r.task_id=? AND r.project_id=? ORDER BY r.created_at`).all(taskId, projectId) as Record<string, unknown>[]).map(mapTaskRepository)
  }

  private mapMergeRun(r: Record<string, unknown>): MergeRun {
    return {
      id: String(r.id), projectId: String(r.project_id), taskId: String(r.task_id), status: r.status as MergeRun['status'],
      triggeredBy: String(r.triggered_by), sourceBranch: String(r.source_branch), targetBranch: 'main',
      sourceSha: r.source_sha as string | null, targetSha: r.target_sha as string | null, mergeSha: r.merge_sha as string | null,
      revertSha: r.revert_sha as string | null, agentId: String(r.agent_id), llmEngineId: r.llm_engine_id as string | null,
      llmProvider: r.llm_provider as MergeRun['llmProvider'], llmModel: String(r.llm_model ?? ''),
      requestedLlmProvider: r.requested_llm_provider == null ? null : r.requested_llm_provider as MergeRun['llmProvider'],
      requestedLlmModel: r.requested_llm_model == null ? null : String(r.requested_llm_model),
      llmFallbackReason: r.llm_fallback_reason == null ? null : r.llm_fallback_reason as MergeRun['llmFallbackReason'],
      stage: String(r.stage) as MergeRun['stage'],
      stages: parseJsonValue(r.stages_json as string, []), conflicts: parseStringArray(r.conflicts_json as string),
      conflictDetails: parseStringArray(r.conflicts_json as string).map((path) => ({ path })), checks: parseJsonValue(r.checks_json as string, []),
      deployId: r.deploy_id as string | null, deployVersion: r.deploy_version as string | null,
      productionStatus: r.production_status as string | null, error: r.error as string | null, recommendedAction: r.recommended_action as string | null,
      log: String(r.log ?? ''), canCancel: !r.push_started_at && ACTIVE_MERGE_STATUSES.includes(r.status as MergeRun['status']),
      canRetry: !ACTIVE_MERGE_STATUSES.includes(r.status as MergeRun['status']) && r.status !== 'success', pushStartedAt: r.push_started_at as number | null,
      startedAt: r.started_at as number | null, finishedAt: r.finished_at as number | null, createdAt: Number(r.created_at), machineName: this.agentName(String(r.agent_id))
    }
  }

  private preparationEvents(attemptId: string): PreparationEvent[] {
    const rows = this.db.prepare(`SELECT * FROM task_preparation_events WHERE attempt_id=? ORDER BY sequence`).all(attemptId) as Record<string, unknown>[]
    return rows.map((row) => ({
      eventId: String(row.event_id), attemptId: String(row.attempt_id), sequence: Number(row.sequence),
      timestamp: Number(row.timestamp), type: String(row.type), phase: row.phase as TaskPreparationPhase,
      text: String(row.text), ...(row.data_json ? { data: parseJsonValue<Record<string, unknown>>(String(row.data_json), {}) } : {})
    }))
  }

  private preparationQuestions(attemptId: string): PreparationQuestion[] {
    const rows = this.db.prepare(`SELECT * FROM task_preparation_questions WHERE attempt_id=? ORDER BY asked_at,question_id`).all(attemptId) as Record<string, unknown>[]
    return rows.map((row) => ({
      questionId: String(row.question_id), attemptId: String(row.attempt_id), text: String(row.text),
      material: Boolean(row.material), status: row.answered_at == null ? 'open' : 'answered',
      answer: row.answer as string | null, askedAt: Number(row.asked_at),
      answeredAt: row.answered_at == null ? null : Number(row.answered_at), answeredBy: row.answered_by as string | null
    }))
  }

  private mapTaskPreparationRun(row: Record<string, unknown>): TaskPreparationRun {
    const status = row.status as TaskPreparationRun['status']
    const createdAt = Number(row.created_at)
    const startedAt = row.started_at == null ? createdAt : Number(row.started_at)
    const finishedAt = row.finished_at == null ? null : Number(row.finished_at)
    return {
      id: String(row.id), attemptId: String(row.id), projectId: String(row.project_id), taskId: String(row.task_id),
      taskKey: String(row.task_key || row.task_id), status, phase: (row.phase || (status === 'success' ? 'completed' : 'initialization')) as TaskPreparationPhase,
      attempt: Number(row.attempt), attemptNumber: Number(row.attempt), maxAttempts: 2,
      llmEngineId: row.llm_engine_id as string | null, provider: (row.provider ?? 'claude') as LlmProvider,
      model: String(row.model ?? ''), profileId: String(row.profile_id ?? ''),
      log: String(row.log ?? ''), events: this.preparationEvents(String(row.id)), questions: this.preparationQuestions(String(row.id)),
      error: row.error as string | null,
      readiness: row.readiness_json ? parseJsonValue<DevelopmentReadiness>(String(row.readiness_json), null as unknown as DevelopmentReadiness) : null,
      gateReasons: parseStringArray(String(row.gate_reasons_json ?? '[]')),
      gateResults: parseJsonValue<PreparationGateResult[]>(String(row.gate_results_json ?? '[]'), []),
      createdAt, startedAt, finishedAt, durationMs: Math.max(0, (finishedAt ?? this.now()) - startedAt),
      canRetry: status === 'failed' || status === 'cancelled' || status === 'blocked',
      canCancel: status === 'queued' || status === 'running' || status === 'waiting_for_answer' || status === 'validating',
      canAnswer: status === 'waiting_for_answer'
    }
  }

  getTaskPreparationRun(userId: string, runId: string): TaskPreparationRun | null {
    const row = this.db.prepare(`SELECT p.* FROM task_preparation_runs p JOIN project_members m ON m.project_id=p.project_id WHERE p.id=? AND m.username=?`).get(runId, userId) as Record<string, unknown> | undefined
    return row ? this.mapTaskPreparationRun(row) : null
  }

  listTaskPreparationRuns(userId: string, projectId: string, taskId: string): TaskPreparationRun[] {
    if (!this.isProjectMember(userId, projectId)) return []
    return (this.db.prepare(`SELECT * FROM task_preparation_runs WHERE project_id=? AND task_id=? ORDER BY attempt DESC`).all(projectId, taskId) as Record<string, unknown>[]).map((row) => this.mapTaskPreparationRun(row))
  }

  appendTaskPreparationEvent(attemptId: string, type: string, phase: TaskPreparationPhase, text: string, data?: Record<string, unknown>): PreparationEvent | null {
    return this.db.transaction(() => {
      const run = this.db.prepare(`SELECT id FROM task_preparation_runs WHERE id=?`).get(attemptId)
      if (!run) return null
      const sequence = Number((this.db.prepare(`SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM task_preparation_events WHERE attempt_id=?`).get(attemptId) as { sequence: number }).sequence)
      const eventId = this.newId(), timestamp = this.now(), safeText = redactPreparationText(text)
      this.db.prepare(`INSERT INTO task_preparation_events (event_id,attempt_id,sequence,timestamp,type,phase,text,data_json) VALUES (?,?,?,?,?,?,?,?)`).run(
        eventId, attemptId, sequence, timestamp, type, phase, safeText, data ? JSON.stringify(data) : null
      )
      return { eventId, attemptId, sequence, timestamp, type, phase, text: safeText, ...(data ? { data } : {}) }
    })()
  }

  transitionTaskPreparationRun(id: string, status: TaskPreparationRun['status'], phase: TaskPreparationPhase, text: string): void {
    const terminal = ['success', 'completed', 'failed', 'cancelled', 'blocked']
    this.db.transaction(() => {
      const row = this.db.prepare(`SELECT status FROM task_preparation_runs WHERE id=?`).get(id) as { status: string } | undefined
      if (!row || terminal.includes(row.status)) return
      this.db.prepare(`UPDATE task_preparation_runs SET status=?,phase=? WHERE id=?`).run(status, phase, id)
      this.appendTaskPreparationEvent(id, 'state_changed', phase, text, { status, phase })
    })()
  }

  createTaskPreparationQuestion(id: string, text: string, material = true): PreparationQuestion | null {
    const questionId = this.newId(), askedAt = this.now(), safeText = redactPreparationText(text)
    const changed = this.db.prepare(`INSERT INTO task_preparation_questions (question_id,attempt_id,text,material,asked_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM task_preparation_runs WHERE id=? AND status IN ('running','validating'))`).run(questionId, id, safeText, material ? 1 : 0, askedAt, id)
    if (!changed.changes) return null
    this.transitionTaskPreparationRun(id, 'waiting_for_answer', 'clarification', 'Требуется ответ на существенный вопрос')
    this.appendTaskPreparationEvent(id, 'question_asked', 'clarification', safeText, { questionId, material })
    return this.preparationQuestions(id).find((question) => question.questionId === questionId) ?? null
  }

  answerTaskPreparationQuestion(userId: string, questionId: string, answer: string): PreparationAnswerResult | null {
    return this.db.transaction(() => {
      const row = this.db.prepare(`SELECT q.attempt_id FROM task_preparation_questions q JOIN task_preparation_runs r ON r.id=q.attempt_id JOIN project_members m ON m.project_id=r.project_id WHERE q.question_id=? AND m.username=?`).get(questionId, userId) as { attempt_id: string } | undefined
      if (!row) return null
      const safeAnswer = redactPreparationText(answer).trim()
      if (!safeAnswer) throw new Error('Ответ не может быть пустым')
      const answeredAt = this.now()
      const result = this.db.prepare(`UPDATE task_preparation_questions SET answer=?,answered_at=?,answered_by=? WHERE question_id=? AND answered_at IS NULL`).run(safeAnswer, answeredAt, userId, questionId)
      const question = this.preparationQuestions(row.attempt_id).find((item) => item.questionId === questionId)!
      if (!result.changes) return { accepted: false, alreadyAnswered: true, question }
      this.db.prepare(`UPDATE task_preparation_runs SET status='queued',phase='clarification' WHERE id=? AND status='waiting_for_answer'`).run(row.attempt_id)
      this.appendTaskPreparationEvent(row.attempt_id, 'answer_accepted', 'clarification', 'Ответ принят', { questionId })
      return { accepted: true, alreadyAnswered: false, question }
    })()
  }

  listTaskPreparationNotifications(userId: string): PreparationClarificationNotification[] {
    const rows = this.db.prepare(`
      SELECT q.question_id,q.attempt_id,q.text,q.asked_at,
             r.project_id,r.task_id,p.name AS project_name,t.title AS task_title,
             d.dismissed_at
      FROM task_preparation_questions q
      JOIN task_preparation_runs r ON r.id=q.attempt_id
      JOIN projects p ON p.id=r.project_id
      JOIN tasks t ON t.id=r.task_id
      JOIN project_members m ON m.project_id=r.project_id AND m.username=?
      LEFT JOIN task_preparation_notification_dismissals d
        ON d.question_id=q.question_id AND d.user_id=?
      WHERE q.material=1 AND q.answered_at IS NULL AND r.status='waiting_for_answer'
      ORDER BY q.asked_at,q.question_id
    `).all(userId, userId) as Record<string, unknown>[]
    return rows.map((row) => ({
      questionId: String(row.question_id), attemptId: String(row.attempt_id),
      projectId: String(row.project_id), projectName: String(row.project_name),
      taskId: String(row.task_id), taskTitle: String(row.task_title),
      text: String(row.text), askedAt: Number(row.asked_at),
      dismissedAt: row.dismissed_at == null ? null : Number(row.dismissed_at)
    }))
  }

  dismissTaskPreparationNotification(userId: string, questionId: string): boolean {
    const now = this.now()
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO task_preparation_notification_dismissals (question_id,user_id,dismissed_at)
      SELECT q.question_id,?,?
      FROM task_preparation_questions q
      JOIN task_preparation_runs r ON r.id=q.attempt_id
      JOIN project_members m ON m.project_id=r.project_id AND m.username=?
      WHERE q.question_id=? AND q.material=1 AND q.answered_at IS NULL AND r.status='waiting_for_answer'
    `).run(userId, now, userId, questionId)
    if (result.changes) return true
    return Boolean(this.db.prepare(`SELECT 1 FROM task_preparation_notification_dismissals WHERE question_id=? AND user_id=?`).get(questionId, userId))
  }

  confirmedDevelopmentReadiness(taskId: string): DevelopmentReadiness | null {
    const row = this.db.prepare(`SELECT id,readiness_json,gate_results_json FROM task_preparation_runs WHERE task_id=? AND status IN ('success','completed') AND readiness_json IS NOT NULL ORDER BY attempt DESC LIMIT 1`).get(taskId) as { id: string; readiness_json: string; gate_results_json: string } | undefined
    if (!row) return null
    const readiness = parseJsonValue<DevelopmentReadiness | null>(row.readiness_json, null)
    if (!readiness) return null
    if (readiness.schemaVersion !== 2) return readiness
    const gates = parseJsonValue<PreparationGateResult[]>(row.gate_results_json, [])
    if (!readiness.confirmation?.confirmed || readiness.confirmation.attemptId !== row.id || !gates.length || gates.some((gate) => gate.status !== 'pass')) return null
    return readiness
  }

  getTaskLaunchPreparationResult(userId: string, projectId: string, proposalId: string): TaskLaunchResult | null {
    if (!this.isProjectMember(userId, projectId)) return null
    const row = this.db.prepare(`SELECT task_id,run_id,error FROM task_launch_results WHERE project_id=? AND proposal_id=? AND action='preparation'`).get(projectId, proposalId) as { task_id: string; run_id: string | null; error: string | null } | undefined
    if (!row) return null
    if (row.error) return { type: 'preparation', status: 'partial', taskId: row.task_id, runId: row.run_id ?? undefined, error: row.error, canRetry: true }
    if (!row.run_id) return { type: 'preparation', status: 'partial', taskId: row.task_id, error: 'Подготовка ещё не запущена', canRetry: true }
    return { type: 'preparation', status: 'success', taskId: row.task_id, runId: row.run_id }
  }

  createTaskFromProposalInPreparation(userId: string, projectId: string, proposalId: string, args: Omit<Parameters<VoiceChatDb['createTask']>[2], 'columnId'>): TaskLaunchResult {
    if (!this.isProjectMember(userId, projectId)) throw new Error('Проект недоступен')
    const previous = this.getTaskLaunchPreparationResult(userId, projectId, proposalId)
    if (previous) return previous
    const columns = this.db.prepare(`SELECT id FROM kanban_columns WHERE project_id=? AND semantic_type='preparation'`).all(projectId) as Array<{ id: string }>
    if (columns.length !== 1) throw new Error(columns.length === 0 ? 'Не настроена колонка с semantic type preparation' : 'Найдено несколько колонок с semantic type preparation')
    return this.db.transaction(() => {
      const repeated = this.getTaskLaunchPreparationResult(userId, projectId, proposalId)
      if (repeated) return repeated
      const task = this.createTask(userId, projectId, { ...args, columnId: columns[0].id })
      if (!task) throw new Error('Не удалось создать задачу')
      const now = this.now()
      this.db.prepare(`INSERT INTO task_launch_results (project_id,proposal_id,action,task_id,created_by,created_at,updated_at) VALUES (?,?,'preparation',?,?,?,?)`).run(projectId, proposalId, task.id, userId, now, now)
      return { type: 'preparation', status: 'partial', taskId: task.id, error: 'Подготовка ещё не запущена', canRetry: true } as TaskLaunchResult
    })()
  }

  saveTaskLaunchPreparationRun(projectId: string, proposalId: string, runId: string | null, error: string | null): void {
    this.db.prepare(`UPDATE task_launch_results SET run_id=?,error=?,updated_at=? WHERE project_id=? AND proposal_id=? AND action='preparation'`).run(runId, error, this.now(), projectId, proposalId)
  }

  startTaskPreparationRun(userId: string, projectId: string, taskId: string): TaskPreparationRun {
    if (!this.isProjectMember(userId, projectId)) throw new Error('Проект недоступен')
    const task = this.getTask(projectId, taskId)
    if (!task || task.type !== 'task') throw new Error('Задача не найдена')
    const board = this.getBoard(userId, projectId)
    const current = board?.columns.find((column) => column.id === task.columnId)
    if (current?.semanticType !== 'backlog' && current?.semanticType !== 'preparation') throw new Error('Подготовку можно запускать только из TODO или Подготовки к разработке')
    const active = this.db.prepare(`SELECT * FROM task_preparation_runs WHERE task_id=? AND status IN ('queued','running','waiting_for_answer','validating')`).get(taskId) as Record<string, unknown> | undefined
    if (active) return this.mapTaskPreparationRun(active)
    const preparationColumns = board?.columns.filter((column) => column.semanticType === 'preparation') ?? []
    if (preparationColumns.length !== 1) throw new Error(preparationColumns.length === 0 ? 'Не настроена колонка с semantic type preparation' : 'Найдено несколько колонок с semantic type preparation')
    const target = preparationColumns[0].id
    const id = this.newId(), now = this.now()
    const attempt = Number((this.db.prepare(`SELECT COALESCE(MAX(attempt), 0) + 1 AS attempt FROM task_preparation_runs WHERE task_id=?`).get(taskId) as { attempt: number }).attempt)
    const profileId = createHash('sha256').update(userId).digest('hex').slice(0, 16)
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO task_preparation_runs (id,project_id,task_id,task_key,status,phase,attempt,profile_id,created_at,started_at) VALUES (?,?,?,?, 'running','initialization',?,?,?,?)`).run(id, projectId, taskId, taskId, attempt, profileId, now, now)
      this.appendTaskPreparationEvent(id, 'attempt_created', 'initialization', 'Попытка подготовки создана')
      this.appendTaskPreparationEvent(id, 'attempt_started', 'initialization', 'Подготовка запущена')
      if (task.columnId !== target) this.moveTask(userId, projectId, taskId, { columnId: target })
    })()
    return this.getTaskPreparationRun(userId, id)!
  }

  appendTaskPreparationLog(id: string, chunk: string): void {
    const safe = redactPreparationText(chunk)
    this.db.prepare(`UPDATE task_preparation_runs SET log=substr(log || ?, -500000) WHERE id=? AND status IN ('queued','running','validating')`).run(safe, id)
    if (safe.trim()) {
      const phase = (this.db.prepare(`SELECT phase FROM task_preparation_runs WHERE id=?`).get(id) as { phase: TaskPreparationPhase } | undefined)?.phase ?? 'brief_generation'
      this.appendTaskPreparationEvent(id, 'model_output', phase, safe)
    }
  }

  setTaskPreparationExecution(id: string, execution: { llmEngineId?: string | null; provider: LlmProvider; model: string }, phase: TaskPreparationPhase = 'knowledge_research'): void {
    this.db.prepare(`UPDATE task_preparation_runs SET llm_engine_id=?,provider=?,model=?,status='running',phase=? WHERE id=? AND status IN ('queued','running')`).run(execution.llmEngineId ?? null, execution.provider, redactPreparationText(execution.model), phase, id)
    this.appendTaskPreparationEvent(id, 'research_started', phase, 'Исследование источников начато')
  }

  completeTaskPreparationRun(userId: string, id: string, readiness: DevelopmentReadiness): TaskPreparationRun | null {
    const run = this.getTaskPreparationRun(userId, id)
    if (!run || (run.status !== 'running' && run.status !== 'validating')) return run
    const target = this.getColumnIdBySemantic(run.projectId, 'ready')
    if (!target) throw new Error('Колонка Ready for Development не найдена')
    const gateResults = developmentReadinessGateResults(readiness)
    const reasons = gateResults.filter((result) => result.status === 'fail').flatMap((result) => result.refs)
    if (reasons.length) {
      this.blockTaskPreparationRun(id, 'Гейт готовности не пройден', reasons, gateResults)
      return this.getTaskPreparationRun(userId, id)
    }
    const sanitized = JSON.parse(JSON.stringify(readiness, (_key, value) => typeof value === 'string' ? redactPreparationText(value) : value)) as DevelopmentReadiness
    const now = this.now()
    if (sanitized.schemaVersion === 2) sanitized.confirmation = { confirmed: true, confirmedAt: now, confirmedBy: run.profileId ?? '', attemptId: id }
    this.db.transaction(() => {
      this.db.prepare(`UPDATE tasks SET description=?,acceptance_criteria=?,updated_at=? WHERE id=?`).run(sanitized.functionalRequirements.trim(), sanitized.acceptanceCriteria.trim(), now, run.taskId)
      for (const testCase of sanitized.testCases) {
        this.createAcceptanceCriterion(userId, run.projectId, run.taskId, {
          title: testCase.title, description: testCase.description, preconditions: testCase.preconditions,
          steps: testCase.steps, testData: testCase.testData, expectedResult: testCase.expectedResult,
          required: testCase.required, testType: testCase.testType
        })
      }
      this.appendTaskPreparationEvent(id, 'gate_completed', 'readiness_validation', 'Все проверки готовности пройдены', { gateResults })
      this.appendTaskPreparationEvent(id, 'brief_persisted', 'persistence', 'Development Brief сохранён')
      this.moveTask(userId, run.projectId, run.taskId, { columnId: target })
      this.db.prepare(`UPDATE task_preparation_runs SET status='success',phase='completed',readiness_json=?,gate_reasons_json='[]',gate_results_json=?,finished_at=? WHERE id=? AND status IN ('running','validating')`).run(JSON.stringify(sanitized), JSON.stringify(gateResults), now, id)
      this.appendTaskPreparationEvent(id, 'attempt_completed', 'completed', 'Подготовка успешно завершена')
    })()
    return this.getTaskPreparationRun(userId, id)
  }

  blockTaskPreparationRun(id: string, error: string, reasons: string[], gateResults: PreparationGateResult[] = []): void {
    const now = this.now(), safeError = redactPreparationText(error)
    this.db.prepare(`UPDATE task_preparation_runs SET status='blocked',phase='readiness_validation',error=?,gate_reasons_json=?,gate_results_json=?,finished_at=? WHERE id=? AND status IN ('queued','running','waiting_for_answer','validating')`).run(safeError, JSON.stringify(reasons), JSON.stringify(gateResults), now, id)
    this.appendTaskPreparationEvent(id, 'attempt_blocked', 'readiness_validation', safeError, { reasons })
  }

  failTaskPreparationRun(id: string, error: string, reasons: string[] = []): void {
    const safeError = redactPreparationText(error)
    this.db.prepare(`UPDATE task_preparation_runs SET status='failed',error=?,gate_reasons_json=?,finished_at=? WHERE id=? AND status IN ('queued','running','validating')`).run(safeError, JSON.stringify(reasons), this.now(), id)
    this.appendTaskPreparationEvent(id, 'attempt_failed', 'completed', safeError, { reasons })
  }

  cancelTaskPreparationRun(userId: string, id: string, reason = 'Подготовка отменена пользователем'): TaskPreparationRun | null {
    const run = this.getTaskPreparationRun(userId, id)
    if (!run) return null
    const safeReason = redactPreparationText(reason)
    const changed = this.db.prepare(`UPDATE task_preparation_runs SET status='cancelled',error=?,finished_at=? WHERE id=? AND status IN ('queued','running','waiting_for_answer','validating')`).run(safeReason, this.now(), id)
    if (changed.changes) this.appendTaskPreparationEvent(id, 'attempt_cancelled', 'completed', safeReason, { initiatedBy: run.profileId })
    return this.getTaskPreparationRun(userId, id)
  }

  failInterruptedTaskPreparationRuns(): string[] {
    const rows = this.db.prepare(`SELECT id FROM task_preparation_runs WHERE status IN ('queued','running','validating')`).all() as Array<{ id: string }>
    for (const row of rows) this.failTaskPreparationRun(row.id, 'Подготовка прервана перезапуском сервера')
    return rows.map((row) => row.id)
  }

  private mapQaStageRun(row: Record<string, unknown>): AnyQaStageRun {
    const stage = row.stage as QaRunStage
    const status = row.status as QaStageRunStatus
    return {
      id: String(row.id), projectId: String(row.project_id), taskId: String(row.task_id),
      kind: QA_RUN_KIND[stage], stage, status, attempt: Number(row.attempt),
      triggeredBy: String(row.triggered_by), branch: String(row.branch ?? ''), commitSha: String(row.commit_sha ?? ''),
      llmEngineId: row.llm_engine_id as string | null, llmProvider: (row.llm_provider ?? 'claude') as LlmProvider,
      llmModel: String(row.llm_model ?? ''), currentStep: String(row.current_step ?? ''),
      progress: parseJsonValue(String(row.progress_json ?? '{}'), { current: 0, total: 0, label: '' }),
      log: parseJsonValue(String(row.log_json ?? '[]'), []), result: row.result_json ? parseJsonValue(String(row.result_json), {}) : null,
      gateReasons: parseStringArray(String(row.gate_reasons_json ?? '[]')), error: row.error as string | null,
      createdAt: Number(row.created_at), startedAt: row.started_at == null ? null : Number(row.started_at),
      finishedAt: row.finished_at == null ? null : Number(row.finished_at),
      canCancel: ['queued','running','awaiting_input'].includes(status),
      canRetry: ['gate_failed','failed','cancelled','interrupted'].includes(status)
    } as AnyQaStageRun
  }

  getQaStageRun(userId: string, runId: string): AnyQaStageRun | null {
    const row = this.db.prepare(`SELECT r.* FROM qa_stage_runs r JOIN project_members m ON m.project_id=r.project_id WHERE r.id=? AND m.username=?`).get(runId, userId) as Record<string, unknown> | undefined
    return row ? this.mapQaStageRun(row) : null
  }

  listQaStageRuns(userId: string, projectId: string, taskId: string, stage: QaRunStage): AnyQaStageRun[] {
    if (!this.isProjectMember(userId, projectId)) return []
    return (this.db.prepare(`SELECT * FROM qa_stage_runs WHERE project_id=? AND task_id=? AND stage=? ORDER BY attempt DESC`).all(projectId, taskId, stage) as Record<string, unknown>[]).map((row) => this.mapQaStageRun(row))
  }

  startQaStageRun(userId: string, projectId: string, taskId: string, stage: QaRunStage): AnyQaStageRun {
    if (!this.isProjectMember(userId, projectId)) throw new Error('Проект недоступен')
    const task = this.getTask(projectId, taskId)
    if (!task || task.type !== 'task') throw new Error('Задача не найдена')
    const current = this.getBoard(userId, projectId)?.columns.find((column) => column.id === task.columnId)
    if (current?.semanticType !== stage) throw new Error(`Этап ${stage} нельзя запустить из колонки ${current?.semanticType ?? 'unknown'}`)
    const active = this.db.prepare(`SELECT * FROM qa_stage_runs WHERE task_id=? AND stage=? AND status IN ('queued','running','awaiting_input')`).get(taskId, stage) as Record<string, unknown> | undefined
    if (active) return this.mapQaStageRun(active)
    const attempt = Number((this.db.prepare(`SELECT COALESCE(MAX(attempt),0)+1 AS n FROM qa_stage_runs WHERE task_id=? AND stage=?`).get(taskId, stage) as { n: number }).n)
    const id = this.newId(), now = this.now()
    this.db.prepare(`INSERT INTO qa_stage_runs
      (id,project_id,task_id,stage,status,attempt,triggered_by,branch,commit_sha,current_step,created_at,started_at)
      VALUES (?,?,?,?,'running',?,?,?,?, 'starting',?,?)`).run(
        id, projectId, taskId, stage, attempt, userId, task.mergeSourceBranch ?? '', task.mergeSourceSha ?? '', now, now
      )
    return this.getQaStageRun(userId, id)!
  }

  updateQaStageRun(runId: string, patch: {
    status?: QaStageRunStatus; currentStep?: string; progress?: { current: number; total: number; label: string }
    log?: Array<{ seq: number; at: number; stream: 'out'|'err'|'system'; text: string }>
    result?: Record<string, unknown> | null; gateReasons?: string[]; error?: string | null
  }): void {
    const current = this.db.prepare(`SELECT * FROM qa_stage_runs WHERE id=?`).get(runId) as Record<string, unknown> | undefined
    if (!current) return
    const status = patch.status ?? current.status as QaStageRunStatus
    const terminal = ['success','gate_failed','failed','cancelled','interrupted'].includes(status)
    this.db.prepare(`UPDATE qa_stage_runs SET status=?,current_step=?,progress_json=?,log_json=?,result_json=?,gate_reasons_json=?,error=?,finished_at=? WHERE id=?`).run(
      status, patch.currentStep ?? current.current_step, JSON.stringify(patch.progress ?? parseJsonValue(String(current.progress_json), {})),
      JSON.stringify(patch.log ?? parseJsonValue(String(current.log_json), [])),
      patch.result === undefined ? current.result_json : patch.result == null ? null : JSON.stringify(patch.result),
      JSON.stringify(patch.gateReasons ?? parseStringArray(String(current.gate_reasons_json))),
      patch.error === undefined ? current.error : patch.error, terminal ? this.now() : current.finished_at, runId
    )
  }

  completeQaStageRun(userId: string, runId: string, result: Record<string, unknown>): AnyQaStageRun | null {
    const run = this.getQaStageRun(userId, runId)
    if (!run || !['running','awaiting_input'].includes(run.status)) return run
    let reasons: string[] = []
    if (run.stage === 'integration_tests') {
      const testCases = Array.isArray(result.testCases) ? result.testCases as import('@voicechat/shared').TestCaseDefinition[] : []
      reasons = testCases.some((testCase) => testCase.required) ? canCompleteAutomation(testCases, run.commitSha).reasons : ['missing_required_test_cases']
    } else if (result.gatePassed !== true) {
      reasons = Array.isArray(result.gateReasons) ? result.gateReasons.filter((item): item is string => typeof item === 'string') : ['quality_gate_failed']
    }
    if (reasons.length) {
      this.updateQaStageRun(runId, { status: 'gate_failed', result, gateReasons: reasons, currentStep: 'gate' })
      return this.getQaStageRun(userId, runId)
    }
    const next: Record<QaRunStage, KanbanColumnSemanticType> = { component_qa: 'integration_tests', integration_tests: 'automated_qa', automated_qa: 'manual_qa' }
    const target = this.getColumnIdBySemantic(run.projectId, next[run.stage])
    if (!target) throw new Error(`Следующая колонка ${next[run.stage]} не найдена`)
    this.db.transaction(() => {
      this.updateQaStageRun(runId, { status: 'success', result, gateReasons: [], currentStep: 'complete' })
      this.moveTask(userId, run.projectId, run.taskId, { columnId: target })
    })()
    return this.getQaStageRun(userId, runId)
  }

  cancelQaStageRun(userId: string, runId: string): AnyQaStageRun | null {
    const run = this.getQaStageRun(userId, runId)
    if (!run) return null
    if (run.canCancel) this.updateQaStageRun(runId, { status: 'cancelled', error: 'Ран отменён пользователем' })
    return this.getQaStageRun(userId, runId)
  }

  retryQaStageRun(userId: string, runId: string): AnyQaStageRun | null {
    const run = this.getQaStageRun(userId, runId)
    if (!run) return null
    if (!run.canRetry) throw new Error('Повтор этого рана недоступен')
    return this.startQaStageRun(userId, run.projectId, run.taskId, run.stage)
  }

  answerQaStageRun(userId: string, runId: string, answer: string): AnyQaStageRun | null {
    const run = this.getQaStageRun(userId, runId)
    if (!run || run.stage !== 'integration_tests' || run.status !== 'awaiting_input') throw new Error('Ран не ожидает ответа')
    if (!answer.trim()) throw new Error('Ответ не может быть пустым')
    this.updateQaStageRun(runId, { status: 'running', currentStep: 'model_answered' })
    return this.getQaStageRun(userId, runId)
  }

  failInterruptedQaStageRuns(): string[] {
    const rows = this.db.prepare(`SELECT id FROM qa_stage_runs WHERE status IN ('queued','running','awaiting_input')`).all() as Array<{ id: string }>
    this.db.prepare(`UPDATE qa_stage_runs SET status='interrupted',error='Ран прерван перезапуском сервера',finished_at=? WHERE status IN ('queued','running','awaiting_input')`).run(this.now())
    return rows.map((row) => row.id)
  }

  getQaTaskState(userId: string, projectId: string, taskId: string): QaTaskState | null {
    if (!this.isProjectMember(userId, projectId)) return null
    const task = this.db.prepare(`SELECT 1 FROM tasks WHERE id = ? AND project_id = ?`).get(taskId, projectId)
    if (!task) return null
    const criteria = (this.db.prepare(`SELECT * FROM acceptance_criteria WHERE task_id = ? ORDER BY position`).all(taskId) as QaCriterionRow[]).map(mapQaCriterion)
    const versions = criteria.flatMap((criterion) =>
      (this.db.prepare(`SELECT * FROM acceptance_criterion_versions WHERE criterion_id = ? ORDER BY version DESC`).all(criterion.id) as QaCriterionVersionRow[]).map(mapQaCriterionVersion)
    )
    const sessions = (this.db.prepare(`SELECT * FROM qa_sessions WHERE task_id = ? ORDER BY started_at DESC`).all(taskId) as QaSessionRow[]).map((row) => this.mapQaSession(row))
    const rawPreparation = this.db.prepare(`SELECT * FROM qa_preparation_runs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1`).get(taskId) as Record<string, unknown> | undefined
    const preparation = rawPreparation ? {
      id: String(rawPreparation.id), taskId, branch: String(rawPreparation.branch), commitSha: String(rawPreparation.commit_sha),
      status: rawPreparation.status as 'running'|'success'|'failed', attempt: Number(rawPreparation.attempt), maxAttempts: 2,
      error: rawPreparation.error as string | null, attempts: parseJsonValue(String(rawPreparation.diagnostics_json ?? '[]'), []),
      createdAt: Number(rawPreparation.created_at), finishedAt: rawPreparation.finished_at == null ? null : Number(rawPreparation.finished_at),
      canRetry: rawPreparation.status === 'failed', log: String(rawPreparation.log ?? '')
    } : null
    return { criteria, versions, sessions, activeSession: sessions.find((session) => session.status === 'active') ?? null, preparation, canEdit: this.canQa(userId, projectId) }
  }

  createAcceptanceCriterion(userId: string, projectId: string, taskId: string, input: AcceptanceCriterionSnapshot & { order?: number }): AcceptanceCriterion | null {
    if (!this.isProjectMember(userId, projectId)) return null
    if (!this.db.prepare(`SELECT 1 FROM tasks WHERE id = ? AND project_id = ?`).get(taskId, projectId)) return null
    const now = this.now(), id = this.newId()
    const order = input.order ?? ((this.db.prepare(`SELECT COALESCE(MAX(position), 0) + 1 AS n FROM acceptance_criteria WHERE task_id = ?`).get(taskId) as { n: number }).n)
    const snapshot = qaSnapshot(input)
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO acceptance_criteria
        (id, task_id, position, title, description, preconditions, steps, test_data, expected_result, required, test_type, current_version, active, author, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`).run(
          id, taskId, order, snapshot.title, snapshot.description, snapshot.preconditions, snapshot.steps,
          snapshot.testData, snapshot.expectedResult, snapshot.required ? 1 : 0, snapshot.testType, userId, now, now
        )
      this.db.prepare(`INSERT INTO acceptance_criterion_versions (criterion_id, version, snapshot_json, author, reason, created_at) VALUES (?, 1, ?, ?, 'initial', ?)`)
        .run(id, JSON.stringify(snapshot), userId, now)
      this.addQaAudit(projectId, taskId, userId, 'criterion.created', { criterionId: id, version: 1 })
    })()
    return mapQaCriterion(this.db.prepare(`SELECT * FROM acceptance_criteria WHERE id = ?`).get(id) as QaCriterionRow)
  }

  reviseAcceptanceCriterion(userId: string, projectId: string, taskId: string, criterionId: string, input: AcceptanceCriterionSnapshot & { reason: string; semanticChange?: boolean }): AcceptanceCriterion | null {
    if (!this.isProjectMember(userId, projectId)) return null
    const current = this.db.prepare(`SELECT * FROM acceptance_criteria WHERE id = ? AND task_id = ?`).get(criterionId, taskId) as QaCriterionRow | undefined
    if (!current) return null
    const now = this.now(), snapshot = qaSnapshot(input)
    const version = current.current_version + (input.semanticChange === false ? 0 : 1)
    this.db.transaction(() => {
      if (version !== current.current_version) {
        this.db.prepare(`UPDATE acceptance_criterion_versions SET superseded_by = ? WHERE criterion_id = ? AND version = ?`).run(version, criterionId, current.current_version)
        this.db.prepare(`INSERT INTO acceptance_criterion_versions (criterion_id, version, snapshot_json, author, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(criterionId, version, JSON.stringify(snapshot), userId, input.reason.trim(), now)
      }
      this.db.prepare(`UPDATE acceptance_criteria SET title=?, description=?, preconditions=?, steps=?, test_data=?, expected_result=?, required=?, test_type=?, current_version=?, updated_at=? WHERE id=?`)
        .run(snapshot.title, snapshot.description, snapshot.preconditions, snapshot.steps, snapshot.testData, snapshot.expectedResult, snapshot.required ? 1 : 0, snapshot.testType, version, now, criterionId)
      if (version !== current.current_version) {
        this.db.prepare(`UPDATE qa_sessions SET status='stale', stale_reason='criteria_snapshot_changed', finished_at=? WHERE task_id=? AND status='active'`).run(now, taskId)
      }
      this.addQaAudit(projectId, taskId, userId, version === current.current_version ? 'criterion.edited' : 'criterion.versioned', { criterionId, version, reason: input.reason })
    })()
    return mapQaCriterion(this.db.prepare(`SELECT * FROM acceptance_criteria WHERE id = ?`).get(criterionId) as QaCriterionRow)
  }

  startQaPreparationRun(projectId: string, taskId: string, branch: string, commitSha: string, retry = false): { id: string; status: string } | null {
    const existing = this.db.prepare(`SELECT id,status FROM qa_preparation_runs WHERE task_id=? AND commit_sha=?`).get(taskId, commitSha) as { id:string; status:string } | undefined
    if (existing) {
      if (!retry || existing.status !== 'failed') return null
      const changed = this.db.prepare(`UPDATE qa_preparation_runs SET status='running',error=NULL,attempt=1,diagnostics_json='[]',log='',created_at=?,finished_at=NULL WHERE id=? AND status='failed'`).run(this.now(), existing.id)
      return changed.changes ? { id: existing.id, status: 'running' } : null
    }
    const id = this.newId()
    this.db.prepare(`INSERT INTO qa_preparation_runs (id,project_id,task_id,branch,commit_sha,status,created_at) VALUES (?,?,?,?,?,'running',?)`).run(id,projectId,taskId,branch,commitSha,this.now())
    const active = this.db.prepare(`SELECT commit_sha FROM qa_sessions WHERE project_id=? AND task_id=? AND status='active' LIMIT 1`).get(projectId,taskId) as { commit_sha:string } | undefined
    if (active && active.commit_sha !== commitSha) this.markQaSessionStale(projectId, taskId, `Новый commit SHA: ${commitSha}`)
    return { id, status: 'running' }
  }

  appendQaPreparationLog(id: string, chunk: string): void {
    this.db.prepare(`UPDATE qa_preparation_runs SET log=substr(log || ?, -500000) WHERE id=? AND status='running'`).run(chunk,id)
  }

  recordQaPreparationAttempt(id: string, attempt: number, rawResponse: string, error: string | null): void {
    const row = this.db.prepare(`SELECT diagnostics_json FROM qa_preparation_runs WHERE id=? AND status='running'`).get(id) as { diagnostics_json: string } | undefined
    if (!row) return
    const diagnostics = parseJsonValue<Array<Record<string, unknown>>>(row.diagnostics_json, [])
    diagnostics.push({ attempt, rawResponse: rawResponse.slice(-500000), error, status: error ? 'failed' : 'success' })
    this.db.prepare(`UPDATE qa_preparation_runs SET attempt=?,diagnostics_json=? WHERE id=? AND status='running'`).run(attempt, JSON.stringify(diagnostics), id)
  }

  finishQaPreparationRun(id: string, status: 'success'|'failed', error: string | null = null): void {
    this.db.prepare(`UPDATE qa_preparation_runs SET status=?,error=?,finished_at=? WHERE id=? AND status='running'`).run(status,error,this.now(),id)
  }

  failInterruptedQaPreparationRuns(): string[] {
    const rows = this.db.prepare(`SELECT id FROM qa_preparation_runs WHERE status='running'`).all() as Array<{ id: string }>
    this.db.prepare(`UPDATE qa_preparation_runs SET status='failed',error='Подготовка прервана перезапуском сервера',finished_at=? WHERE status='running'`).run(this.now())
    return rows.map((row) => row.id)
  }

  completeQaPreparation(userId: string, projectId: string, taskId: string): QaTaskState | null {
    if (!this.isProjectMember(userId, projectId)) return null
    const task = this.db.prepare(`SELECT 1 FROM tasks WHERE id=? AND project_id=?`).get(taskId, projectId)
    if (!task) return null
    const criteria = (this.db.prepare(`SELECT * FROM acceptance_criteria WHERE task_id=? AND active=1 ORDER BY position`).all(taskId) as QaCriterionRow[]).map(mapQaCriterion)
    if (!criteria.length) throw new Error('Добавьте хотя бы один сценарий ручного QA')
    const incomplete = criteria.filter((criterion) => !criterion.title.trim() || !criterion.steps.trim() || !criterion.expectedResult.trim())
    if (incomplete.length) throw new Error('Каждый сценарий должен содержать название, подробные шаги и ожидаемый результат')
    const column = this.getColumnIdBySemantic(projectId, 'manual_qa')
    if (!column) throw new Error('manual_qa column not found')
    this.db.transaction(() => {
      this.moveTask(userId, projectId, taskId, { columnId: column })
      this.addQaAudit(projectId, taskId, userId, 'preparation.completed', { criteria: criteria.map((criterion) => criterion.id) })
    })()
    return this.getQaTaskState(userId, projectId, taskId)
  }

  startQaSession(userId: string, args: { projectId: string; taskId: string; branch: string; commitSha: string; testRunId: string; previewId?: string | null; previewSha?: string | null; appUrl?: string | null; storybookUrl?: string | null; testDataScenario?: string; testerId?: string | null }, system = false): QaSession | null {
    if (!system && !this.canQa(userId, args.projectId)) throw new Error('QA permission required')
    if (!this.db.prepare(`SELECT 1 FROM tasks WHERE id=? AND project_id=?`).get(args.taskId, args.projectId)) return null
    if (this.db.prepare(`SELECT 1 FROM qa_sessions WHERE task_id=? AND status='active'`).get(args.taskId)) throw new Error('active QA session already exists')
    if (args.previewId && args.previewSha !== args.commitSha) throw new Error('preview SHA does not match commit SHA')
    const criteria = (this.db.prepare(`SELECT * FROM acceptance_criteria WHERE task_id=? AND active=1 ORDER BY position`).all(args.taskId) as QaCriterionRow[]).map(mapQaCriterion)
    if (!criteria.length) throw new Error('acceptance criteria required')
    const snapshot = criteria.map((criterion) => ({ criterionId: criterion.id, version: criterion.currentVersion, required: criterion.required }))
    const now = this.now(), sessionId = this.newId()
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO qa_sessions
        (id,task_id,project_id,branch,commit_sha,test_run_id,preview_id,preview_sha,app_url,storybook_url,test_data_scenario,criteria_snapshot_json,status,tester_id,initiated_by,started_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'active',?,?,?)`).run(
          sessionId,args.taskId,args.projectId,args.branch,args.commitSha,args.testRunId,args.previewId??null,args.previewSha??null,args.appUrl??null,args.storybookUrl??null,args.testDataScenario??'',JSON.stringify(snapshot),args.testerId??userId,userId,now
        )
      const insert = this.db.prepare(`INSERT INTO qa_criterion_results
        (id,session_id,criterion_id,criterion_version,status,draft,branch,commit_sha,preview_id,preview_sha,app_url,storybook_url,test_data_scenario,expected_result,revision,updated_at)
        VALUES (?,?,?,?,'not_tested',0,?,?,?,?,?,?,?,?,1,?)`)
      for (const criterion of criteria) insert.run(this.newId(),sessionId,criterion.id,criterion.currentVersion,args.branch,args.commitSha,args.previewId??null,args.previewSha??null,args.appUrl??null,args.storybookUrl??null,args.testDataScenario??'',criterion.expectedResult,now)
      const column = this.getColumnIdBySemantic(args.projectId, 'manual_qa')
      if (column) this.moveTask(userId, args.projectId, args.taskId, { columnId: column })
      this.addQaAudit(args.projectId,args.taskId,userId,'session.started',{sessionId,commitSha:args.commitSha})
    })()
    return this.mapQaSession(this.db.prepare(`SELECT * FROM qa_sessions WHERE id=?`).get(sessionId) as QaSessionRow)
  }

  saveQaResult(userId: string, projectId: string, taskId: string, resultId: string, expectedRevision: number, patch: Partial<Pick<QaCriterionResult, 'status'|'draft'|'executedSteps'|'actualResult'|'comment'|'environment'|'blockerReason'|'blockerType'|'blockerOwner'|'notApplicableReason'|'assigneeId'>> & { classification?: QaIssueClassification; severity?: QaSeverity; frequency?: QaFrequency; reproduction?: string; requirementProposal?: string }): QaCriterionResult {
    if (!this.canQa(userId, projectId)) throw new Error('QA permission required')
    const current = this.db.prepare(`SELECT r.*, s.project_id, s.task_id, s.status AS session_status, s.stale_reason FROM qa_criterion_results r JOIN qa_sessions s ON s.id=r.session_id WHERE r.id=? AND s.project_id=? AND s.task_id=?`).get(resultId,projectId,taskId) as (QaResultRow & { session_status:string; stale_reason:string|null }) | undefined
    if (!current) throw new Error('QA result not found')
    if (current.revision !== expectedRevision) throw new Error('QA result revision conflict')
    if (current.session_status !== 'active' || current.stale_reason) throw new Error('QA session is stale or closed')
    const previous = mapQaResult(current, [], null)
    const next = { ...previous, ...patch }
    const status = patch.status ?? next.status
    if (!QA_RESULT_STATUSES.includes(status)) throw new Error('invalid QA result status')
    if (!patch.draft) {
      const missing = validateQaResult(status, next)
      if (missing.length) throw new Error(`missing QA fields: ${missing.join(', ')}`)
    }
    if ((status === 'passed' || status === 'not_applicable') && !this.canQa(userId, projectId)) throw new Error('QA permission required')
    const now=this.now(), finished = !patch.draft && ['passed','failed','blocked','not_applicable'].includes(status) ? now : null
    this.db.transaction(() => {
      const changed=this.db.prepare(`UPDATE qa_criterion_results SET status=?,draft=?,tester_id=?,started_at=COALESCE(started_at,?),finished_at=?,executed_steps=?,actual_result=?,comment=?,environment=?,blocker_reason=?,blocker_type=?,blocker_owner=?,not_applicable_reason=?,assignee_id=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?`).run(
        status,patch.draft?1:0,userId,now,finished,next.executedSteps,next.actualResult,next.comment,next.environment,next.blockerReason,next.blockerType,next.blockerOwner,next.notApplicableReason,next.assigneeId,now,resultId,expectedRevision
      )
      if (!changed.changes) throw new Error('QA result revision conflict')
      if (status === 'failed') {
        if (!patch.classification || !patch.severity || !patch.frequency || !patch.reproduction?.trim()) throw new Error('structured QA issue required')
        const route = patch.classification === 'implementation_defect' ? 'development' : patch.classification === 'requirement_change' ? 'ready' : patch.classification === 'needs_decision' ? 'decision_required' : 'manual_qa'
        this.db.prepare(`INSERT INTO qa_issues (id,result_id,classification,severity,frequency,reproduction,proposed_route,requirement_proposal,created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(result_id) DO UPDATE SET classification=excluded.classification,severity=excluded.severity,frequency=excluded.frequency,reproduction=excluded.reproduction,proposed_route=excluded.proposed_route,requirement_proposal=excluded.requirement_proposal`)
          .run(this.newId(),resultId,patch.classification,patch.severity,patch.frequency,patch.reproduction,route,patch.requirementProposal??'',now)
      }
      this.addQaAudit(projectId,taskId,userId,patch.draft?'result.draft_saved':'result.updated',{
        resultId, sessionId: current.session_id, criterionId: current.criterion_id, actor: userId, serverTime: now,
        previous: { status: previous.status, comment: previous.comment, revision: previous.revision },
        next: { status, comment: next.comment, revision: expectedRevision + 1 }
      })
    })()
    return this.qaResultById(resultId) as QaCriterionResult
  }

  saveQaAdditionalIssues(userId: string, projectId: string, taskId: string, sessionId: string, value: string): QaSession {
    if (!this.canQa(userId, projectId)) throw new Error('QA permission required')
    const changed = this.db.prepare(`UPDATE qa_sessions SET additional_issues=? WHERE id=? AND project_id=? AND task_id=? AND status='active' AND stale_reason IS NULL`).run(value, sessionId, projectId, taskId)
    if (!changed.changes) throw new Error('QA session is stale or closed')
    this.addQaAudit(projectId, taskId, userId, 'session.additional_issues_saved', { sessionId })
    return this.mapQaSession(this.db.prepare(`SELECT * FROM qa_sessions WHERE id=?`).get(sessionId) as QaSessionRow)
  }

  linkQaFixRun(userId: string, projectId: string, taskId: string, sessionId: string, runId: string): void {
    if (!this.canQa(userId, projectId)) throw new Error('QA permission required')
    const session = this.db.prepare(`SELECT id FROM qa_sessions WHERE id=? AND project_id=? AND task_id=? AND status='active'`).get(sessionId, projectId, taskId)
    if (!session) throw new Error('QA session is stale or closed')
    const now = this.now()
    this.db.transaction(() => {
      this.db.prepare(`UPDATE qa_issues SET linked_fix_run_id=? WHERE result_id IN (SELECT id FROM qa_criterion_results WHERE session_id=? AND status='failed')`).run(runId, sessionId)
      this.db.prepare(`UPDATE qa_sessions SET status='failed',finished_at=?,summary=?,linked_fix_run_id=? WHERE id=? AND status='active'`).run(now, 'Передано на исправление', runId, sessionId)
      this.addQaAudit(projectId, taskId, userId, 'session.fix_started', { sessionId, runId })
    })()
  }

  completeQaSession(userId: string, projectId: string, taskId: string, sessionId: string, summary: string): QaSession {
    if (!this.canQa(userId,projectId)) throw new Error('QA permission required')
    const row=this.db.prepare(`SELECT * FROM qa_sessions WHERE id=? AND project_id=? AND task_id=?`).get(sessionId,projectId,taskId) as QaSessionRow|undefined
    if (!row) throw new Error('QA session not found')
    const session=this.mapQaSession(row), gate=canCompleteQa(session)
    if (!gate.allowed) throw new Error(`QA is incomplete: ${gate.reasons.join(', ')}`)
    const now=this.now()
    this.db.transaction(()=>{
      this.db.prepare(`UPDATE qa_sessions SET status='passed',finished_at=?,summary=? WHERE id=? AND status='active'`).run(now,summary.trim(),sessionId)
      const column=this.getColumnIdBySemantic(projectId,'awaiting_merge')
      if (!column) throw new Error('awaiting_merge column not found')
      this.moveTask(userId,projectId,taskId,{columnId:column})
      this.addQaAudit(projectId,taskId,userId,'session.completed',{sessionId,summary})
    })()
    return this.mapQaSession(this.db.prepare(`SELECT * FROM qa_sessions WHERE id=?`).get(sessionId) as QaSessionRow)
  }

  markQaSessionStale(projectId: string, taskId: string, reason: string): void {
    const now=this.now()
    this.db.prepare(`UPDATE qa_sessions SET status='stale',stale_reason=?,finished_at=? WHERE project_id=? AND task_id=? AND status='active'`).run(reason,now,projectId,taskId)
    this.db.prepare(`UPDATE qa_criterion_results SET status='stale',revision=revision+1,updated_at=? WHERE session_id IN (SELECT id FROM qa_sessions WHERE project_id=? AND task_id=? AND status='stale' AND stale_reason=?) AND status IN ('not_tested','in_progress')`).run(now,projectId,taskId,reason)
  }

  addQaAttachment(userId:string,projectId:string,taskId:string,resultId:string,input:{uploadId:string;name:string;mimeType:'image/png'|'image/jpeg'|'image/webp';size:number;width?:number|null;height?:number|null;caption?:string}):QaAttachment {
    if (!this.canQa(userId,projectId)) throw new Error('QA permission required')
    const result=this.db.prepare(`SELECT r.commit_sha FROM qa_criterion_results r JOIN qa_sessions s ON s.id=r.session_id WHERE r.id=? AND s.project_id=? AND s.task_id=?`).get(resultId,projectId,taskId) as {commit_sha:string}|undefined
    if (!result) throw new Error('QA result not found')
    const count=(this.db.prepare(`SELECT COUNT(*) AS n FROM qa_attachments WHERE result_id=?`).get(resultId) as {n:number}).n
    if (count>=10) throw new Error('QA attachment limit reached')
    const id=this.newId(),now=this.now(),safeName=input.name.split(/[\\/]/).pop() || 'screenshot'
    this.db.prepare(`INSERT INTO qa_attachments (id,result_id,upload_id,name,mime_type,size,width,height,caption,author,created_at,commit_sha) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,resultId,input.uploadId,safeName,input.mimeType,input.size,input.width??null,input.height??null,input.caption?.trim()??'',userId,now,result.commit_sha)
    this.addQaAudit(projectId,taskId,userId,'attachment.added',{attachmentId:id,resultId,uploadId:input.uploadId})
    return {id,resultId,uploadId:input.uploadId,name:safeName,mimeType:input.mimeType,size:input.size,width:input.width??null,height:input.height??null,caption:input.caption?.trim()??'',author:userId,createdAt:now,commitSha:result.commit_sha}
  }

  getQaAttachment(userId:string,attachmentId:string):(QaAttachment&{projectId:string;taskId:string})|null {
    const row=this.db.prepare(`SELECT a.*,s.project_id,s.task_id FROM qa_attachments a JOIN qa_criterion_results r ON r.id=a.result_id JOIN qa_sessions s ON s.id=r.session_id WHERE a.id=?`).get(attachmentId) as (QaAttachmentRow&{project_id:string;task_id:string})|undefined
    if (!row||!this.isProjectMember(userId,row.project_id)) return null
    return {id:row.id,resultId:row.result_id,uploadId:row.upload_id,name:row.name,mimeType:row.mime_type as QaAttachment['mimeType'],size:row.size,width:row.width,height:row.height,caption:row.caption,author:row.author,createdAt:row.created_at,commitSha:row.commit_sha,projectId:row.project_id,taskId:row.task_id}
  }

  private qaResultById(id: string): QaCriterionResult | null {
    const row=this.db.prepare(`SELECT * FROM qa_criterion_results WHERE id=?`).get(id) as QaResultRow|undefined
    if (!row) return null
    const issue=this.db.prepare(`SELECT * FROM qa_issues WHERE result_id=?`).get(id) as QaIssueRow|undefined
    const attachments=this.db.prepare(`SELECT * FROM qa_attachments WHERE result_id=? ORDER BY created_at`).all(id) as QaAttachmentRow[]
    return mapQaResult(row,attachments,issue??null)
  }

  private mapQaSession(row: QaSessionRow): QaSession {
    const results=(this.db.prepare(`SELECT * FROM qa_criterion_results WHERE session_id=? ORDER BY rowid`).all(row.id) as QaResultRow[]).map((result)=>this.qaResultById(result.id) as QaCriterionResult)
    return mapQaSession(row,results)
  }

  addPreviewAudit(userId:string,projectId:string,taskId:string,action:string,payload:unknown):void {
    this.addQaAudit(projectId, taskId, userId, action, payload)
  }

  private addQaAudit(projectId:string,taskId:string,actor:string,action:string,payload:unknown):void {
    this.db.prepare(`INSERT INTO qa_audit (id,project_id,task_id,action,actor,payload_json,created_at) VALUES (?,?,?,?,?,?,?)`).run(this.newId(),projectId,taskId,action,actor,JSON.stringify(payload),this.now())
  }

  releaseDoneWorkspaces(projectId:string,taskIds:string[]):void {
    if(!taskIds.length)return
    const placeholders=taskIds.map(()=>'?').join(',')
    this.db.prepare(`UPDATE ci_workspaces SET state='released' WHERE project_id=? AND state='active' AND task_id IN (${placeholders})`).run(projectId,...taskIds)
  }

  createProjectRelease(userId: string, projectId: string, input: { branch: string; version: string; sha: string; status?: ProjectRelease['status']; models?: Partial<Record<ReleaseStepKind, string>>; previousReleaseId?: string | null; agentId?: string; checkoutPath?: string; limits?: ReleaseTimeouts }): ProjectRelease {
    if (!this.isProjectOwner(userId, projectId)) throw new Error('release permission required')
    const previous = input.previousReleaseId ? this.releaseRow(input.previousReleaseId) : null
    if (input.previousReleaseId && (!previous || previous.project_id !== projectId || previous.branch !== input.branch)) throw new Error('invalid previous release')
    // Номер попытки — всегда max+1 по ветке: после неудачного deploy повторная
    // попытка от того же подготовленного релиза не должна падать в UNIQUE.
    const nextByBranch = ((this.db.prepare(`SELECT MAX(attempt) AS n FROM project_releases WHERE project_id=? AND branch=?`).get(projectId,input.branch) as {n:number|null}).n ?? 0) + 1
    const attempt = previous ? Math.max(previous.attempt + 1, nextByBranch) : nextByBranch
    const id=this.newId(), now=this.now()
    this.db.transaction(()=>{
      const limits=validateReleaseTimeouts(input.limits??DEFAULT_RELEASE_TIMEOUTS)
      this.db.prepare(`INSERT INTO project_releases (id,project_id,version,branch,commit_sha,status,triggered_by,attempt,previous_release_id,created_at,agent_id,checkout_path) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id,projectId,input.version,input.branch,input.sha,input.status??'preparing',userId,attempt,input.previousReleaseId??null,now,input.agentId??null,input.checkoutPath??null)
      RELEASE_STEP_ORDER.forEach((kind,position)=>this.db.prepare(`INSERT INTO project_release_steps (id,release_id,kind,position,status,model,attempt,limit_ms) VALUES (?,?,?,?,?,?,?,?)`).run(this.newId(),id,kind,position,'queued',input.models?.[kind]??null,attempt,releaseStepLimit(kind,limits)))
      this.addReleaseEvent(id,'release.created',userId,{branch:input.branch,version:input.version,sha:input.sha,attempt})
    })()
    return this.getProjectRelease(userId,projectId,id) as ProjectRelease
  }

  listProjectReleases(userId:string,projectId:string):ProjectRelease[] {
    if (!this.isProjectMember(userId,projectId)) return []
    return (this.db.prepare(`SELECT id FROM project_releases WHERE project_id=? AND deleted_at IS NULL ORDER BY created_at DESC`).all(projectId) as Array<{id:string}>).map(({id})=>this.mapProjectRelease(this.releaseRow(id)!))
  }

  listActiveProjectReleases():ProjectRelease[] {
    return (this.db.prepare(`SELECT * FROM project_releases WHERE status IN ('switching','building','health_check') ORDER BY created_at`).all() as ReleaseRow[])
      .map(row=>this.mapProjectRelease(row))
  }

  getProjectRelease(userId:string,projectId:string,id:string):ProjectRelease|null {
    if (!this.isProjectMember(userId,projectId)) return null
    const row=this.releaseRow(id)
    return row?.project_id===projectId?this.mapProjectRelease(row):null
  }

  setProjectReleaseSha(id:string,sha:string):void {
    this.db.prepare(`UPDATE project_releases SET commit_sha=? WHERE id=?`).run(sha,id)
  }

  setProjectReleaseStatus(id:string,status:ProjectRelease['status'],actor:string):void {
    const now=this.now()
    this.db.prepare(`UPDATE project_releases SET status=?,released_at=? WHERE id=?`).run(status,status==='released'?now:null,id)
    this.addReleaseEvent(id,`release.${status}`,actor,{})
  }

  setProjectReleaseStep(id:string,kind:ReleaseStepKind,status:ReleaseStepStatus,log:string,actor:string):void {
    const now=this.now()
    this.db.prepare(`UPDATE project_release_steps SET status=?,log=?,started_at=CASE WHEN ?='running' THEN COALESCE(started_at,?) ELSE started_at END,finished_at=CASE WHEN ? IN ('passed','failed','skipped') THEN ? ELSE NULL END WHERE release_id=? AND kind=?`)
      .run(status,log,status,now,status,now,id,kind)
    this.addReleaseEvent(id,`step.${status}`,actor,{kind,log})
  }

  softDeleteProjectRelease(userId:string,projectId:string,id:string):boolean {
    if(!this.isProjectOwner(userId,projectId))throw new Error('release permission required')
    const row=this.releaseRow(id)
    if(!row||row.project_id!==projectId||row.previous_release_id||!['ready','failed'].includes(row.status))throw new Error('Этот релиз нельзя удалить')
    const active=this.db.prepare(`SELECT 1 FROM project_releases WHERE project_id=? AND previous_release_id=? AND status IN ('queued','switching','building','health_check')`).get(projectId,id)
    const current=this.db.prepare(`SELECT previous_release_id FROM project_releases WHERE project_id=? AND status='released' ORDER BY released_at DESC LIMIT 1`).get(projectId) as {previous_release_id:string|null}|undefined
    if(active)throw new Error('У релиза есть активный deploy')
    if(current?.previous_release_id===id)throw new Error('Текущий production-релиз удалить нельзя')
    this.db.prepare(`UPDATE project_releases SET deleted_at=? WHERE id=?`).run(this.now(),id)
    this.addReleaseEvent(id,'release.deleted',userId,{branch:row.branch})
    return true
  }

  private releaseRow(id:string):ReleaseRow|undefined {
    return this.db.prepare(`SELECT * FROM project_releases WHERE id=?`).get(id) as ReleaseRow|undefined
  }
  private mapProjectRelease(row:ReleaseRow):ProjectRelease {
    const steps=(this.db.prepare(`SELECT * FROM project_release_steps WHERE release_id=? ORDER BY position`).all(row.id) as ReleaseStepRow[]).map(s=>({id:s.id,kind:s.kind as ReleaseStepKind,status:s.status as ReleaseStepStatus,model:s.model,attempt:s.attempt,log:s.log,startedAt:s.started_at,finishedAt:s.finished_at,limitMs:s.limit_ms??null}))
    return {id:row.id,projectId:row.project_id,version:row.version,branch:row.branch,sha:row.commit_sha,status:row.status as ProjectRelease['status'],triggeredBy:row.triggered_by,attempt:row.attempt,previousReleaseId:row.previous_release_id,createdAt:row.created_at,releasedAt:row.released_at,agentId:row.agent_id??null,checkoutPath:row.checkout_path??null,deletedAt:row.deleted_at??null,steps}
  }
  private addReleaseEvent(releaseId:string,type:string,actor:string,payload:unknown):void {
    this.db.prepare(`INSERT INTO project_release_events (id,release_id,type,actor,payload_json,created_at) VALUES (?,?,?,?,?,?)`).run(this.newId(),releaseId,type,actor,JSON.stringify(payload),this.now())
  }

  deleteKbDocument(id: string): boolean {
    return this.db.prepare(`DELETE FROM kb_documents WHERE id = ?`).run(id).changes > 0
  }
}

// ============== Релизы: строки БД ==================
interface ReleaseRow { id:string;project_id:string;version:string;branch:string;commit_sha:string;status:string;triggered_by:string;attempt:number;previous_release_id:string|null;created_at:number;released_at:number|null;agent_id:string|null;checkout_path:string|null;deleted_at:number|null }
interface ReleaseStepRow { id:string;release_id:string;kind:string;position:number;status:string;model:string|null;attempt:number;log:string;started_at:number|null;finished_at:number|null;limit_ms:number|null }

// ============== Ручное QA: строки БД и мапперы ==================
interface QaCriterionRow { id:string;task_id:string;position:number;title:string;description:string;preconditions:string;steps:string;test_data:string;expected_result:string;required:number;test_type:string;current_version:number;active:number;author:string;created_at:number;updated_at:number }
interface QaCriterionVersionRow { criterion_id:string;version:number;snapshot_json:string;author:string;reason:string;created_at:number;superseded_by:number|null }
interface QaSessionRow { id:string;task_id:string;project_id:string;branch:string;commit_sha:string;test_run_id:string;preview_id:string|null;preview_sha:string|null;app_url:string|null;storybook_url:string|null;test_data_scenario:string;criteria_snapshot_json:string;status:string;tester_id:string|null;initiated_by:string;started_at:number;finished_at:number|null;stale_reason:string|null;summary:string;additional_issues:string;linked_fix_run_id:string|null }
interface QaResultRow { id:string;session_id:string;criterion_id:string;criterion_version:number;status:string;draft:number;tester_id:string|null;assignee_id:string|null;started_at:number|null;finished_at:number|null;branch:string;commit_sha:string;preview_id:string|null;preview_sha:string|null;app_url:string|null;storybook_url:string|null;test_data_scenario:string;executed_steps:string;expected_result:string;actual_result:string;comment:string;environment:string;blocker_reason:string;blocker_type:string|null;blocker_owner:string|null;not_applicable_reason:string;revision:number;updated_at:number }
interface QaIssueRow { id:string;result_id:string;classification:string;severity:string;frequency:string;reproduction:string;proposed_route:string;requirement_proposal:string;resolution:string;linked_fix_run_id:string|null;created_at:number }
interface QaAttachmentRow { id:string;result_id:string;upload_id:string;name:string;mime_type:string;size:number;width:number|null;height:number|null;caption:string;author:string;created_at:number;commit_sha:string }

function qaSnapshot(value:AcceptanceCriterionSnapshot):AcceptanceCriterionSnapshot {
  const testType=value.testType==='automated'||value.testType==='mixed'||value.testType==='not_testable_in_app'?value.testType:'manual'
  return {title:value.title.trim(),description:value.description.trim(),preconditions:value.preconditions.trim(),steps:value.steps.trim(),testData:value.testData.trim(),expectedResult:value.expectedResult.trim(),required:value.required!==false,testType}
}
function mapTaskRepository(r: Record<string, unknown>): TaskRepository {
  return {
    id: String(r.id), projectId: String(r.project_id), taskId: String(r.task_id), agentId: String(r.agent_id),
    machineName: (r.machine_name as string | null) ?? null, path: String(r.path), kind: r.kind as TaskRepository['kind'],
    state: r.state as TaskRepository['state'], createdAt: Number(r.created_at), deletedAt: r.deleted_at as number | null
  }
}

function mapQaCriterion(r:QaCriterionRow):AcceptanceCriterion {
  return {id:r.id,taskId:r.task_id,order:r.position,title:r.title,description:r.description,preconditions:r.preconditions,steps:r.steps,testData:r.test_data,expectedResult:r.expected_result,required:!!r.required,testType:(r.test_type as AcceptanceCriterion['testType']),currentVersion:r.current_version,active:!!r.active,author:r.author,createdAt:r.created_at,updatedAt:r.updated_at}
}
function mapQaCriterionVersion(r:QaCriterionVersionRow):AcceptanceCriterionVersion {
  const snapshot=parseJsonValue<AcceptanceCriterionSnapshot>(r.snapshot_json,{title:'',description:'',preconditions:'',steps:'',testData:'',expectedResult:'',required:true,testType:'manual'})
  return {...snapshot,criterionId:r.criterion_id,version:r.version,author:r.author,reason:r.reason,createdAt:r.created_at,supersededBy:r.superseded_by}
}
function qaStatus(value:string):QaResultStatus {
  return value==='in_progress'||value==='passed'||value==='failed'||value==='blocked'||value==='not_applicable'||value==='stale'?value:'not_tested'
}
function mapQaResult(r:QaResultRow,attachments:QaAttachmentRow[],issue:QaIssueRow|null):QaCriterionResult {
  return {id:r.id,sessionId:r.session_id,criterionId:r.criterion_id,criterionVersion:r.criterion_version,status:qaStatus(r.status),draft:!!r.draft,testerId:r.tester_id,assigneeId:r.assignee_id,startedAt:r.started_at,finishedAt:r.finished_at,branch:r.branch,commitSha:r.commit_sha,previewId:r.preview_id,previewSha:r.preview_sha,appUrl:r.app_url,storybookUrl:r.storybook_url,testDataScenario:r.test_data_scenario,executedSteps:r.executed_steps,expectedResult:r.expected_result,actualResult:r.actual_result,comment:r.comment,environment:r.environment,blockerReason:r.blocker_reason,blockerType:r.blocker_type as QaCriterionResult['blockerType'],blockerOwner:r.blocker_owner,notApplicableReason:r.not_applicable_reason,revision:r.revision,updatedAt:r.updated_at,attachments:attachments.map(a=>({id:a.id,resultId:a.result_id,uploadId:a.upload_id,name:a.name,mimeType:a.mime_type as 'image/png'|'image/jpeg'|'image/webp',size:a.size,width:a.width,height:a.height,caption:a.caption,author:a.author,createdAt:a.created_at,commitSha:a.commit_sha})),issue:issue?{id:issue.id,resultId:issue.result_id,classification:issue.classification as QaIssueClassification,severity:issue.severity as QaSeverity,frequency:issue.frequency as QaFrequency,reproduction:issue.reproduction,proposedRoute:issue.proposed_route as QaIssue['proposedRoute'],requirementProposal:issue.requirement_proposal,resolution:issue.resolution,linkedFixRunId:issue.linked_fix_run_id,createdAt:issue.created_at}:null}
}
function mapQaSession(r:QaSessionRow,results:QaCriterionResult[]):QaSession {
  return {id:r.id,taskId:r.task_id,projectId:r.project_id,branch:r.branch,commitSha:r.commit_sha,testRunId:r.test_run_id,previewId:r.preview_id,previewSha:r.preview_sha,appUrl:r.app_url,storybookUrl:r.storybook_url,testDataScenario:r.test_data_scenario,criteriaSnapshot:parseJsonValue(r.criteria_snapshot_json,[]),status:(r.status==='passed'||r.status==='failed'||r.status==='blocked'||r.status==='stale'?r.status:'active'),testerId:r.tester_id,initiatedBy:r.initiated_by,startedAt:r.started_at,finishedAt:r.finished_at,staleReason:r.stale_reason,summary:r.summary,additionalIssues:r.additional_issues??'',linkedFixRunId:r.linked_fix_run_id??null,results}
}

// ============== Использование базы знаний: строки БД и мапперы =======
/**
 * Отчёты БД без флагов конфигурации: доступность индекса и включённость
 * mcp__kb__* знает не БД, а роут (config + kb.status()) — он их и дописывает.
 */
export type KbChatUsage = Omit<KbUsageReport, 'toolEnabled' | 'available'>
/** То же для проектного агрегата. */
export type KbProjectUsage = Omit<KbProjectUsageReport, 'toolEnabled' | 'available'>

interface KbUsageQueryRow {
  id: string; seq: number; user_id: string; conversation_id: string; project_id: string | null
  turn_id: string | null; message_id: string | null; ci_run_id: string | null; ci_step_id: string | null
  source: string; status: string; query: string
  confidence: string | null; injected: number; sections_count: number; chars: number; est_tokens: number
  bundle_tokens: number | null; prompt_chars: number | null; turn_input_tokens: number | null
  duration_ms: number | null; error: string | null; created_at: number
}
interface KbUsageSectionRow {
  id: string; query_id: string; document_id: string; title: string; heading: string; anchor: string
  source_path: string; related_files: string; chars: number; est_tokens: number; score: number | null; match_types: string
  freshness: string; position: number
}
interface KbSectionAggRow {
  document_id: string; anchor: string; title: string; heading: string; source_path: string; freshness: string
  times: number; auto_times: number; chars: number; est_tokens: number; last_at: number; conversations?: number
}

const KB_SOURCES: KbUsageSource[] = ['auto', 'tool_search', 'tool_document', 'tool_topics']
function kbSource(value: string): KbUsageSource {
  return KB_SOURCES.includes(value as KbUsageSource) ? (value as KbUsageSource) : 'auto'
}
function kbStatus(value: string): KbUsageStatus {
  return value === 'empty' || value === 'error' ? value : 'delivered'
}
function kbFreshness(value: string): KbFreshness {
  return value === 'current' || value === 'stale' ? value : 'unknown'
}
function kbMatchTypes(json: string): KbMatchType[] {
  try {
    const parsed = JSON.parse(json) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is KbMatchType => typeof item === 'string') : []
  } catch {
    return [] // битый JSON — обращение важнее его подписи
  }
}
function mapKbUsageSection(r: KbUsageSectionRow): KbUsageSectionRef {
  return {
    documentId: r.document_id, title: r.title, heading: r.heading, anchor: r.anchor, sourcePath: r.source_path, relatedFiles: parseStringArray(r.related_files),
    chars: r.chars, estimatedTokens: r.est_tokens, score: r.score, matchTypes: kbMatchTypes(r.match_types),
    freshness: kbFreshness(r.freshness)
  }
}
function mapKbUsageQuery(r: KbUsageQueryRow, sections: KbUsageSectionRef[]): KbUsageQuery {
  return {
    id: r.id, seq: r.seq, conversationId: r.conversation_id, projectId: r.project_id, turnId: r.turn_id,
    messageId: r.message_id, ciRunId: r.ci_run_id, ciStepId: r.ci_step_id,
    source: kbSource(r.source), status: kbStatus(r.status), query: r.query,
    confidence: r.confidence === 'high' || r.confidence === 'medium' || r.confidence === 'low' ? r.confidence : null,
    injected: r.injected === 1, sectionsCount: r.sections_count, chars: r.chars, estimatedTokens: r.est_tokens,
    bundleTokens: r.bundle_tokens, promptChars: r.prompt_chars, turnInputTokens: r.turn_input_tokens,
    durationMs: r.duration_ms, error: r.error, createdAt: r.created_at, sections
  }
}
function mapKbSectionAggregate(r: KbSectionAggRow): KbUsageSectionAggregate {
  return {
    documentId: r.document_id, title: r.title, heading: r.heading, anchor: r.anchor, sourcePath: r.source_path,
    freshness: kbFreshness(r.freshness), times: r.times, autoTimes: r.auto_times, chars: r.chars,
    estimatedTokens: r.est_tokens, lastAt: r.last_at,
    ...(r.conversations === undefined ? {} : { conversations: r.conversations })
  }
}

// ======================= CI-раннер: строки БД и мапперы ================
interface CiCommandRow {
  id: string; scope: string; project_id: string | null; name: string; script: string
  description: string; workdir: string; timeout_sec: number | null; env_json: string
  allow_failure: number; is_cleanup: number; available_to_model: number; is_test: number; builtin: string | null; version: number
  created_by: string; created_at: number; updated_at: number; deleted_at: number | null
}
/**
 * Шаг «закоммитить работу в ветку задачи» — по назначению, а не по подписи в
 * конкретном проекте (справочник команд это данные). Перед ним встаёт
 * актуализация базы знаний: её правки должны уехать тем же коммитом.
 */
function isCommitStepLike(name: string, script: string): boolean {
  return /коммит|commit/i.test(name) || /git\s+commit/i.test(script)
}
function isMergeToBaseStepLike(name: string, script: string): boolean {
  return /влить.*(ветк|прод)|merge.*(main|base)/i.test(name)
    || (/git\s+merge/i.test(script) && /git\s+push/i.test(script))
}
function isProductionDeployStepLike(name: string, script: string): boolean {
  return /обновить.*прод|production.*deploy|prod.*rebuild/i.test(name)
    || /PROD_DIR|rebuild-when-idle|production_deploy/i.test(script)
}

function parseCiEnv(j: string): Record<string, string> {
  try {
    const o = JSON.parse(j) as unknown
    if (o && typeof o === 'object') {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) out[k] = String(v)
      return out
    }
  } catch {
    /* битый JSON — пустое окружение */
  }
  return {}
}
function mapCiCommand(r: CiCommandRow): CiCommand {
  return {
    id: r.id,
    scope: r.scope === 'global' ? 'global' : 'project',
    projectId: r.project_id,
    name: r.name,
    script: r.script,
    description: r.description,
    workdir: r.workdir,
    timeoutSec: r.timeout_sec,
    env: parseCiEnv(r.env_json),
    allowFailure: !!r.allow_failure,
    isCleanup: !!r.is_cleanup,
    availableToModel: !!r.available_to_model,
    isTest: !!r.is_test,
    builtin: r.builtin === 'kb_update' ? 'kb_update' : null,
    version: r.version,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at
  }
}

function normCiStatus(s: string): CiStatus {
  return s === 'running' || s === 'awaiting_input' || s === 'success' || s === 'failed' || s === 'cancelled' || s === 'timeout' || s === 'skipped' ? s : 'queued'
}
/** Режим БЗ из строки БД: неизвестное значение — безопасный дефолт `auto`. */
function normKbContextMode(value: string | KbContextMode | null | undefined): KbContextMode {
  return value === 'manual' || value === 'off' ? value : 'auto'
}
function normRunMode(m: string | null | undefined): CiRunMode {
  return m === 'plan' ? 'plan' : 'development'
}
function normClarifyLevel(l: string | null | undefined): CiClarifyLevel {
  return l === 'none' || l === 'medium' || l === 'detailed' ? l : 'few'
}
function clampClarifyMax(n: number | null | undefined): number {
  return Math.min(CI_CLARIFY_MAX_LIMIT, Math.max(1, Math.round(Number(n ?? 3)) || 1))
}
function normInteractionKind(k: string): CiInteractionKind {
  return k === 'plan_approval' ? 'plan_approval' : 'clarify'
}
function normInteractionStatus(st: string): CiInteractionStatus {
  return st === 'answered' || st === 'cancelled' ? st : 'pending'
}
function parseQuestionSpecs(j: string | null): QuestionSpec[] {
  if (!j) return []
  try {
    const v = JSON.parse(j)
    return Array.isArray(v) ? (v as QuestionSpec[]) : []
  } catch {
    return []
  }
}
function mapCiInteraction(r: CiInteractionRow): CiInteraction {
  return {
    id: r.id, runId: r.run_id, stepId: r.step_id, seq: r.seq, kind: normInteractionKind(r.kind),
    questions: parseQuestionSpecs(r.questions_json), planText: r.plan_text, answerText: r.answer_text,
    decision: r.decision === 'approved' || r.decision === 'rework' ? r.decision : null,
    status: normInteractionStatus(r.status), conversationId: r.conversation_id, messageId: r.message_id,
    createdAt: r.created_at, answeredAt: r.answered_at, answeredBy: r.answered_by
  }
}
interface CiInteractionRow {
  id: string; run_id: string; step_id: string; seq: number; kind: string
  questions_json: string | null; plan_text: string | null; answer_text: string | null
  decision: string | null; status: string; conversation_id: string | null; message_id: string | null
  created_at: number; answered_at: number | null; answered_by: string | null
}
function parseJsonValue<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

function parseSlotProgress(j: string): CiSlotProgress {
  try {
    const o = JSON.parse(j) as Partial<CiSlotProgress>
    return { done: Number(o.done ?? 0), total: Number(o.total ?? 0), phase: String(o.phase ?? ''), fixing: o.fixing === true }
  } catch {
    return { done: 0, total: 0, phase: '' }
  }
}

interface CiRunRow {
  id: string; project_id: string; task_id: string; agent_id: string | null; agent_owner_id: string | null; agent_owner_name: string | null; agent_selection_source: string | null; status: string
  workspace_id: string | null; triggered_by: string; prev_column_id: string | null; run_column_id: string | null; terminal_column_id: string | null
  llm_engine_id: string | null; llm_provider: string; llm_model: string
  mode: string | null; clarify_level: string | null; clarify_max: number | null
  conversation_id: string | null; model_session_id: string | null; fix_context_json: string | null; kb_context_mode: string | null
  slot_progress_json: string; started_at: number | null; finished_at: number | null
  duration_ms: number | null; created_at: number
}
function mapCiRun(r: CiRunRow): CiRun {
  return {
    id: r.id, projectId: r.project_id, taskId: r.task_id, agentId: r.agent_id,
    agentOwnerId: r.agent_owner_id ?? null, agentOwnerName: r.agent_owner_name ?? 'неизвестно',
    agentSelectionSource: r.agent_selection_source === 'explicit' || r.agent_selection_source === 'task_pinned' || r.agent_selection_source === 'project_default' || r.agent_selection_source === 'user_project_default' || r.agent_selection_source === 'fallback' ? r.agent_selection_source : 'unknown',
    status: normCiStatus(r.status), workspaceId: r.workspace_id, triggeredBy: r.triggered_by,
    prevColumnId: r.prev_column_id, runColumnId: r.run_column_id ?? null, terminalColumnId: r.terminal_column_id ?? null, llmEngineId: r.llm_engine_id ?? null, llmProvider: r.llm_provider === 'codex' ? 'codex' : 'claude', llmModel: r.llm_provider === 'codex' ? (r.llm_model ?? '') : (r.llm_model || DEFAULT_CI_CLAUDE_MODEL),
    mode: normRunMode(r.mode), clarifyLevel: normClarifyLevel(r.clarify_level), clarifyMax: clampClarifyMax(r.clarify_max),
    conversationId: r.conversation_id, modelSessionId: r.model_session_id ?? null,
    fixContext: parseJsonValue<CiFixDiagnosticContext | null>(r.fix_context_json, null), kbContextMode: normKbContextMode(r.kb_context_mode),
    slotProgress: parseSlotProgress(r.slot_progress_json),
    startedAt: r.started_at, finishedAt: r.finished_at, durationMs: r.duration_ms, createdAt: r.created_at
  }
}

interface CiRunStepRow {
  id: string; run_id: string; slot: string | null; position: number; kind: string
  parent_step_id: string | null; initiated_by: string; command_id: string | null
  command_snapshot: string | null; title: string; workdir: string | null; status: string
  exit_code: number | null; attempt: number; fixed_by_model: number
  started_at: number | null; finished_at: number | null; duration_ms: number | null
}
function normStepKind(k: string): CiStepKind {
  return k === 'model_work' || k === 'model_command' || k === 'model_summary' ? k : 'command'
}
function normInitiatedBy(v: string): CiInitiatedBy {
  return v === 'user' || v === 'model' ? v : 'system'
}
function mapCiRunStep(r: CiRunStepRow): CiRunStep {
  return {
    id: r.id, runId: r.run_id, slot: r.slot === 'before_model' || r.slot === 'after_model' ? r.slot : null,
    position: r.position, kind: normStepKind(r.kind), parentStepId: r.parent_step_id,
    initiatedBy: normInitiatedBy(r.initiated_by), commandId: r.command_id, commandSnapshot: r.command_snapshot,
    title: r.title, workdir: r.workdir, status: normCiStatus(r.status), exitCode: r.exit_code,
    attempt: r.attempt, fixedByModel: !!r.fixed_by_model, startedAt: r.started_at,
    finishedAt: r.finished_at, durationMs: r.duration_ms
  }
}

interface CiRunUsageRow {
  id: string; run_id: string; step_id: string | null; kind: string; provider: string; model: string
  input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_creation_tokens: number
  cost_usd: number | null; duration_ms: number | null; num_turns: number | null
  input_semantics: string | null; at: number
}
function normUsageKind(k: string): CiUsageKind {
  return k === 'summary' || k === 'fix' || k === 'kb_update' ? k : 'model_work'
}
/**
 * Семантика входа строки. Явно записанная — источник истины; её отсутствие
 * означает историческую строку: у codex вход там ВМЕСТЕ с прочитанным кэшем, у
 * claude он и раньше был без него.
 */
function usageInputSemantics(r: CiRunUsageRow): CiInputSemantics {
  if (r.input_semantics === 'no_cache' || r.input_semantics === 'with_cache') return r.input_semantics
  return r.provider === 'codex' ? 'with_cache' : 'no_cache'
}
function mapCiRunUsage(r: CiRunUsageRow): CiRunUsage {
  return {
    id: r.id, runId: r.run_id, stepId: r.step_id, kind: normUsageKind(r.kind),
    provider: r.provider === 'codex' ? 'codex' : 'claude', model: r.model,
    inputTokens: r.input_tokens, outputTokens: r.output_tokens,
    cacheReadTokens: r.cache_read_tokens, cacheCreationTokens: r.cache_creation_tokens,
    inputSemantics: usageInputSemantics(r),
    costUsd: r.cost_usd, durationMs: r.duration_ms, numTurns: r.num_turns, at: r.at
  }
}

interface CiLogRow { run_id: string; step_id: string; seq: number; stream: string; chunk: string; at: number }
function mapCiLog(r: CiLogRow): CiLogLine {
  return {
    runId: r.run_id, stepId: r.step_id, seq: r.seq,
    stream: r.stream === 'stderr' || r.stream === 'system' ? r.stream : 'stdout',
    chunk: r.chunk, at: r.at
  }
}

interface CiFixRow {
  id: string; run_step_id: string; attempt_no: number; diagnosis: string; action: string
  result: string; diff: string | null; changed_files_json: string; targeted_tests_json: string; full_rerun_json: string | null; failures_json: string; duration_ms: number | null; tokens_used: number | null; created_at: number
}
function mapCiFix(r: CiFixRow): CiFixAttempt {
  return {
    id: r.id, runStepId: r.run_step_id, attemptNo: r.attempt_no, diagnosis: r.diagnosis, action: r.action,
    result: r.result === 'fixed' || r.result === 'gave_up' ? r.result : 'retrying',
    diff: r.diff,
    changedFiles: parseJsonValue<string[]>(r.changed_files_json, []),
    targetedTests: parseJsonValue<CiTargetedTestRun[]>(r.targeted_tests_json, []),
    fullRerun: parseJsonValue<CiFixAttempt['fullRerun']>(r.full_rerun_json, null),
    failures: parseJsonValue<CiTestFailure[]>(r.failures_json, []),
    durationMs: r.duration_ms, tokensUsed: r.tokens_used, createdAt: r.created_at
  }
}

interface CiWorkspaceRow {
  id: string; project_id: string; task_id: string; agent_id: string | null; path: string
  branch: string | null; commit_sha: string | null; pushed: number
  state: string; size_bytes: number | null; created_at: number; released_by_step_id: string | null
}
function mapCiWorkspace(r: CiWorkspaceRow): CiWorkspace {
  return {
    id: r.id, projectId: r.project_id, taskId: r.task_id, agentId: r.agent_id, path: r.path,
    branch: r.branch ?? null, commitSha: r.commit_sha ?? null, pushed: r.pushed === 1,
    state: r.state === 'released' ? 'released' : 'active', sizeBytes: r.size_bytes,
    createdAt: r.created_at, releasedByStepId: r.released_by_step_id
  }
}

interface CiSuggestionRow {
  id: string; command_id: string; run_step_id: string | null; reason: string; proposed_script: string
  status: string; occurrences: number; created_at: number; resolved_by: string | null; resolved_at: number | null
}
function mapCiSuggestion(r: CiSuggestionRow): CiCommandSuggestion {
  return {
    id: r.id, commandId: r.command_id, runStepId: r.run_step_id, reason: r.reason, proposedScript: r.proposed_script,
    status: r.status === 'accepted' || r.status === 'rejected' ? r.status : 'new',
    occurrences: r.occurrences, createdAt: r.created_at, resolvedBy: r.resolved_by, resolvedAt: r.resolved_at
  }
}


// ============== Статьи базы знаний: строка БД и маппер =======
interface KbDocumentRow {
  id: string; scope: string; owner_id: string | null; project_id: string | null; title: string; kind: string
  tags: string; areas: string; body: string; checked_on: string | null; created_by: string
  created_at: number; updated_at: number
}

/** Статья БЗ из БД (файловые темы приходят из docs/kb и сюда не попадают). */
export interface KbStoredDocument {
  id: string
  scope: KbScope
  ownerId: string | null
  projectId: string | null
  title: string
  kind: KbDocumentKind
  tags: string[]
  areas: string[]
  body: string
  checkedOn: string | null
  createdBy: string
  createdAt: number
  updatedAt: number
}

function mapKbDocument(r: KbDocumentRow): KbStoredDocument {
  return {
    id: r.id,
    scope: r.scope === 'usage' || r.scope === 'project' ? r.scope : 'user',
    ownerId: r.owner_id,
    projectId: r.project_id,
    title: r.title,
    kind: (r.kind || 'subsystem') as KbDocumentKind,
    tags: parseStringArray(r.tags),
    areas: parseStringArray(r.areas),
    body: r.body,
    checkedOn: r.checked_on,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}


/**
 * Заготовка обзорной статьи раздела «Разработка проекта». Пишется при создании
 * проекта, чтобы разделу было куда расти: дальше её переписывает операция
 * «Исследовать проект» (kb/research.ts) или человек руками.
 */
export function projectKbSkeleton(name: string, description: string): string {
  return [
    `# Разработка: ${name}`,
    '',
    description.trim() || 'Описание проекта пока не заполнено.',
    '',
    '## Что это',
    '',
    'Заготовка обзорной статьи. Здесь держим то, что верно в коде сейчас: из чего',
    'состоит проект, где что лежит, как его собирать и проверять.',
    '',
    '## Устройство',
    '',
    'Пока не описано. Запустите «Исследовать проект» — модель просканирует',
    'репозиторий на машине проекта и заполнит раздел по коду.',
    '',
    '## Как запускать и проверять',
    '',
    'Пока не описано.',
    ''
  ].join('\n')
}

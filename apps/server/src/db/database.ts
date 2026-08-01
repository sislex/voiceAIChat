import Database from 'better-sqlite3'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { MESSAGES_FTS_SQL, SCHEMA_SQL } from './schema'
import { toFtsMatchQuery } from './fts.js'
import {
  DEFAULT_SETTINGS,
  DEFAULT_AGENT_POLICY,
  type AgentCreated,
  type AgentPolicy,
  type Conversation,
  type ConversationStatus,
  DEFAULT_CONVERSATION_STATUS,
  type DesktopMigrationBundle,
  type DesktopMigrationResult,
  type LlmProvider,
  type Message,
  type MessageRole,
  type MessageSearchHit,
  type MessageSearchResult,
  type PermissionMode,
  type Settings,
  type TurnMeta,
  type UsageBucket,
  type UsageByModel,
  type UsageReport,
  type UsageTotals,
  type UsageUnit,
  type UserRole,
  type Board,
  type KanbanColumn,
  type ProjectDetail,
  type ProjectMember,
  type ProjectSummary,
  type Task,
  type TaskPriority,
  type WorkItemType,
  type WorkItemDefaultSkills,
  type KanbanColumnSemanticType,

  estimateKbTokens,
  type KbFreshness,
  type KbMatchType,
  type KbProjectUsageReport,
  type KbUsageQuery,
  type KbUsageReport,
  type KbUsageSectionAggregate,
  type KbUsageSectionRef,
  type KbUsageSource,
  type KbUsageStatus,
  type KbUsageTotals,
  type CiCommand,
  type CiCommandInput,
  type CiCommandScope,
  type CiSlot,
  type CiSlotConfig,
  type CiLlmConfig,
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
  DEFAULT_DONE_RETENTION_DAYS,
  type CiGlobalSettings,
  DEFAULT_CI_GLOBAL_SETTINGS,
  type CiRun,
  type CiRunDetail,
  type CiRunStep,
  type CiStatus,
  type CiStepKind,
  type CiInitiatedBy,
  type CiSlotProgress,
  type CiLogLine,
  type CiFixAttempt,
  type CiWorkspace,
  type CiWorkspaceReportItem,
  type CiCommandSuggestion,
  type CiRunSummary,
  type CiCommandMetric,
  type CiModelWorkMetric,
  type CiEventActor
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
  llm_provider: string | null
  llm_model: string | null
  permission_mode: string | null
  kb_context_mode: string | null
  project_id: string | null
  task_id: string | null
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
}

/**
 * Условие «беседа не является чатом завершённой задачи»: чат либо не привязан к
 * задаче, либо её колонка не имеет семантики `done`. Проверяем колонку, а не
 * `tasks.done_at`, чтобы возврат задачи в работу возвращал чат в список сразу.
 */
const NOT_DONE_TASK_CHAT = `(c.task_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM tasks t JOIN kanban_columns k ON k.id = t.column_id
    WHERE t.id = c.task_id AND k.semantic_type = 'done'))`

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
  default_skills_epic: string
  default_skills_story: string
  default_skills_task: string
  ci_base_branch: string
  ci_branch_template: string
  ci_reuse_strategy: string
  ci_exec_auth_ref: string
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
  labels: string | null
  skills: string | null
  story_points: number | null
  due_date: number | null
  flagged: number
  done_at: number | null
  seq: number | null
  position: number
  created_at: number
  updated_at: number
  chat_id?: string | null
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

/** Валидный приоритет (неизвестное → medium). */
function normPriority(raw: string): TaskPriority {
  return raw === 'low' || raw === 'high' || raw === 'urgent' || raw === 'medium' ? raw : 'medium'
}

function normColumnSemantic(raw: string): KanbanColumnSemanticType {
  return raw === 'backlog' || raw === 'ready' || raw === 'development' || raw === 'testing' || raw === 'awaiting_merge' || raw === 'done' ? raw : 'custom'
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
    labels: parseStringArray(r.labels),
    skills: parseStringArray(r.skills),
    storyPoints: r.story_points ?? null,

    dueDate: r.due_date ?? null,
    flagged: r.flagged !== 0,
    doneAt: r.done_at ?? null,
    seq: r.seq ?? 0,
    position: r.position,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    chatId: r.chat_id ?? null
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
    this.migrate()
    this.newId = deps.newId ?? (() => randomUUID())
    this.now = deps.now ?? (() => Date.now())
    this.setupMessagesFts()
  }

  /** Лёгкие миграции существующих БД (idempotent). */
  private migrate(): void {
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
    if (!convCols.some((c) => c.name === 'task_id')) {
      this.db.exec(`ALTER TABLE conversations ADD COLUMN task_id TEXT`)
    }

    if (!convCols.some((c) => c.name === 'status')) {
      this.db.exec(`ALTER TABLE conversations ADD COLUMN status TEXT NOT NULL DEFAULT 'developing'`)
    }
    // Проекты (итерация 2): папка на машину + машина по умолчанию.
    const projCols = this.db.prepare(`PRAGMA table_info(projects)`).all() as Array<{ name: string }>
    if (projCols.length && !projCols.some((c) => c.name === 'default_agent_id')) {
      this.db.exec(`ALTER TABLE projects ADD COLUMN default_agent_id TEXT`)
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
    for (const t of ['agent_tasks', 'feature_deployments', 'feature_events', 'features', 'repository_slots']) {
      this.db.exec(`DROP TABLE IF EXISTS ${t}`)
    }
    const taskCols = this.db.prepare(`PRAGMA table_info(tasks)`).all() as Array<{ name: string }>
    if (taskCols.length && !taskCols.some((c) => c.name === 'type')) this.db.exec(`ALTER TABLE tasks ADD COLUMN type TEXT NOT NULL DEFAULT 'task'`)
    if (taskCols.length && !taskCols.some((c) => c.name === 'parent_id')) this.db.exec(`ALTER TABLE tasks ADD COLUMN parent_id TEXT`)
    if (taskCols.length && !taskCols.some((c) => c.name === 'acceptance_criteria')) this.db.exec(`ALTER TABLE tasks ADD COLUMN acceptance_criteria TEXT NOT NULL DEFAULT ''`)
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
    // Названия сохраняем, назначаем крайним колонкам базовые роли и досеиваем
    // обязательные этапы workflow. SQL idempotent и не зависит от newId.
    this.db.exec(`
      UPDATE kanban_columns SET semantic_type = 'backlog'
      WHERE semantic_type = 'custom' AND id IN (SELECT id FROM kanban_columns c2 WHERE c2.project_id = kanban_columns.project_id ORDER BY position LIMIT 1);
      UPDATE kanban_columns SET semantic_type = 'done'
      WHERE semantic_type = 'custom' AND id IN (SELECT id FROM kanban_columns c2 WHERE c2.project_id = kanban_columns.project_id ORDER BY position DESC LIMIT 1);
      UPDATE kanban_columns SET semantic_type = 'development'
      WHERE semantic_type = 'custom' AND id IN (SELECT id FROM kanban_columns c2 WHERE c2.project_id = kanban_columns.project_id ORDER BY position LIMIT 1 OFFSET 1);
      INSERT INTO kanban_columns (id, project_id, name, semantic_type, position, hidden, created_at)
        SELECT lower(hex(randomblob(16))), p.id, 'Готово к разработке', 'ready', COALESCE((SELECT MAX(position) FROM kanban_columns WHERE project_id=p.id),0)+1024, 0, CAST(strftime('%s','now') AS INTEGER)*1000 FROM projects p
        WHERE NOT EXISTS (SELECT 1 FROM kanban_columns WHERE project_id=p.id AND semantic_type='ready');
      INSERT INTO kanban_columns (id, project_id, name, semantic_type, position, hidden, created_at)
        SELECT lower(hex(randomblob(16))), p.id, 'Тестирование', 'testing', COALESCE((SELECT MAX(position) FROM kanban_columns WHERE project_id=p.id),0)+1024, 0, CAST(strftime('%s','now') AS INTEGER)*1000 FROM projects p
        WHERE NOT EXISTS (SELECT 1 FROM kanban_columns WHERE project_id=p.id AND semantic_type='testing');
      INSERT INTO kanban_columns (id, project_id, name, semantic_type, position, hidden, created_at)
        SELECT lower(hex(randomblob(16))), p.id, 'Ожидает мержа', 'awaiting_merge', COALESCE((SELECT MAX(position) FROM kanban_columns WHERE project_id=p.id),0)+1024, 0, CAST(strftime('%s','now') AS INTEGER)*1000 FROM projects p
        WHERE NOT EXISTS (SELECT 1 FROM kanban_columns WHERE project_id=p.id AND semantic_type='awaiting_merge');
    `)
    const featureProjectCols = this.db.prepare(`PRAGMA table_info(projects)`).all() as Array<{ name: string }>
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'commit_policy')) this.db.exec(`ALTER TABLE projects ADD COLUMN commit_policy TEXT NOT NULL DEFAULT 'agent_commits'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'merge_transport')) this.db.exec(`ALTER TABLE projects ADD COLUMN merge_transport TEXT NOT NULL DEFAULT 'local'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'agent_plan_approval_mode')) this.db.exec(`ALTER TABLE projects ADD COLUMN agent_plan_approval_mode TEXT NOT NULL DEFAULT 'manual'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'test_command')) this.db.exec(`ALTER TABLE projects ADD COLUMN test_command TEXT NOT NULL DEFAULT ''`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'production_deploy_command')) this.db.exec(`ALTER TABLE projects ADD COLUMN production_deploy_command TEXT NOT NULL DEFAULT ''`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'default_skills_epic')) this.db.exec(`ALTER TABLE projects ADD COLUMN default_skills_epic TEXT NOT NULL DEFAULT '[]'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'default_skills_story')) this.db.exec(`ALTER TABLE projects ADD COLUMN default_skills_story TEXT NOT NULL DEFAULT '[]'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'default_skills_task')) this.db.exec(`ALTER TABLE projects ADD COLUMN default_skills_task TEXT NOT NULL DEFAULT '[]'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'ci_base_branch')) this.db.exec(`ALTER TABLE projects ADD COLUMN ci_base_branch TEXT NOT NULL DEFAULT 'main'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'ci_branch_template')) this.db.exec(`ALTER TABLE projects ADD COLUMN ci_branch_template TEXT NOT NULL DEFAULT 'feature/{task_number}-{slug}'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'ci_reuse_strategy')) this.db.exec(`ALTER TABLE projects ADD COLUMN ci_reuse_strategy TEXT NOT NULL DEFAULT 'fail'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'ci_exec_auth_ref')) this.db.exec(`ALTER TABLE projects ADD COLUMN ci_exec_auth_ref TEXT NOT NULL DEFAULT ''`)
    // Порог «сколько держать завершённые на доске»: существующим проектам —
    // дефолт 14 дней (DEFAULT в ALTER заполняет старые строки).
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'done_retention_days')) this.db.exec(`ALTER TABLE projects ADD COLUMN done_retention_days INTEGER DEFAULT ${DEFAULT_DONE_RETENTION_DAYS}`)
    const ciRunCols = this.db.prepare(`PRAGMA table_info(ci_runs)`).all() as Array<{ name: string }>
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'llm_provider')) this.db.exec(`ALTER TABLE ci_runs ADD COLUMN llm_provider TEXT NOT NULL DEFAULT 'claude'`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'llm_model')) this.db.exec(`ALTER TABLE ci_runs ADD COLUMN llm_model TEXT NOT NULL DEFAULT 'sonnet'`)
    // Режим запуска (план/разработка), глубина уточнений и связанный чат рана.
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'mode')) this.db.exec(`ALTER TABLE ci_runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'development'`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'clarify_level')) this.db.exec(`ALTER TABLE ci_runs ADD COLUMN clarify_level TEXT NOT NULL DEFAULT 'few'`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'clarify_max')) this.db.exec(`ALTER TABLE ci_runs ADD COLUMN clarify_max INTEGER NOT NULL DEFAULT 3`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'conversation_id')) this.db.exec(`ALTER TABLE ci_runs ADD COLUMN conversation_id TEXT`)
    const ciLlmCols = this.db.prepare(`PRAGMA table_info(ci_llm_configs)`).all() as Array<{ name: string }>
    if (ciLlmCols.length && !ciLlmCols.some((c) => c.name === 'mode')) this.db.exec(`ALTER TABLE ci_llm_configs ADD COLUMN mode TEXT NOT NULL DEFAULT 'development'`)
    if (ciLlmCols.length && !ciLlmCols.some((c) => c.name === 'clarify_level')) this.db.exec(`ALTER TABLE ci_llm_configs ADD COLUMN clarify_level TEXT NOT NULL DEFAULT 'few'`)
    if (ciLlmCols.length && !ciLlmCols.some((c) => c.name === 'clarify_max')) this.db.exec(`ALTER TABLE ci_llm_configs ADD COLUMN clarify_max INTEGER NOT NULL DEFAULT 3`)
    const ciSettingsCols = this.db.prepare(`PRAGMA table_info(ci_settings)`).all() as Array<{ name: string }>
    if (ciSettingsCols.length && !ciSettingsCols.some((c) => c.name === 'interaction_wait_ms')) this.db.exec(`ALTER TABLE ci_settings ADD COLUMN interaction_wait_ms INTEGER NOT NULL DEFAULT 1800000`)

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
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    if (this.ftsTimer) clearTimeout(this.ftsTimer)
    this.ftsTimer = null
    this.db.close()
  }

  // ---- Conversations ----------------------------------------------------

  createConversation(userId: string, title = 'Новый разговор'): Conversation {
    const id = this.newId()
    const ts = this.now()
    this.db
      .prepare(
        `INSERT INTO conversations (id, title, created_at, updated_at, claude_session_id, user_id, exec_target)
         VALUES (?, ?, ?, ?, NULL, ?, NULL)`
      )
      .run(id, title, ts, ts, userId)
    return { id, title, createdAt: ts, updatedAt: ts, messageCount: 0, claudeSessionId: null, execTarget: null, workdir: null, skillNames: [], llmProvider: null, llmModel: null, permissionMode: null, kbContextMode: 'auto', projectId: null, status: DEFAULT_CONVERSATION_STATUS, lastExecTarget: null }
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
    permissionMode?: PermissionMode | null
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


  setConversationKbContextMode(userId: string, id: string, mode: 'auto' | 'manual' | 'off'): Conversation | null {
    this.db.prepare(`UPDATE conversations SET kb_context_mode = ? WHERE id = ? AND user_id = ?`).run(mode, id, userId)
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

  // ---- Messages ---------------------------------------------------------

  addMessage(
    userId: string,
    conversationId: string,
    role: MessageRole,
    text: string,
    time: string,
    engine?: LlmProvider,
    meta?: TurnMeta,
    execTarget?: string | null
  ): Message {
    if (!this.ownsConversation(userId, conversationId)) {
      throw new Error(`Разговор ${conversationId} не принадлежит пользователю`)
    }
    const id = this.newId()
    const createdAt = this.now()
    const insert = this.db.prepare(
      `INSERT INTO messages (id, conversation_id, role, text, time, created_at, engine, meta, exec_target)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const touch = this.db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`)
    const metaJson = meta && Object.keys(meta).length > 0 ? JSON.stringify(meta) : null
    this.db.transaction(() => {
      insert.run(id, conversationId, role, text, time, createdAt, engine ?? null, metaJson, execTarget ?? null)
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
      ...(execTarget !== undefined ? { execTarget } : {})
    }
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
        `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC`
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
      ...(r.exec_target !== null ? { execTarget: r.exec_target } : {})
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
   */
  searchMessages(userId: string, opts: MessageSearchOptions): MessageSearchResult {
    const match = toFtsMatchQuery(opts.q ?? '')
    const limit = clampSearchLimit(opts.limit)
    // Индекса нет (сборка SQLite без FTS5) или искать нечего — пустая страница.
    if (!match || !this.ftsReady) return { hits: [], nextCursor: null, match }

    const where = ['messages_fts MATCH ?', 'c.user_id = ?']
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

  getSettings(userId: string): Settings {
    const row = this.db
      .prepare(`SELECT value FROM settings WHERE key = ?`)
      .get(settingsKey(userId)) as { value: string } | undefined
    if (!row) return { ...DEFAULT_SETTINGS }
    try {
      // Мержим с дефолтами, чтобы новые поля не ломали старый конфиг.
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(row.value) as Partial<Settings>) }
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

  deleteAgent(userId: string, id: string): void {
    this.db.prepare(`DELETE FROM agents WHERE id = ? AND user_id = ?`).run(id, userId)
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

  /** Создаёт пользователя (роль admin/user). Кидает при дубликате имени. */
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

  setUserPassword(name: string, password: string): void {
    this.db.prepare(`UPDATE users SET password_hash = ? WHERE name = ?`).run(hashPassword(password), name)
  }

  deleteUser(name: string): void {
    this.db.prepare(`DELETE FROM users WHERE name = ?`).run(name)
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

  // ---- Отчёт по токенам (агрегация meta ai-сообщений пользователя) --------

  /**
   * Отчёт по использованию токенов пользователя: суммы по временным бакетам и по
   * моделям + итог. Считается из meta ai-сообщений (JSON1 json_extract). Бакеты
   * времени — в UTC (created_at хранится в мс).
   */
  usageReport(userId: string, unit: UsageUnit, from?: number, to?: number): UsageReport {
    // Формат бакета для strftime над created_at/1000 (unixepoch, UTC).
    const fmt = unit === 'hour' ? '%Y-%m-%d %H:00' : unit === 'week' ? '%Y-W%W' : '%Y-%m-%d'
    // Суммы токенов/стоимости (COALESCE, т.к. json_extract даёт NULL при отсутствии).
    const sums = `
      COUNT(*) AS messages,
      COALESCE(SUM(json_extract(m.meta,'$.inputTokens')),0) AS inputTokens,
      COALESCE(SUM(json_extract(m.meta,'$.outputTokens')),0) AS outputTokens,
      COALESCE(SUM(json_extract(m.meta,'$.cacheReadTokens')),0) AS cacheReadTokens,
      COALESCE(SUM(json_extract(m.meta,'$.costUsd')),0) AS costUsd`
    const where = `c.user_id = @userId AND m.role = 'ai' AND m.meta IS NOT NULL
      ${from !== undefined ? 'AND m.created_at >= @from' : ''}
      ${to !== undefined ? 'AND m.created_at <= @to' : ''}`
    const bind = {
      userId,
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {})
    }

    const totals = this.db
      .prepare(`SELECT ${sums} FROM messages m JOIN conversations c ON m.conversation_id = c.id WHERE ${where}`)
      .get(bind) as UsageTotals
    const byBucket = this.db
      .prepare(
        `SELECT strftime('${fmt}', m.created_at/1000, 'unixepoch') AS bucket, ${sums}
         FROM messages m JOIN conversations c ON m.conversation_id = c.id
         WHERE ${where} GROUP BY bucket ORDER BY bucket ASC`
      )
      .all(bind) as UsageBucket[]
    const byModel = this.db
      .prepare(
        `SELECT COALESCE(json_extract(m.meta,'$.model'),'?') AS model, ${sums}
         FROM messages m JOIN conversations c ON m.conversation_id = c.id
         WHERE ${where} GROUP BY model ORDER BY outputTokens DESC`
      )
      .all(bind) as UsageByModel[]
    return { unit, totals, byBucket, byModel }
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
      llmProvider: row.llm_provider === 'claude' || row.llm_provider === 'codex' ? row.llm_provider : null,
      llmModel: row.llm_model,
      // Мусор в колонке (например, откат версии) читаем как «из общих настроек».
      permissionMode:
        row.permission_mode === 'plan' || row.permission_mode === 'acceptEdits' || row.permission_mode === 'bypassPermissions'
          ? row.permission_mode
          : null,
      kbContextMode: row.kb_context_mode === 'manual' || row.kb_context_mode === 'off' ? row.kb_context_mode : 'auto',
      projectId: row.project_id ?? null,
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

  private isProjectOwner(userId: string, projectId: string): boolean {
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
      ciBaseBranch: r.ci_base_branch,
      ciBranchTemplate: r.ci_branch_template,
      ciReuseStrategy: r.ci_reuse_strategy === 'reuse' || r.ci_reuse_strategy === 'clean' ? r.ci_reuse_strategy : 'fail',
      ciExecAuthRef: r.ci_exec_auth_ref,
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
        ['Готово к разработке', 'ready'],
        ['В разработке', 'development'],
        ['Тестирование', 'testing'],
        ['Ожидает мержа', 'awaiting_merge'],
        ['Готово', 'done']
      ].forEach(([name, semantic], i) =>
        this.db.prepare(`INSERT INTO kanban_columns (id, project_id, name, semantic_type, position, hidden, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`).run(this.newId(), id, name, semantic, (i + 1) * RANK_STEP, ts)
      )
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
        .prepare(`SELECT username, role, added_at FROM project_members WHERE project_id = ? ORDER BY added_at ASC`)
        .all(id) as ProjectMemberRow[]
    ).map(
      (m): ProjectMember => ({
        username: m.username,
        role: m.role === 'owner' ? 'owner' : 'member',
        addedAt: m.added_at
      })
    )
    const machines = (
      this.db.prepare(`SELECT agent_id, path, repos_root FROM project_machines WHERE project_id = ? ORDER BY agent_id ASC`).all(id) as Array<{
        agent_id: string
        path: string | null
        repos_root: string | null
      }>
    ).map((x) => ({ agentId: x.agent_id, path: x.path ?? '', reposRoot: x.repos_root ?? '' }))
    return {
      ...this.mapProjectSummary(row, row.my_role),
      members,
      machines,
      defaultAgentId: row.default_agent_id ?? null
    }
  }

  updateProject(
    userId: string,
    id: string,
    fields: {
      name?: string
      description?: string
      gitUrl?: string | null
      technologies?: string[]
      skills?: string[]
      defaultSkills?: Partial<WorkItemDefaultSkills>
      commitPolicy?: 'agent_commits' | 'final_system_commit' | 'manual_user_confirmation'
      mergeTransport?: 'local' | 'github_pull_request'
      agentPlanApprovalMode?: 'manual' | 'automatic'
      testCommand?: string
      productionDeployCommand?: string
      ciBaseBranch?: string
      ciBranchTemplate?: string
      ciReuseStrategy?: 'reuse' | 'clean' | 'fail'
      ciExecAuthRef?: string
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
    if (fields.ciBaseBranch !== undefined) { set.push('ci_base_branch = ?'); vals.push(fields.ciBaseBranch) }
    if (fields.ciBranchTemplate !== undefined) { set.push('ci_branch_template = ?'); vals.push(fields.ciBranchTemplate) }
    if (fields.ciReuseStrategy !== undefined) { set.push('ci_reuse_strategy = ?'); vals.push(fields.ciReuseStrategy) }
    if (fields.ciExecAuthRef !== undefined) { set.push('ci_exec_auth_ref = ?'); vals.push(fields.ciExecAuthRef) }
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

  addMember(userId: string, id: string, username: string): ProjectDetail | null {
    if (!this.isProjectOwner(userId, id)) return null
    if (!this.db.prepare(`SELECT 1 FROM users WHERE name = ?`).get(username)) {
      throw new Error(`Пользователь ${username} не найден`)
    }
    this.db
      .prepare(`INSERT OR IGNORE INTO project_members (project_id, username, role, added_at) VALUES (?, ?, 'member', ?)`)
      .run(id, username, this.now())
    return this.getProject(userId, id)
  }

  removeMember(userId: string, id: string, username: string): ProjectDetail | null {
    if (!this.isProjectOwner(userId, id)) return null
    const row = this.db
      .prepare(`SELECT role FROM project_members WHERE project_id = ? AND username = ?`)
      .get(id, username) as { role: string } | undefined
    // Владельца не удаляем этим путём (нет «осиротевших» проектов).
    if (row && row.role !== 'owner') {
      this.db.transaction(() => {
        this.db.prepare(`DELETE FROM project_members WHERE project_id = ? AND username = ?`).run(id, username)
        this.db
          .prepare(`UPDATE tasks SET assignee = NULL, updated_at = ? WHERE project_id = ? AND assignee = ?`)
          .run(this.now(), id, username)
      })()
    }
    return this.getProject(userId, id)
  }

  linkMachine(userId: string, id: string, agentId: string): ProjectDetail | null {
    if (!this.isProjectOwner(userId, id)) return null
    if (!this.db.prepare(`SELECT 1 FROM agents WHERE id = ? AND user_id = ?`).get(agentId, userId)) {
      throw new Error(`Машина ${agentId} не найдена`)
    }
    this.db
      .prepare(`INSERT OR IGNORE INTO project_machines (project_id, agent_id, path) VALUES (?, ?, '')`)
      .run(id, agentId)
    return this.getProject(userId, id)
  }

  unlinkMachine(userId: string, id: string, agentId: string): ProjectDetail | null {
    if (!this.isProjectOwner(userId, id)) return null
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM project_machines WHERE project_id = ? AND agent_id = ?`).run(id, agentId)
      // Снятая машина не может оставаться дефолтной.
      this.db.prepare(`UPDATE projects SET default_agent_id = NULL WHERE id = ? AND default_agent_id = ?`).run(id, agentId)
    })()
    return this.getProject(userId, id)
  }

  /** Задать папку проекта на конкретной машине (только владелец). */
  setProjectMachinePath(userId: string, id: string, agentId: string, path: string): ProjectDetail | null {
    if (!this.isProjectOwner(userId, id)) return null
    this.db
      .prepare(`UPDATE project_machines SET path = ? WHERE project_id = ? AND agent_id = ?`)
      .run(path, id, agentId)
    this.touchProject(id)
    return this.getProject(userId, id)
  }

  /** Корень пула рабочих копий CI на этой машине. */
  setProjectMachineReposRoot(userId: string, id: string, agentId: string, root: string): ProjectDetail | null {
    if (!this.isProjectOwner(userId, id)) return null
    this.db.prepare(`UPDATE project_machines SET repos_root = ? WHERE project_id = ? AND agent_id = ?`).run(root, id, agentId)
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
   * ПЕРЕЗАПИСЫВАЕТ у чата машину (=дефолт проекта), рабочую папку (=папка этой
   * машины) и навыки (=skills проекта). Гейт — членство в проекте.
   */
  setConversationProject(userId: string, convId: string, projectId: string | null): Conversation | null {
    if (projectId === null) {
      this.db.prepare(`UPDATE conversations SET project_id = NULL WHERE id = ? AND user_id = ?`).run(convId, userId)
      return this.getConversation(userId, convId)
    }
    const project = this.getProject(userId, projectId)
    if (!project) return null // не участник / проект не найден
    const defAgent = project.defaultAgentId
    const rawPath = defAgent ? project.machines.find((m) => m.agentId === defAgent)?.path ?? '' : ''
    const workdir = rawPath !== '' ? rawPath : null
    this.db
      .prepare(
        `UPDATE conversations SET project_id = ?, exec_target = ?, workdir = ?, skill_names = ? WHERE id = ? AND user_id = ?`
      )
      .run(projectId, defAgent, workdir, JSON.stringify(project.skills), convId, userId)
    return this.getConversation(userId, convId)
  }

  /**
   * Открыть связанный с задачей чат текущего пользователя, создав его при
   * отсутствии. Новый чат привязывается к задаче (`task_id`) и её проекту:
   * машина/папка — из дефолта проекта, навыки — навыки самой карточки (`Task.skills`).
   * Идемпотентно по (userId, taskId): одна задача — не более одного чата на юзера.
   * Имя по умолчанию — «Задача <заголовок>»: в общем списке чатов такой чат сразу
   * отличим от обычного разговора. Дальше его можно переименовать вручную.
   */
  openOrCreateTaskChat(userId: string, projectId: string, taskId: string): Conversation | null {
    if (!this.isProjectMember(userId, projectId)) return null
    const task = this.getTask(projectId, taskId)
    if (!task) return null
    const existing = this.db
      .prepare(`SELECT id FROM conversations WHERE task_id = ? AND user_id = ? ORDER BY created_at ASC LIMIT 1`)
      .get(taskId, userId) as { id: string } | undefined
    if (existing) return this.getConversation(userId, existing.id)
    const project = this.getProject(userId, projectId)
    const defAgent = project?.defaultAgentId ?? null
    const rawPath = defAgent ? project?.machines.find((m) => m.agentId === defAgent)?.path ?? '' : ''
    const workdir = rawPath !== '' ? rawPath : null
    const id = this.newId()
    const ts = this.now()
    const title = task.title.trim() ? `Задача ${task.title.trim()}` : 'Задача'
    this.db
      .prepare(
        `INSERT INTO conversations (id, title, created_at, updated_at, claude_session_id, user_id, exec_target, workdir, skill_names, project_id, task_id)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, title, ts, ts, userId, defAgent, workdir, JSON.stringify(task.skills), projectId, taskId)
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
                        ORDER BY c.created_at ASC LIMIT 1) AS chat_id
           FROM tasks t WHERE t.project_id = ? ORDER BY t.column_id ASC, t.position ASC`
        )
        .all(userId, projectId) as TaskRow[]
    ).map(mapTask)
    // Фильтруем на сервере: иначе payload доски рос бы бесконечно вместе с
    // колонкой «Готово». includeCompleted → порог null, скрывать нечего.
    const retention = opts?.includeCompleted ? null : this.doneRetentionDays(projectId)
    const now = this.now()
    const visible = tasks.filter((t) => !isCompletedHidden(t.doneAt, retention, now))

    return { columns, tasks: visible, ciRuns: this.latestCiRunSummaries(projectId) }
  }

  /**
   * Контекст задачи для шапки связанного чата: иерархия Эпик→Стори→Задача,
   * этап воркфлоу (колонка), машина и папка разработки, последний CI-ран.
   * `null`, если чат не привязан к задаче.
   */
  getTaskChatContext(userId: string, conversationId: string): TaskChatContext | null {
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
    const agentId = conv.execTarget && conv.execTarget !== 'none' ? conv.execTarget : project.defaultAgentId
    const machine = agentId ? project.machines.find((m) => m.agentId === agentId) : undefined
    const runRow = this.db.prepare(`SELECT * FROM ci_runs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1`).get(task.id) as CiRunRow | undefined
    const run = runRow ? mapCiRun(runRow) : null

    return {
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
        `SELECT c.id AS conversation_id, t.id AS task_id, t.project_id, t.seq, t.type, p.name AS project_name
         FROM conversations c
         JOIN tasks t ON t.id = c.task_id
         JOIN projects p ON p.id = t.project_id
         WHERE c.user_id = ? AND c.task_id IS NOT NULL`
      )
      .all(userId) as Array<{ conversation_id: string; task_id: string; project_id: string; seq: number; type: string; project_name: string }>
    return rows.map((r) => ({
      conversationId: r.conversation_id,
      projectId: r.project_id,
      taskId: r.task_id,
      key: issueKey(r.project_name, { seq: r.seq }),
      type: normWorkItemType(r.type),
      run: this.latestCiRunSummary(r.task_id)
    }))
  }

  /** Имя машины по id (для читаемой подписи в шапке чата). */
  private agentName(agentId: string): string | null {
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
      labels?: string[]
      skills?: string[]
      storyPoints?: number | null
      dueDate?: number | null
    }
  ): Task | null {
    if (!this.isProjectMember(userId, projectId)) return null

    if (!this.columnInProject(projectId, args.columnId)) return null
    if (args.assignee != null && !this.isProjectMember(args.assignee, projectId)) {
      throw new Error('Исполнитель не участник проекта')
    }
    const itemType = args.type ?? 'task'
    // Навыки карточки: явно переданные, иначе — навыки по умолчанию из настроек
    // проекта для этого типа элемента (эпик/стори/таск).
    const skills = args.skills ?? this.projectDefaultSkills(projectId, itemType)
    const parent = args.parentId ? this.getTask(projectId, args.parentId) : null

    if (itemType === 'epic' && args.parentId) throw new Error('Эпик не может иметь родителя')
    if (args.parentId && !parent) throw new Error('Родитель не найден в проекте')
    if (itemType === 'story' && parent?.type !== 'epic') throw new Error('Родителем истории может быть только эпик')
    if (itemType === 'task' && parent && parent.type !== 'story' && parent.type !== 'epic') throw new Error('Недопустимый родитель задачи')
    const id = this.newId()
    const ts = this.now()
    const max = (
      this.db
        .prepare(`SELECT MAX(position) AS m FROM tasks WHERE project_id = ? AND column_id = ?`)
        .get(projectId, args.columnId) as { m: number | null }
    ).m
    const position = (max ?? 0) + RANK_STEP
    // Карточку могут создать сразу в «Готово» — тогда отсчёт начинается сейчас.
    const doneAt = this.isDoneColumn(args.columnId) ? ts : null
    const seq = (
      this.db.prepare(`UPDATE projects SET task_seq = task_seq + 1 WHERE id = ? RETURNING task_seq`).get(projectId) as { task_seq: number }
    ).task_seq
    this.db
      .prepare(
        `INSERT INTO tasks (id, project_id, column_id, title, description, acceptance_criteria, type, parent_id, priority, assignee, labels, skills, story_points, due_date, flagged, done_at, seq, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        projectId,
        args.columnId,
        args.title,
        args.description ?? '',
        args.acceptanceCriteria ?? '',
        itemType,
        args.parentId ?? null,
        normPriority(args.priority ?? 'medium'),
        args.assignee ?? null,
        JSON.stringify(args.labels ?? []),
        JSON.stringify(skills),
        args.storyPoints ?? null,

        args.dueDate ?? null,
        doneAt,
        seq,
        position,
        ts,
        ts
      )
    this.touchProject(projectId, ts)
    return this.getTask(projectId, id)
  }

  updateTask(
    userId: string,
    projectId: string,
    taskId: string,
    fields: { title?: string; description?: string; acceptanceCriteria?: string; type?: WorkItemType; parentId?: string | null; priority?: TaskPriority; assignee?: string | null; labels?: string[]; skills?: string[]; storyPoints?: number | null; dueDate?: number | null; flagged?: boolean }
  ): Task | null {
    if (!this.isProjectMember(userId, projectId)) return null
    const current = this.getTask(projectId, taskId)

    if (!current) return null
    if (fields.assignee != null && !this.isProjectMember(fields.assignee, projectId)) {
      throw new Error('Исполнитель не участник проекта')
    }
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

  // ============================ CI-раннер ============================

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
        `INSERT INTO ci_commands (id, scope, project_id, name, script, description, workdir, timeout_sec, env_json, allow_failure, is_cleanup, available_to_model, version, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
      )
      .run(
        id, scope, projectId, name, input.script ?? '', input.description ?? '', input.workdir ?? '',
        input.timeoutSec ?? null, JSON.stringify(input.env ?? {}),
        input.allowFailure ? 1 : 0, input.isCleanup ? 1 : 0, input.availableToModel === false ? 0 : 1,
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

  /** Эффективные слоты задачи: её переопределение либо дефолты проекта. */
  resolveTaskSlots(projectId: string, taskId: string): CiSlotConfig {
    if (this.hasCiSlotConfig('task', taskId)) return this.getCiSlotConfig('task', taskId)
    return this.getCiSlotConfig('project', projectId)
  }

  getCiLlmConfig(ownerType: 'project' | 'task', ownerId: string): CiLlmConfig | null {
    const row = this.db.prepare(`SELECT provider, model, mode, clarify_level, clarify_max FROM ci_llm_configs WHERE owner_type = ? AND owner_id = ?`).get(ownerType, ownerId) as
      | { provider: string; model: string; mode: string; clarify_level: string; clarify_max: number }
      | undefined
    if (!row) return null
    return {
      provider: row.provider === 'codex' ? 'codex' : 'claude',
      model: row.model,
      mode: normRunMode(row.mode),
      clarifyLevel: normClarifyLevel(row.clarify_level),
      clarifyMax: clampClarifyMax(row.clarify_max)
    }
  }

  setCiLlmConfig(ownerType: 'project' | 'task', ownerId: string, config: CiLlmConfig): CiLlmConfig {
    const provider = config.provider === 'codex' ? 'codex' : 'claude'
    const model = config.model.trim() || (provider === 'codex' ? 'gpt-5.4' : 'sonnet')
    const next: CiLlmConfig = {
      provider,
      model,
      mode: normRunMode(config.mode),
      clarifyLevel: normClarifyLevel(config.clarifyLevel),
      clarifyMax: clampClarifyMax(config.clarifyMax)
    }
    this.db
      .prepare(
        `INSERT INTO ci_llm_configs (owner_type, owner_id, provider, model, mode, clarify_level, clarify_max)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_type, owner_id) DO UPDATE SET provider=excluded.provider, model=excluded.model,
           mode=excluded.mode, clarify_level=excluded.clarify_level, clarify_max=excluded.clarify_max`
      )
      .run(ownerType, ownerId, next.provider, next.model, next.mode, next.clarifyLevel, next.clarifyMax)
    return next
  }

  /** Снять переопределение (задача снова наследует настройку проекта). */
  clearCiLlmConfig(ownerType: 'project' | 'task', ownerId: string): boolean {
    return this.db.prepare(`DELETE FROM ci_llm_configs WHERE owner_type = ? AND owner_id = ?`).run(ownerType, ownerId).changes > 0
  }

  resolveTaskLlmConfig(projectId: string, taskId: string): CiLlmConfig {
    return this.getCiLlmConfig('task', taskId) ?? this.getCiLlmConfig('project', projectId) ?? { ...DEFAULT_CI_LLM_CONFIG }
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
    const r = this.db.prepare(`SELECT * FROM ci_settings WHERE id = 1`).get() as Record<string, number> | undefined
    if (!r) {
      const d = DEFAULT_CI_GLOBAL_SETTINGS
      this.db.prepare(`INSERT INTO ci_settings (id, max_fix_attempts, fix_time_limit_ms, fix_token_limit, default_step_timeout_sec, metrics_window, max_concurrent_runs, max_model_command_calls, interaction_wait_ms) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`).run(d.maxFixAttempts, d.fixTimeLimitMs, d.fixTokenLimit, d.defaultStepTimeoutSec, d.metricsWindow, d.maxConcurrentRuns, d.maxModelCommandCalls, d.interactionWaitMs)
      return { ...d }
    }
    return {
      maxFixAttempts: r.max_fix_attempts, fixTimeLimitMs: r.fix_time_limit_ms, fixTokenLimit: r.fix_token_limit,
      defaultStepTimeoutSec: r.default_step_timeout_sec, metricsWindow: r.metrics_window,
      maxConcurrentRuns: r.max_concurrent_runs, maxModelCommandCalls: r.max_model_command_calls,
      interactionWaitMs: r.interaction_wait_ms ?? DEFAULT_CI_GLOBAL_SETTINGS.interactionWaitMs
    }
  }

  updateCiSettings(patch: Partial<CiGlobalSettings>): CiGlobalSettings {
    const cur = this.getCiSettings()
    const next = { ...cur, ...patch }
    this.db.prepare(`UPDATE ci_settings SET max_fix_attempts=?, fix_time_limit_ms=?, fix_token_limit=?, default_step_timeout_sec=?, metrics_window=?, max_concurrent_runs=?, max_model_command_calls=?, interaction_wait_ms=? WHERE id=1`).run(next.maxFixAttempts, next.fixTimeLimitMs, next.fixTokenLimit, next.defaultStepTimeoutSec, next.metricsWindow, next.maxConcurrentRuns, next.maxModelCommandCalls, next.interactionWaitMs)
    return next
  }

  // --- Раны и шаги ---

  createCiRun(args: { projectId: string; taskId: string; agentId: string | null; triggeredBy: string; prevColumnId: string | null; slotProgress: CiSlotProgress; llmProvider?: 'claude' | 'codex'; llmModel?: string; mode?: CiRunMode; clarifyLevel?: CiClarifyLevel; clarifyMax?: number; conversationId?: string | null }): CiRun {
    const id = this.newId()
    const ts = this.now()
    this.db.prepare(`INSERT INTO ci_runs (id, project_id, task_id, agent_id, status, triggered_by, prev_column_id, llm_provider, llm_model, mode, clarify_level, clarify_max, conversation_id, slot_progress_json, created_at) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, args.projectId, args.taskId, args.agentId, args.triggeredBy, args.prevColumnId, args.llmProvider ?? 'claude', args.llmModel ?? 'sonnet', normRunMode(args.mode), normClarifyLevel(args.clarifyLevel), clampClarifyMax(args.clarifyMax), args.conversationId ?? null, JSON.stringify(args.slotProgress), ts)
    return mapCiRun(this.db.prepare(`SELECT * FROM ci_runs WHERE id = ?`).get(id) as CiRunRow)
  }

  getCiRunRaw(runId: string): CiRun | null {
    const r = this.db.prepare(`SELECT * FROM ci_runs WHERE id = ?`).get(runId) as CiRunRow | undefined
    return r ? mapCiRun(r) : null
  }

  getCiRun(userId: string, runId: string): CiRunDetail | null {
    const r = this.db.prepare(`SELECT * FROM ci_runs WHERE id = ?`).get(runId) as CiRunRow | undefined
    if (!r || !this.isProjectMember(userId, r.project_id)) return null
    const run = mapCiRun(r)
    const steps = (this.db.prepare(`SELECT * FROM ci_run_steps WHERE run_id = ? ORDER BY position ASC, id ASC`).all(runId) as CiRunStepRow[]).map(mapCiRunStep)
    const fixAttempts = (this.db.prepare(`SELECT f.* FROM ci_fix_attempts f JOIN ci_run_steps s ON s.id = f.run_step_id WHERE s.run_id = ? ORDER BY f.created_at ASC`).all(runId) as CiFixRow[]).map(mapCiFix)
    return { run, steps, fixAttempts, interactions: this.listCiInteractions(runId) }
  }

  listCiRunsForTask(userId: string, projectId: string, taskId: string): CiRun[] {
    if (!this.isProjectMember(userId, projectId)) return []
    return (this.db.prepare(`SELECT * FROM ci_runs WHERE task_id = ? ORDER BY created_at DESC`).all(taskId) as CiRunRow[]).map(mapCiRun)
  }

  updateCiRun(runId: string, patch: { status?: CiStatus; workspaceId?: string | null; startedAt?: number; finishedAt?: number; durationMs?: number; slotProgress?: CiSlotProgress; llmProvider?: 'claude' | 'codex'; llmModel?: string; mode?: CiRunMode; conversationId?: string | null }): CiRun | null {
    const set: string[] = []
    const vals: unknown[] = []
    if (patch.status !== undefined) { set.push('status = ?'); vals.push(patch.status) }
    if (patch.workspaceId !== undefined) { set.push('workspace_id = ?'); vals.push(patch.workspaceId) }
    if (patch.startedAt !== undefined) { set.push('started_at = ?'); vals.push(patch.startedAt) }
    if (patch.finishedAt !== undefined) { set.push('finished_at = ?'); vals.push(patch.finishedAt) }
    if (patch.durationMs !== undefined) { set.push('duration_ms = ?'); vals.push(patch.durationMs) }
    if (patch.slotProgress !== undefined) { set.push('slot_progress_json = ?'); vals.push(JSON.stringify(patch.slotProgress)) }
    if (patch.llmProvider !== undefined) { set.push('llm_provider = ?'); vals.push(patch.llmProvider) }
    if (patch.llmModel !== undefined) { set.push('llm_model = ?'); vals.push(patch.llmModel) }
    if (patch.mode !== undefined) { set.push('mode = ?'); vals.push(normRunMode(patch.mode)) }
    if (patch.conversationId !== undefined) { set.push('conversation_id = ?'); vals.push(patch.conversationId) }
    if (!set.length) return this.getCiRunRaw(runId)
    this.db.prepare(`UPDATE ci_runs SET ${set.join(', ')} WHERE id = ?`).run(...vals, runId)
    return this.getCiRunRaw(runId)
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

  addCiFixAttempt(args: { runStepId: string; attemptNo: number; diagnosis: string; action: string; result: CiFixAttempt['result']; diff?: string | null; durationMs?: number | null; tokensUsed?: number | null }): CiFixAttempt {
    const id = this.newId()
    this.db.prepare(`INSERT INTO ci_fix_attempts (id, run_step_id, attempt_no, diagnosis, action, result, diff, duration_ms, tokens_used, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, args.runStepId, args.attemptNo, args.diagnosis, args.action, args.result, args.diff ?? null, args.durationMs ?? null, args.tokensUsed ?? null, this.now())
    return mapCiFix(this.db.prepare(`SELECT * FROM ci_fix_attempts WHERE id = ?`).get(id) as CiFixRow)
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

  /** Сводки последних ранов по задачам проекта — для доски/карточки. */
  latestCiRunSummaries(projectId: string): CiRunSummary[] {
    const rows = this.db.prepare(`SELECT * FROM ci_runs WHERE project_id = ? ORDER BY created_at DESC`).all(projectId) as CiRunRow[]
    const seen = new Set<string>()
    const out: CiRunSummary[] = []
    for (const r of rows) {
      if (seen.has(r.task_id)) continue
      seen.add(r.task_id)
      out.push(this.ciRunSummary(r))
    }
    return out
  }

  /** Сводка последнего рана одной задачи; null — ранов не было. */
  latestCiRunSummary(taskId: string): CiRunSummary | null {
    const row = this.db.prepare(`SELECT * FROM ci_runs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1`).get(taskId) as CiRunRow | undefined
    return row ? this.ciRunSummary(row) : null
  }

  private ciRunSummary(row: CiRunRow): CiRunSummary {
    const run = mapCiRun(row)
    const modelActive = run.status === 'running' && this.db.prepare(`SELECT 1 FROM ci_run_steps WHERE run_id = ? AND kind = 'model_work' AND status = 'running' LIMIT 1`).get(row.id) !== undefined
    return { id: run.id, taskId: run.taskId, status: run.status, slotProgress: run.slotProgress, durationMs: run.durationMs, modelActive, awaitingInput: run.status === 'awaiting_input' }
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
      chars: item.chars,
      estimatedTokens: estimateKbTokens(item.chars),
      score: item.score ?? null,
      matchTypes: item.matchTypes ?? [],
      freshness: item.freshness ?? 'unknown'
    }))
    const insertQuery = this.db.prepare(
      `INSERT INTO kb_usage_queries (id, seq, user_id, conversation_id, project_id, turn_id, message_id, source, status,
         query, confidence, injected, sections_count, chars, est_tokens, bundle_tokens, prompt_chars, turn_input_tokens,
         duration_ms, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const insertSection = this.db.prepare(
      `INSERT INTO kb_usage_sections (id, query_id, document_id, title, heading, anchor, source_path, chars, est_tokens,
         score, match_types, freshness, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        args.source, status, args.query, args.confidence ?? null, args.injected ? 1 : 0, sections.length, args.chars,
        estTokens, args.bundleTokens ?? null, args.promptChars ?? null, args.turnInputTokens ?? null,
        args.durationMs ?? null, args.error ?? null, createdAt
      )
      sections.forEach((section, position) => {
        insertSection.run(
          this.newId(), id, section.documentId, section.title, section.heading, section.anchor, section.sourcePath,
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

  /** Отчёт по чату: свой чат (изоляция по владельцу) — иначе null → 404 у роута. */
  kbUsageReport(userId: string, conversationId: string, limit = 40): KbChatUsage | null {
    const conv = this.getConversation(userId, conversationId)
    if (!conv) return null
    const totals = this.kbUsageTotals('conversation_id', conversationId)
    const sections = (this.db
      .prepare(
        `SELECT s.document_id, s.anchor, MAX(s.title) AS title, MAX(s.heading) AS heading,
                MAX(s.source_path) AS source_path, MAX(s.freshness) AS freshness, COUNT(*) AS times,
                SUM(CASE WHEN q.source = 'auto' THEN 1 ELSE 0 END) AS auto_times, SUM(s.chars) AS chars,
                SUM(s.est_tokens) AS est_tokens, MAX(q.created_at) AS last_at
           FROM kb_usage_sections s JOIN kb_usage_queries q ON q.id = s.query_id
          WHERE q.conversation_id = ?
          GROUP BY s.document_id, s.anchor
          ORDER BY times DESC, chars DESC`
      )
      .all(conversationId) as KbSectionAggRow[]).map(mapKbSectionAggregate)
    const recent = this.kbUsageQueries(`conversation_id = ?`, [conversationId], limit)
    return {
      conversationId,
      projectId: conv.projectId ?? null,
      kbContextMode: conv.kbContextMode ?? 'auto',
      lastSeq: this.kbUsageLastSeq(conversationId),
      totals,
      sections,
      recent
    }
  }

  /** Агрегат по всем чатам проекта: только участнику проекта — иначе null. */
  kbUsageProjectReport(userId: string, projectId: string, limit = 40): KbProjectUsage | null {
    if (!this.isProjectMember(userId, projectId)) return null
    const totals = this.kbUsageTotals('project_id', projectId)
    const sections = (this.db
      .prepare(
        `SELECT s.document_id, s.anchor, MAX(s.title) AS title, MAX(s.heading) AS heading,
                MAX(s.source_path) AS source_path, MAX(s.freshness) AS freshness, COUNT(*) AS times,
                SUM(CASE WHEN q.source = 'auto' THEN 1 ELSE 0 END) AS auto_times, SUM(s.chars) AS chars,
                SUM(s.est_tokens) AS est_tokens, MAX(q.created_at) AS last_at,
                COUNT(DISTINCT q.conversation_id) AS conversations
           FROM kb_usage_sections s JOIN kb_usage_queries q ON q.id = s.query_id
          WHERE q.project_id = ?
          GROUP BY s.document_id, s.anchor
          ORDER BY times DESC, chars DESC`
      )
      .all(projectId) as KbSectionAggRow[]).map(mapKbSectionAggregate)
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
    return { projectId, totals, sections, recent: this.kbUsageQueries(`project_id = ?`, [projectId], limit), conversations }
  }

  /**
   * Итоги по обращениям — ОТДЕЛЬНЫМ запросом, без JOIN с разделами: иначе суммы
   * размножились бы по числу разделов каждого обращения.
   */
  private kbUsageTotals(column: 'conversation_id' | 'project_id', value: string): KbUsageTotals {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS queries,
                SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
                SUM(CASE WHEN status = 'empty' THEN 1 ELSE 0 END) AS empty,
                SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
                SUM(CASE WHEN source <> 'auto' THEN 1 ELSE 0 END) AS tool_queries,
                SUM(sections_count) AS sections, SUM(chars) AS chars, SUM(est_tokens) AS est_tokens,
                MAX(created_at) AS last_at
           FROM kb_usage_queries WHERE ${column} = ?`
      )
      .get(value) as {
        queries: number; delivered: number | null; empty: number | null; errors: number | null
        tool_queries: number | null; sections: number | null; chars: number | null; est_tokens: number | null
        last_at: number | null
      }
    const documents = (this.db
      .prepare(
        `SELECT COUNT(DISTINCT s.document_id) AS n FROM kb_usage_sections s
           JOIN kb_usage_queries q ON q.id = s.query_id WHERE q.${column} = ?`
      )
      .get(value) as { n: number }).n
    // Промпт одного хода общий для всех его обращений — берём его по одному разу
    // на turn_id, иначе доля «сколько из промпта от БЗ» была бы заниженной.
    const promptChars = (this.db
      .prepare(
        `SELECT COALESCE(SUM(prompt_chars), 0) AS n FROM (
           SELECT COALESCE(turn_id, id) AS turn, MAX(prompt_chars) AS prompt_chars
             FROM kb_usage_queries WHERE ${column} = ? AND prompt_chars IS NOT NULL GROUP BY turn)`
      )
      .get(value) as { n: number }).n
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

  /** Последние обращения (новые сверху) вместе с их разделами. */
  private kbUsageQueries(where: string, params: unknown[], limit: number): KbUsageQuery[] {
    const rows = this.db
      .prepare(`SELECT * FROM kb_usage_queries WHERE ${where} ORDER BY created_at DESC, seq DESC LIMIT ?`)
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
}

// ============== Использование базы знаний: строки БД и мапперы ==============

/**
 * Отчёты БД без флагов конфигурации: доступность индекса и включённость
 * mcp__kb__* знает не БД, а роут (config + kb.status()) — он их и дописывает.
 */
export type KbChatUsage = Omit<KbUsageReport, 'toolEnabled' | 'available'>
/** То же для проектного агрегата. */
export type KbProjectUsage = Omit<KbProjectUsageReport, 'toolEnabled' | 'available'>

interface KbUsageQueryRow {
  id: string; seq: number; user_id: string; conversation_id: string; project_id: string | null
  turn_id: string | null; message_id: string | null; source: string; status: string; query: string
  confidence: string | null; injected: number; sections_count: number; chars: number; est_tokens: number
  bundle_tokens: number | null; prompt_chars: number | null; turn_input_tokens: number | null
  duration_ms: number | null; error: string | null; created_at: number
}
interface KbUsageSectionRow {
  id: string; query_id: string; document_id: string; title: string; heading: string; anchor: string
  source_path: string; chars: number; est_tokens: number; score: number | null; match_types: string
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
    documentId: r.document_id, title: r.title, heading: r.heading, anchor: r.anchor, sourcePath: r.source_path,
    chars: r.chars, estimatedTokens: r.est_tokens, score: r.score, matchTypes: kbMatchTypes(r.match_types),
    freshness: kbFreshness(r.freshness)
  }
}
function mapKbUsageQuery(r: KbUsageQueryRow, sections: KbUsageSectionRef[]): KbUsageQuery {
  return {
    id: r.id, seq: r.seq, conversationId: r.conversation_id, projectId: r.project_id, turnId: r.turn_id,
    messageId: r.message_id, source: kbSource(r.source), status: kbStatus(r.status), query: r.query,
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

// ======================= CI-раннер: строки БД и мапперы =======================

interface CiCommandRow {
  id: string; scope: string; project_id: string | null; name: string; script: string
  description: string; workdir: string; timeout_sec: number | null; env_json: string
  allow_failure: number; is_cleanup: number; available_to_model: number; version: number
  created_by: string; created_at: number; updated_at: number; deleted_at: number | null
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
function parseSlotProgress(j: string): CiSlotProgress {
  try {
    const o = JSON.parse(j) as Partial<CiSlotProgress>
    return { done: Number(o.done ?? 0), total: Number(o.total ?? 0), phase: String(o.phase ?? ''), fixing: o.fixing === true }
  } catch {
    return { done: 0, total: 0, phase: '' }
  }
}

interface CiRunRow {
  id: string; project_id: string; task_id: string; agent_id: string | null; status: string
  workspace_id: string | null; triggered_by: string; prev_column_id: string | null
  llm_provider: string; llm_model: string
  mode: string | null; clarify_level: string | null; clarify_max: number | null
  conversation_id: string | null
  slot_progress_json: string; started_at: number | null; finished_at: number | null
  duration_ms: number | null; created_at: number
}
function mapCiRun(r: CiRunRow): CiRun {
  return {
    id: r.id, projectId: r.project_id, taskId: r.task_id, agentId: r.agent_id,
    status: normCiStatus(r.status), workspaceId: r.workspace_id, triggeredBy: r.triggered_by,
    prevColumnId: r.prev_column_id, llmProvider: r.llm_provider === 'codex' ? 'codex' : 'claude', llmModel: r.llm_provider === 'codex' ? (r.llm_model ?? '') : (r.llm_model || 'sonnet'),
    mode: normRunMode(r.mode), clarifyLevel: normClarifyLevel(r.clarify_level), clarifyMax: clampClarifyMax(r.clarify_max),
    conversationId: r.conversation_id, slotProgress: parseSlotProgress(r.slot_progress_json),
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
  result: string; diff: string | null; duration_ms: number | null; tokens_used: number | null; created_at: number
}
function mapCiFix(r: CiFixRow): CiFixAttempt {
  return {
    id: r.id, runStepId: r.run_step_id, attemptNo: r.attempt_no, diagnosis: r.diagnosis, action: r.action,
    result: r.result === 'fixed' || r.result === 'gave_up' ? r.result : 'retrying',
    diff: r.diff, durationMs: r.duration_ms, tokensUsed: r.tokens_used, createdAt: r.created_at
  }
}

interface CiWorkspaceRow {
  id: string; project_id: string; task_id: string; agent_id: string | null; path: string
  state: string; size_bytes: number | null; created_at: number; released_by_step_id: string | null
}
function mapCiWorkspace(r: CiWorkspaceRow): CiWorkspace {
  return {
    id: r.id, projectId: r.project_id, taskId: r.task_id, agentId: r.agent_id, path: r.path,
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

import Database from 'better-sqlite3'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { SCHEMA_SQL } from './schema'
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

  type FeatureRun,
  type FeatureStatus,
  type AgentTask,
  type RepositorySlot,
  type FeatureDeployment,
  canTransitionFeature,
  featureColumnSemantic,
  type CiCommand,
  type CiCommandInput,
  type CiCommandScope,
  type CiSlot,
  type CiSlotConfig,
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

/** Шаг дробного ранга для порядка колонок/задач. */
const RANK_STEP = 1024
/** Порог схлопывания дробного ранга — ниже него колонка ренормализуется. */
const RANK_EPS = 1e-6

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

interface RepositorySlotRow {
  id: string
  project_id: string
  agent_id: string
  path: string
  status: string
  feature_id: string | null
  current_branch: string | null
  reserved_at: number | null
  heartbeat_at: number | null
  block_reason: string | null
  last_error: string | null
}

interface FeatureRow {
  id: string
  project_id: string
  source_task_id: string
  attempt: number
  previous_feature_id: string | null
  conversation_id: string | null
  repository_slot_id: string | null
  title: string
  description: string
  status: string
  deploy_status: string
  base_branch: string
  feature_branch: string
  base_commit_sha: string | null
  tested_commit_sha: string | null
  merged_commit_sha: string | null
  commit_policy: string
  merge_transport: string
  agent_plan_approval_mode: string
  auto_merge: number
  auto_deploy_production: number
  created_at: number
  updated_at: number
  completed_at: number | null
  last_error: string | null
  version: number
}

interface FeatureDeploymentRow {
  id: string
  feature_id: string
  requested_main_sha: string
  deployed_main_sha: string | null
  trigger: string
  status: string
  created_at: number
  started_at: number | null
  finished_at: number | null
  error: string | null
}

interface AgentTaskRow {
  id: string
  feature_id: string
  title: string
  description: string
  kind: string
  status: string
  created_by: string
  depends_on: string
  attempt: number
  result_summary: string | null
  error: string | null
  created_at: number
  started_at: number | null
  finished_at: number | null
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
    seq: r.seq ?? 0,
    position: r.position,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    chatId: r.chat_id ?? null
  }
}


function mapRepositorySlot(r: RepositorySlotRow): RepositorySlot {
  const statuses = new Set(['available', 'reserved', 'busy', 'cleaning', 'blocked', 'repair_required', 'disabled'])
  return { id: r.id, projectId: r.project_id, agentId: r.agent_id, path: r.path,
    status: (statuses.has(r.status) ? r.status : 'repair_required') as RepositorySlot['status'],
    featureId: r.feature_id, currentBranch: r.current_branch, reservedAt: r.reserved_at,
    heartbeatAt: r.heartbeat_at, blockReason: r.block_reason, lastError: r.last_error }
}

const FEATURE_STATUSES = new Set<FeatureStatus>(['preparing', 'planning', 'awaiting_plan_approval', 'development', 'awaiting_commit', 'testing', 'awaiting_merge', 'merging', 'completed', 'failed', 'cancelled'])
function mapFeature(r: FeatureRow): FeatureRun {
  return {
    id: r.id, projectId: r.project_id, sourceTaskId: r.source_task_id, attempt: r.attempt,
    previousFeatureId: r.previous_feature_id, conversationId: r.conversation_id,
    repositorySlotId: r.repository_slot_id, title: r.title, description: r.description,
    status: FEATURE_STATUSES.has(r.status as FeatureStatus) ? r.status as FeatureStatus : 'failed',
    deployStatus: r.deploy_status === 'awaiting_confirmation' || r.deploy_status === 'queued' || r.deploy_status === 'deploying' || r.deploy_status === 'succeeded' || r.deploy_status === 'failed' ? r.deploy_status : 'not_requested',
    baseBranch: r.base_branch, featureBranch: r.feature_branch, baseCommitSha: r.base_commit_sha,
    testedCommitSha: r.tested_commit_sha, mergedCommitSha: r.merged_commit_sha,
    commitPolicy: r.commit_policy === 'final_system_commit' || r.commit_policy === 'manual_user_confirmation' ? r.commit_policy : 'agent_commits',
    mergeTransport: r.merge_transport === 'github_pull_request' ? 'github_pull_request' : 'local',
    agentPlanApprovalMode: r.agent_plan_approval_mode === 'automatic' ? 'automatic' : 'manual',
    autoMerge: r.auto_merge !== 0, autoDeployProduction: r.auto_deploy_production !== 0,
    createdAt: r.created_at, updatedAt: r.updated_at, completedAt: r.completed_at,
    lastError: r.last_error, version: r.version
  }
}

function mapDeployment(r: FeatureDeploymentRow): FeatureDeployment {
  const statuses = new Set(['queued', 'running', 'succeeded', 'failed', 'cancelled'])
  return { id: r.id, featureId: r.feature_id, requestedMainSha: r.requested_main_sha,
    deployedMainSha: r.deployed_main_sha, trigger: r.trigger === 'automatic' ? 'automatic' : 'manual',
    status: (statuses.has(r.status) ? r.status : 'failed') as FeatureDeployment['status'], createdAt: r.created_at,
    startedAt: r.started_at, finishedAt: r.finished_at, error: r.error }
}

function mapAgentTask(r: AgentTaskRow): AgentTask {
  const kinds = new Set(['research', 'implementation', 'test', 'bugfix', 'review', 'documentation', 'git', 'custom'])
  const statuses = new Set(['planned', 'ready', 'running', 'blocked', 'succeeded', 'failed', 'cancelled'])
  return {
    id: r.id, featureId: r.feature_id, title: r.title, description: r.description,
    kind: (kinds.has(r.kind) ? r.kind : 'custom') as AgentTask['kind'],
    status: (statuses.has(r.status) ? r.status : 'failed') as AgentTask['status'],
    createdBy: (r.created_by === 'agent' || r.created_by === 'system' ? r.created_by : 'user'),
    dependsOn: parseStringArray(r.depends_on), attempt: r.attempt, resultSummary: r.result_summary,
    error: r.error, createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at
  }
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
    if (pmCols.length && !pmCols.some((c) => c.name === 'feature_repos_root')) this.db.exec(`ALTER TABLE project_machines ADD COLUMN feature_repos_root TEXT NOT NULL DEFAULT ''`)
    const taskCols = this.db.prepare(`PRAGMA table_info(tasks)`).all() as Array<{ name: string }>
    if (taskCols.length && !taskCols.some((c) => c.name === 'type')) this.db.exec(`ALTER TABLE tasks ADD COLUMN type TEXT NOT NULL DEFAULT 'task'`)
    if (taskCols.length && !taskCols.some((c) => c.name === 'parent_id')) this.db.exec(`ALTER TABLE tasks ADD COLUMN parent_id TEXT`)
    if (taskCols.length && !taskCols.some((c) => c.name === 'acceptance_criteria')) this.db.exec(`ALTER TABLE tasks ADD COLUMN acceptance_criteria TEXT NOT NULL DEFAULT ''`)
    if (taskCols.length && !taskCols.some((c) => c.name === 'labels')) this.db.exec(`ALTER TABLE tasks ADD COLUMN labels TEXT NOT NULL DEFAULT '[]'`)
    if (taskCols.length && !taskCols.some((c) => c.name === 'skills')) this.db.exec(`ALTER TABLE tasks ADD COLUMN skills TEXT NOT NULL DEFAULT '[]'`)

    if (taskCols.length && !taskCols.some((c) => c.name === 'story_points')) this.db.exec(`ALTER TABLE tasks ADD COLUMN story_points REAL`)
    if (taskCols.length && !taskCols.some((c) => c.name === 'due_date')) this.db.exec(`ALTER TABLE tasks ADD COLUMN due_date INTEGER`)
    if (taskCols.length && !taskCols.some((c) => c.name === 'flagged')) this.db.exec(`ALTER TABLE tasks ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0`)
    if (taskCols.length && !taskCols.some((c) => c.name === 'seq')) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN seq INTEGER`)
      // Номер по порядку создания в проекте — как ключи PRJ-1, PRJ-2 в Jira.
      this.db.exec(`UPDATE tasks SET seq = (
        SELECT COUNT(*) FROM tasks t2
        WHERE t2.project_id = tasks.project_id
          AND (t2.created_at < tasks.created_at OR (t2.created_at = tasks.created_at AND t2.id <= tasks.id))
      ) WHERE seq IS NULL`)
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
    const ciRunCols = this.db.prepare(`PRAGMA table_info(ci_runs)`).all() as Array<{ name: string }>
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'llm_provider')) this.db.exec(`ALTER TABLE ci_runs ADD COLUMN llm_provider TEXT NOT NULL DEFAULT 'claude'`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'llm_model')) this.db.exec(`ALTER TABLE ci_runs ADD COLUMN llm_model TEXT NOT NULL DEFAULT 'sonnet'`)

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

  listConversations(userId: string): Conversation[] {
    const rows = this.db
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
                (SELECT m.exec_target FROM messages m WHERE m.conversation_id = c.id
                 ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_exec_target
         FROM conversations c
         WHERE c.user_id = ?
         ORDER BY c.updated_at DESC`
      )
      .all(userId) as Array<ConversationRow & { message_count: number }>
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

  /** Поиск по названию разговора и тексту его сообщений (регистронезависимо). */
  searchConversations(userId: string, query: string): Conversation[] {
    const q = query.trim()
    if (!q) return this.listConversations(userId)
    const like = `%${q.toLowerCase().replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`
    const rows = this.db
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
                (SELECT m.exec_target FROM messages m WHERE m.conversation_id = c.id
                 ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_exec_target
         FROM conversations c
         WHERE c.user_id = ?
           AND (ulower(c.title) LIKE ? ESCAPE '\\'
            OR EXISTS (SELECT 1 FROM messages m
                       WHERE m.conversation_id = c.id AND ulower(m.text) LIKE ? ESCAPE '\\'))
         ORDER BY c.updated_at DESC`
      )
      .all(userId, like, like) as Array<ConversationRow & { message_count: number }>
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
    const activeFeature = this.db.prepare(
      `SELECT f.id FROM features f
       JOIN conversations c ON c.id = f.conversation_id
       WHERE c.id = ? AND c.user_id = ?
         AND f.status NOT IN ('completed', 'cancelled', 'failed')
       LIMIT 1`
    ).get(id, userId) as { id: string } | undefined
    if (activeFeature) {
      throw new Error('Этот чат связан с активной Feature. Сначала завершите или отмените Feature')
    }
    // ON DELETE CASCADE удалит сообщения и спикеров; завершённая Feature сохранится с conversation_id=NULL.
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
      ciExecAuthRef: r.ci_exec_auth_ref
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
      this.db.prepare(`SELECT agent_id, path, feature_repos_root FROM project_machines WHERE project_id = ? ORDER BY agent_id ASC`).all(id) as Array<{
        agent_id: string
        path: string | null
        feature_repos_root: string | null
      }>
    ).map((x) => ({ agentId: x.agent_id, path: x.path ?? '', featureReposRoot: x.feature_repos_root ?? '' }))
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

  /** Задать корень пула Feature Run на конкретной машине. */
  setProjectMachineFeatureReposRoot(userId: string, id: string, agentId: string, root: string): ProjectDetail | null {
    if (!this.isProjectOwner(userId, id)) return null
    this.db.prepare(`UPDATE project_machines SET feature_repos_root = ? WHERE project_id = ? AND agent_id = ?`).run(root, id, agentId)
    this.touchProject(id)
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
    const title = task.title.trim() || 'Задача'
    this.db
      .prepare(
        `INSERT INTO conversations (id, title, created_at, updated_at, claude_session_id, user_id, exec_target, workdir, skill_names, project_id, task_id)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, title, ts, ts, userId, defAgent, workdir, JSON.stringify(task.skills), projectId, taskId)
    return this.getConversation(userId, id)
  }

  // ---- Board (колонки + задачи) -----------------------------------------


  getBoard(userId: string, projectId: string): Board | null {
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

    const features = (this.db.prepare(`SELECT * FROM features WHERE project_id = ? ORDER BY created_at DESC`).all(projectId) as FeatureRow[]).map((r) => {
      const f = mapFeature(r)
      return { id: f.id, sourceTaskId: f.sourceTaskId, attempt: f.attempt, status: f.status, deployStatus: f.deployStatus, featureBranch: f.featureBranch, agentActive: false }
    })
    return { columns, tasks, features, ciRuns: this.latestCiRunSummaries(projectId) }
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
    const seq = (
      this.db.prepare(`UPDATE projects SET task_seq = task_seq + 1 WHERE id = ? RETURNING task_seq`).get(projectId) as { task_seq: number }
    ).task_seq
    this.db
      .prepare(
        `INSERT INTO tasks (id, project_id, column_id, title, description, acceptance_criteria, type, parent_id, priority, assignee, labels, skills, story_points, due_date, flagged, seq, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
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
      this.db
        .prepare(`UPDATE tasks SET column_id = ?, position = ?, updated_at = ? WHERE id = ? AND project_id = ?`)
        .run(args.columnId, pos, ts, taskId, projectId)
    })()
    this.touchProject(projectId, ts)
    return this.getTask(projectId, taskId)
  }

  deleteTask(userId: string, projectId: string, taskId: string): boolean {
    if (!this.isProjectMember(userId, projectId)) return false
    let changes = 0
    this.db.transaction(() => {
      // features.source_task_id -> tasks(id) идёт с ON DELETE RESTRICT, поэтому
      // задачу с историей Feature Run иначе не удалить (FK constraint failed).
      // Сначала освобождаем занятые фичами рабочие копии и сносим сами фичи
      // (каскад чистит agent_tasks / deployments / events), затем — задачу.
      const featIds = (
        this.db.prepare(`SELECT id FROM features WHERE source_task_id = ?`).all(taskId) as Array<{ id: string }>
      ).map((r) => r.id)
      if (featIds.length) {
        const ph = featIds.map(() => '?').join(',')
        this.db
          .prepare(`UPDATE repository_slots SET status = 'available' WHERE status != 'available' AND feature_id IN (${ph})`)
          .run(...featIds)
        this.db.prepare(`DELETE FROM features WHERE id IN (${ph})`).run(...featIds)
      }
      changes = this.db.prepare(`DELETE FROM tasks WHERE id = ? AND project_id = ?`).run(taskId, projectId).changes
    })()
    if (changes) this.touchProject(projectId)
    return changes > 0
  }

  reserveRepositorySlot(userId: string, featureId: string): RepositorySlot | null {
    const feature = this.getFeature(userId, featureId)
    if (!feature) return null
    const project = this.getProject(userId, feature.projectId)
    if (!project?.defaultAgentId) throw new Error('У проекта не задана машина по умолчанию')
    const machine = project.machines.find((m) => m.agentId === project.defaultAgentId)
    if (!machine?.featureReposRoot) throw new Error('У машины проекта не задан корень репозиториев Feature Run')
    const ts = this.now()
    let slot!: RepositorySlot
    this.db.transaction(() => {
      const free = this.db.prepare(`SELECT * FROM repository_slots WHERE project_id = ? AND agent_id = ? AND status = 'available' ORDER BY heartbeat_at DESC, id LIMIT 1`).get(feature.projectId, project.defaultAgentId) as RepositorySlotRow | undefined
      if (free) {
        const info = this.db.prepare(`UPDATE repository_slots SET status = 'reserved', feature_id = ?, reserved_at = ?, heartbeat_at = ? WHERE id = ? AND status = 'available'`).run(featureId, ts, ts, free.id)
        if (info.changes !== 1) throw new Error('Рабочая копия уже занята')
        slot = mapRepositorySlot({ ...free, status: 'reserved', feature_id: featureId, reserved_at: ts, heartbeat_at: ts })
      } else {
        const id = this.newId()
        const safeProject = project.name.toLowerCase().replace(/[^a-zа-яё0-9]+/giu, '-').replace(/^-|-$/g, '').slice(0, 32) || 'project'
        const path = `${machine.featureReposRoot.replace(/\/$/, '')}/${safeProject}-${id.slice(0, 8)}`
        this.db.prepare(`INSERT INTO repository_slots (id, project_id, agent_id, path, status, feature_id, reserved_at, heartbeat_at) VALUES (?, ?, ?, ?, 'reserved', ?, ?, ?)`).run(id, feature.projectId, project.defaultAgentId, path, featureId, ts, ts)
        slot = { id, projectId: feature.projectId, agentId: project.defaultAgentId!, path, status: 'reserved', featureId, currentBranch: null, reservedAt: ts, heartbeatAt: ts, blockReason: null, lastError: null }
      }
      this.db.prepare(`UPDATE features SET repository_slot_id = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(slot.id, ts, featureId)
      this.db.prepare(`UPDATE conversations SET exec_target = ?, workdir = ? WHERE id = ?`).run(slot.agentId, slot.path, feature.conversationId)
    })()
    return slot
  }

  setRepositorySlotState(featureId: string, status: RepositorySlot['status'], fields: { branch?: string | null; error?: string | null; blockReason?: string | null } = {}): RepositorySlot | null {
    const ts = this.now()
    this.db.prepare(`UPDATE repository_slots SET status = ?, current_branch = COALESCE(?, current_branch), last_error = ?, block_reason = ?, heartbeat_at = ? WHERE feature_id = ?`).run(status, fields.branch ?? null, fields.error ?? null, fields.blockReason ?? null, ts, featureId)
    const row = this.db.prepare(`SELECT * FROM repository_slots WHERE feature_id = ?`).get(featureId) as RepositorySlotRow | undefined
    return row ? mapRepositorySlot(row) : null
  }

  getRepositorySlotForFeature(userId: string, featureId: string): RepositorySlot | null {
    if (!this.getFeature(userId, featureId)) return null
    const row = this.db.prepare(`SELECT s.* FROM repository_slots s JOIN features f ON f.repository_slot_id = s.id WHERE f.id = ?`).get(featureId) as RepositorySlotRow | undefined
    return row ? mapRepositorySlot(row) : null
  }

  setFeatureTestedCommit(userId: string, featureId: string, sha: string): FeatureRun | null {
    if (!this.getFeature(userId, featureId)) return null
    this.db.prepare(`UPDATE features SET tested_commit_sha = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(sha, this.now(), featureId)
    return this.getFeature(userId, featureId)
  }

  setFeatureMergedCommit(userId: string, featureId: string, sha: string): FeatureRun | null {
    if (!this.getFeature(userId, featureId)) return null
    this.db.prepare(`UPDATE features SET merged_commit_sha = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(sha, this.now(), featureId)
    return this.getFeature(userId, featureId)
  }

  createFeatureDeployment(userId: string, featureId: string, requestedMainSha: string, trigger: FeatureDeployment['trigger']): FeatureDeployment | null {
    if (!this.getFeature(userId, featureId)) return null
    const id = this.newId(), ts = this.now()
    this.db.prepare(`INSERT INTO feature_deployments (id, feature_id, requested_main_sha, trigger, status, created_at) VALUES (?, ?, ?, ?, 'queued', ?)`).run(id, featureId, requestedMainSha, trigger, ts)
    return mapDeployment(this.db.prepare(`SELECT * FROM feature_deployments WHERE id = ?`).get(id) as FeatureDeploymentRow)
  }

  updateFeatureDeployment(id: string, status: FeatureDeployment['status'], fields: { deployedMainSha?: string; error?: string } = {}): void {
    const ts = this.now()
    this.db.prepare(`UPDATE feature_deployments SET status = ?, deployed_main_sha = COALESCE(?, deployed_main_sha), error = ?, started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, ?) ELSE started_at END, finished_at = CASE WHEN ? IN ('succeeded','failed','cancelled') THEN ? ELSE finished_at END WHERE id = ?`).run(status, fields.deployedMainSha ?? null, fields.error ?? null, status, ts, status, ts, id)
  }

  listFeatureDeployments(userId: string, featureId: string): FeatureDeployment[] | null {
    if (!this.getFeature(userId, featureId)) return null
    return (this.db.prepare(`SELECT * FROM feature_deployments WHERE feature_id = ? ORDER BY created_at DESC`).all(featureId) as FeatureDeploymentRow[]).map(mapDeployment)
  }

  setFeatureDeployStatus(userId: string, featureId: string, status: FeatureRun['deployStatus'], error?: string): FeatureRun | null {
    if (!this.getFeature(userId, featureId)) return null
    this.db.prepare(`UPDATE features SET deploy_status = ?, last_error = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(status, error ?? null, this.now(), featureId)
    return this.getFeature(userId, featureId)
  }

  setFeatureBaseCommit(userId: string, featureId: string, sha: string): FeatureRun | null {
    if (!this.getFeature(userId, featureId)) return null
    this.db.prepare(`UPDATE features SET base_commit_sha = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(sha, this.now(), featureId)
    return this.getFeature(userId, featureId)
  }

  failFeature(userId: string, featureId: string, error: string): FeatureRun | null {
    const feature = this.getFeature(userId, featureId)
    if (!feature || feature.status === 'completed' || feature.status === 'cancelled') return feature
    const ts = this.now()
    this.db.transaction(() => {
      this.db.prepare(`UPDATE features SET status = 'failed', last_error = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(error, ts, featureId)
      const ready = this.db.prepare(`SELECT id FROM kanban_columns WHERE project_id = ? AND semantic_type = 'ready' LIMIT 1`).get(feature.projectId) as { id: string } | undefined
      if (ready) this.db.prepare(`UPDATE tasks SET column_id = ?, updated_at = ? WHERE id = ?`).run(ready.id, ts, feature.sourceTaskId)
      this.syncWorkItemAncestors(feature.projectId, feature.sourceTaskId, ts)
      this.db.prepare(`INSERT INTO feature_events (id, feature_id, type, actor_type, actor_id, payload, created_at) VALUES (?, ?, 'failed', 'system', NULL, ?, ?)`).run(this.newId(), featureId, JSON.stringify({ error }), ts)
      this.touchProject(feature.projectId, ts)
    })()
    return this.getFeature(userId, featureId)
  }

  /** Jira-подобный агрегат: первый активный ребёнок двигает родителя в development, все готовые — в done. */
  private syncWorkItemAncestors(projectId: string, taskId: string, ts: number): void {
    let current = this.getTask(projectId, taskId)
    while (current?.parentId) {
      const parent = this.getTask(projectId, current.parentId)
      if (!parent) break
      const children = this.db.prepare(`SELECT c.semantic_type FROM tasks t JOIN kanban_columns c ON c.id = t.column_id WHERE t.parent_id = ?`).all(parent.id) as Array<{ semantic_type: string }>
      const target = children.length > 0 && children.every((c) => c.semantic_type === 'done')
        ? 'done'
        : children.some((c) => c.semantic_type === 'development' || c.semantic_type === 'testing' || c.semantic_type === 'awaiting_merge')
          ? 'development'
          : null
      if (target) {
        const column = this.db.prepare(`SELECT id FROM kanban_columns WHERE project_id = ? AND semantic_type = ? LIMIT 1`).get(projectId, target) as { id: string } | undefined
        if (column) this.db.prepare(`UPDATE tasks SET column_id = ?, updated_at = ? WHERE id = ?`).run(column.id, ts, parent.id)
      }
      current = parent
    }
  }

  // ---- Feature workflow -------------------------------------------------

  listFeatures(userId: string, projectId: string): FeatureRun[] | null {
    if (!this.isProjectMember(userId, projectId)) return null
    return (this.db.prepare(`SELECT * FROM features WHERE project_id = ? ORDER BY created_at DESC`).all(projectId) as FeatureRow[]).map(mapFeature)
  }

  getFeature(userId: string, featureId: string): FeatureRun | null {
    const row = this.db.prepare(`SELECT f.* FROM features f JOIN project_members m ON m.project_id = f.project_id WHERE f.id = ? AND m.username = ?`).get(featureId, userId) as FeatureRow | undefined
    return row ? mapFeature(row) : null
  }

  createFeatureFromTask(userId: string, projectId: string, taskId: string, args: { autoMerge?: boolean; autoDeployProduction?: boolean }): FeatureRun | null {
    if (!this.isProjectMember(userId, projectId)) return null
    const task = this.getTask(projectId, taskId)
    if (!task || task.type !== 'task') return null
    const project = this.getProject(userId, projectId)
    if (!project) return null
    const active = this.db.prepare(`SELECT 1 FROM features WHERE source_task_id = ? AND status NOT IN ('completed','cancelled','failed')`).get(taskId)
    if (active) throw new Error('У задачи уже есть активная фича')
    const previous = this.db.prepare(`SELECT id, attempt FROM features WHERE source_task_id = ? ORDER BY attempt DESC LIMIT 1`).get(taskId) as { id: string; attempt: number } | undefined
    const id = this.newId()
    const conversationId = this.newId()
    const ts = this.now()
    const attempt = (previous?.attempt ?? 0) + 1
    const slug = task.title.toLowerCase().replace(/[^a-zа-яё0-9]+/giu, '-').replace(/^-|-$/g, '').slice(0, 48) || 'task'
    const branch = `feature/${id}-${slug}`
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO conversations (id, title, created_at, updated_at, claude_session_id, user_id, exec_target, project_id, skill_names, permission_mode) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`).run(conversationId, task.title, ts, ts, userId, project.defaultAgentId, projectId, JSON.stringify(project.skills), project.agentPlanApprovalMode === 'automatic' ? 'acceptEdits' : 'plan')
      const initialPrompt = [
        'Начни выполнение задачи и веди весь процесс в этом чате: сообщай план, текущий прогресс, результаты проверок и возникающие проблемы.',
        `Название: ${task.title}`,
        `Описание: ${task.description || 'не указано'}`,
        `Критерии приёмки: ${task.acceptanceCriteria || 'не указаны'}`,
        project.agentPlanApprovalMode === 'manual' ? 'Сначала составь план и дождись подтверждения перед изменением файлов.' : 'Приступай к реализации сразу после проверки рабочего окружения.'
      ].join('\n\n')
      this.db.prepare(`INSERT INTO messages (id, conversation_id, role, text, time, created_at) VALUES (?, ?, 'u1', ?, ?, ?)`).run(this.newId(), conversationId, initialPrompt, new Date(ts).toISOString().slice(11, 16), ts)
      this.db.prepare(`INSERT INTO features (id, project_id, source_task_id, attempt, previous_feature_id, conversation_id, title, description, status, feature_branch, commit_policy, merge_transport, agent_plan_approval_mode, auto_merge, auto_deploy_production, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'preparing', ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, projectId, taskId, attempt, previous?.id ?? null, conversationId, task.title, task.description, branch, project.commitPolicy, project.mergeTransport, project.agentPlanApprovalMode, args.autoMerge ? 1 : 0, args.autoDeployProduction ? 1 : 0, ts, ts)
      const development = this.db.prepare(`SELECT id FROM kanban_columns WHERE project_id = ? AND semantic_type = 'development' LIMIT 1`).get(projectId) as { id: string } | undefined
      if (development) this.db.prepare(`UPDATE tasks SET column_id = ?, updated_at = ? WHERE id = ?`).run(development.id, ts, taskId)
      this.syncWorkItemAncestors(projectId, taskId, ts)
      this.db.prepare(`INSERT INTO feature_events (id, feature_id, type, actor_type, actor_id, payload, created_at) VALUES (?, ?, 'created', 'user', ?, '{}', ?)`).run(this.newId(), id, userId, ts)
      this.touchProject(projectId, ts)
    })()
    return this.getFeature(userId, id)
  }

  /** Story без дочерней Task получает Task и Feature в одной транзакционной операции. */
  createFeatureFromStory(userId: string, projectId: string, storyId: string, args: { autoMerge?: boolean; autoDeployProduction?: boolean }): FeatureRun | null {
    const story = this.getTask(projectId, storyId)
    if (!story || story.type !== 'story' || !this.isProjectMember(userId, projectId)) return null
    const ready = this.db.prepare(`SELECT id FROM kanban_columns WHERE project_id = ? AND semantic_type = 'ready' LIMIT 1`).get(projectId) as { id: string } | undefined
    if (!ready) throw new Error('В проекте нет колонки «Готово к разработке»')
    let result: FeatureRun | null = null
    this.db.transaction(() => {
      const task = this.createTask(userId, projectId, { columnId: ready.id, title: `Реализовать: ${story.title}`, description: story.description, acceptanceCriteria: story.acceptanceCriteria, type: 'task', parentId: story.id, priority: story.priority, assignee: story.assignee })
      if (!task) throw new Error('Не удалось создать дочернюю задачу')
      result = this.createFeatureFromTask(userId, projectId, task.id, args)
      if (!result) throw new Error('Не удалось создать Feature Run')
    })()
    return result
  }

  transitionFeature(userId: string, featureId: string, to: FeatureStatus, expectedVersion?: number): FeatureRun | null {
    const current = this.getFeature(userId, featureId)
    if (!current) return null
    if (!canTransitionFeature(current.status, to)) throw new Error(`Недопустимый переход ${current.status} → ${to}`)
    if (expectedVersion !== undefined && expectedVersion !== current.version) throw new Error('Фича уже была изменена')
    const ts = this.now()
    this.db.transaction(() => {
      const info = this.db.prepare(`UPDATE features SET status = ?, updated_at = ?, completed_at = ?, version = version + 1 WHERE id = ? AND version = ?`).run(to, ts, to === 'completed' ? ts : current.completedAt, featureId, current.version)
      if (info.changes !== 1) throw new Error('Фича уже была изменена')
      const semantic = featureColumnSemantic(to)
      const column = this.db.prepare(`SELECT id FROM kanban_columns WHERE project_id = ? AND semantic_type = ? LIMIT 1`).get(current.projectId, semantic) as { id: string } | undefined
      if (column) this.db.prepare(`UPDATE tasks SET column_id = ?, updated_at = ? WHERE id = ?`).run(column.id, ts, current.sourceTaskId)
      if (to === 'development') this.db.prepare(`UPDATE conversations SET permission_mode = 'acceptEdits', updated_at = ? WHERE id = ?`).run(ts, current.conversationId)
      this.syncWorkItemAncestors(current.projectId, current.sourceTaskId, ts)
      this.db.prepare(`INSERT INTO feature_events (id, feature_id, type, actor_type, actor_id, payload, created_at) VALUES (?, ?, 'status_changed', 'user', ?, ?, ?)`).run(this.newId(), featureId, userId, JSON.stringify({ from: current.status, to }), ts)
      this.touchProject(current.projectId, ts)
    })()
    return this.getFeature(userId, featureId)
  }

  updateFeatureAutomation(userId: string, featureId: string, fields: { autoMerge?: boolean; autoDeployProduction?: boolean }): FeatureRun | null {
    const feature = this.getFeature(userId, featureId)
    if (!feature) return null
    this.db.prepare(`UPDATE features SET auto_merge = ?, auto_deploy_production = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(fields.autoMerge ?? feature.autoMerge ? 1 : 0, fields.autoDeployProduction ?? feature.autoDeployProduction ? 1 : 0, this.now(), featureId)
    return this.getFeature(userId, featureId)
  }

  listAgentTasks(userId: string, featureId: string): AgentTask[] | null {
    if (!this.getFeature(userId, featureId)) return null
    return (this.db.prepare(`SELECT * FROM agent_tasks WHERE feature_id = ? ORDER BY created_at, id`).all(featureId) as AgentTaskRow[]).map(mapAgentTask)
  }

  createAgentTask(userId: string, featureId: string, args: { title: string; description?: string; kind?: AgentTask['kind']; createdBy?: AgentTask['createdBy']; dependsOn?: string[] }): AgentTask | null {
    if (!this.getFeature(userId, featureId)) return null
    const id = this.newId(), ts = this.now()
    this.db.prepare(`INSERT INTO agent_tasks (id, feature_id, title, description, kind, status, created_by, depends_on, created_at) VALUES (?, ?, ?, ?, ?, 'planned', ?, ?, ?)`).run(id, featureId, args.title, args.description ?? '', args.kind ?? 'custom', args.createdBy ?? 'user', JSON.stringify(args.dependsOn ?? []), ts)
    const row = this.db.prepare(`SELECT * FROM agent_tasks WHERE id = ?`).get(id) as AgentTaskRow
    return mapAgentTask(row)
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
      .filter((r) => (r.scope === 'global' ? true : projectId ? r.project_id === projectId && this.isProjectMember(userId, projectId) : false))
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

  /** Публичный доступ к задаче для CI-раннера (по членству проекта). */
  getCiTask(userId: string, projectId: string, taskId: string): Task | null {
    if (!this.isProjectMember(userId, projectId)) return null
    return this.getTask(projectId, taskId)
  }

  // --- Глобальные настройки CI ---

  getCiSettings(): CiGlobalSettings {
    const r = this.db.prepare(`SELECT * FROM ci_settings WHERE id = 1`).get() as Record<string, number> | undefined
    if (!r) {
      const d = DEFAULT_CI_GLOBAL_SETTINGS
      this.db.prepare(`INSERT INTO ci_settings (id, max_fix_attempts, fix_time_limit_ms, fix_token_limit, default_step_timeout_sec, metrics_window, max_concurrent_runs, max_model_command_calls) VALUES (1, ?, ?, ?, ?, ?, ?, ?)`).run(d.maxFixAttempts, d.fixTimeLimitMs, d.fixTokenLimit, d.defaultStepTimeoutSec, d.metricsWindow, d.maxConcurrentRuns, d.maxModelCommandCalls)
      return { ...d }
    }
    return {
      maxFixAttempts: r.max_fix_attempts, fixTimeLimitMs: r.fix_time_limit_ms, fixTokenLimit: r.fix_token_limit,
      defaultStepTimeoutSec: r.default_step_timeout_sec, metricsWindow: r.metrics_window,
      maxConcurrentRuns: r.max_concurrent_runs, maxModelCommandCalls: r.max_model_command_calls
    }
  }

  updateCiSettings(patch: Partial<CiGlobalSettings>): CiGlobalSettings {
    const cur = this.getCiSettings()
    const next = { ...cur, ...patch }
    this.db.prepare(`UPDATE ci_settings SET max_fix_attempts=?, fix_time_limit_ms=?, fix_token_limit=?, default_step_timeout_sec=?, metrics_window=?, max_concurrent_runs=?, max_model_command_calls=? WHERE id=1`).run(next.maxFixAttempts, next.fixTimeLimitMs, next.fixTokenLimit, next.defaultStepTimeoutSec, next.metricsWindow, next.maxConcurrentRuns, next.maxModelCommandCalls)
    return next
  }

  // --- Раны и шаги ---

  createCiRun(args: { projectId: string; taskId: string; agentId: string | null; triggeredBy: string; prevColumnId: string | null; slotProgress: CiSlotProgress; llmProvider?: 'claude' | 'codex'; llmModel?: string }): CiRun {
    const id = this.newId()
    const ts = this.now()
    this.db.prepare(`INSERT INTO ci_runs (id, project_id, task_id, agent_id, status, triggered_by, prev_column_id, llm_provider, llm_model, slot_progress_json, created_at) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)`).run(id, args.projectId, args.taskId, args.agentId, args.triggeredBy, args.prevColumnId, args.llmProvider ?? 'claude', args.llmModel ?? 'sonnet', JSON.stringify(args.slotProgress), ts)
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
    return { run, steps, fixAttempts }
  }

  listCiRunsForTask(userId: string, projectId: string, taskId: string): CiRun[] {
    if (!this.isProjectMember(userId, projectId)) return []
    return (this.db.prepare(`SELECT * FROM ci_runs WHERE task_id = ? ORDER BY created_at DESC`).all(taskId) as CiRunRow[]).map(mapCiRun)
  }

  updateCiRun(runId: string, patch: { status?: CiStatus; workspaceId?: string | null; startedAt?: number; finishedAt?: number; durationMs?: number; slotProgress?: CiSlotProgress; llmProvider?: 'claude' | 'codex'; llmModel?: string }): CiRun | null {
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
    if (!set.length) return this.getCiRunRaw(runId)
    this.db.prepare(`UPDATE ci_runs SET ${set.join(', ')} WHERE id = ?`).run(...vals, runId)
    return this.getCiRunRaw(runId)
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
      const run = mapCiRun(r)
      const modelActive = run.status === 'running' && this.db.prepare(`SELECT 1 FROM ci_run_steps WHERE run_id = ? AND kind = 'model_work' AND status = 'running' LIMIT 1`).get(r.id) !== undefined
      out.push({ id: run.id, taskId: run.taskId, status: run.status, slotProgress: run.slotProgress, durationMs: run.durationMs, modelActive })
    }
    return out
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
  return s === 'running' || s === 'success' || s === 'failed' || s === 'cancelled' || s === 'timeout' || s === 'skipped' ? s : 'queued'
}
function parseSlotProgress(j: string): CiSlotProgress {
  try {
    const o = JSON.parse(j) as Partial<CiSlotProgress>
    return { done: Number(o.done ?? 0), total: Number(o.total ?? 0), phase: String(o.phase ?? '') }
  } catch {
    return { done: 0, total: 0, phase: '' }
  }
}

interface CiRunRow {
  id: string; project_id: string; task_id: string; agent_id: string | null; status: string
  workspace_id: string | null; triggered_by: string; prev_column_id: string | null
  llm_provider: string; llm_model: string
  slot_progress_json: string; started_at: number | null; finished_at: number | null
  duration_ms: number | null; created_at: number
}
function mapCiRun(r: CiRunRow): CiRun {
  return {
    id: r.id, projectId: r.project_id, taskId: r.task_id, agentId: r.agent_id,
    status: normCiStatus(r.status), workspaceId: r.workspace_id, triggeredBy: r.triggered_by,
    prevColumnId: r.prev_column_id, llmProvider: r.llm_provider === 'codex' ? 'codex' : 'claude', llmModel: r.llm_model || (r.llm_provider === 'codex' ? 'gpt-5.3-codex' : 'sonnet'), slotProgress: parseSlotProgress(r.slot_progress_json),
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

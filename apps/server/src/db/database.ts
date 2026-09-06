// Точка входа слоя данных: открывает SQLite, применяет схему и миграции и раздаёт доменные
// репозитории (db.chat, db.tasks, …). Сами запросы живут в ./repos/<домен>.ts — по одному
// владельцу на таблицу (./ownership.ts); правила разреза — docs/plans/db-repositories.md.
import { DEFAULT_PROJECT_TYPE_ID, type KanbanColumnSemanticType, DEFAULT_CI_CLAUDE_MODEL, CI_KB_UPDATE_COMMAND_ID, DEFAULT_DONE_RETENTION_DAYS, DEFAULT_CI_GLOBAL_SETTINGS, isVerificationCommand } from '@voicechat/shared'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { SCHEMA_SQL } from './schema.js'
import { IdentityRepo } from './repos/identity.js'
import { SettingsRepo } from './repos/settings.js'
import { LlmRepo } from './repos/llm.js'
import { ChatRepo } from './repos/chat.js'
import { MachinesRepo } from './repos/machines.js'
import { ProjectsRepo } from './repos/projects.js'
import { TasksRepo } from './repos/tasks.js'
import { CiRepo } from './repos/ci.js'
import { QaRepo } from './repos/qa.js'
import { ReleasesRepo } from './repos/releases.js'
import { KbRepo } from './repos/kb.js'
import type { RepoContext, Repos } from './repos/base.js'
import { TASK_COMMIT_COMMAND_NAME, TASK_COMMIT_COMMAND_SCRIPT, RANK_STEP, type DbDeps } from './repos/support.js'
export { TASK_COMMIT_COMMAND_NAME, TASK_COMMIT_COMMAND_SCRIPT } from './repos/support.js'
export type { DbDeps } from './repos/support.js'
export { LOGIN_LOCK_FAILS, LOGIN_LOCK_MS, LOGIN_HARD_LOCK_FAILS } from './repos/identity.js'
export type { UserRow } from './repos/identity.js'
export { hashAgentToken } from './repos/machines.js'
export type { AgentRecord } from './repos/machines.js'
export { PROD_REBUILD_TASK_TITLE, PROD_REBUILD_TASK_INTRO } from './repos/tasks.js'
export type { MessageSearchOptions } from './repos/chat.js'
export type { KbChatUsage, KbProjectUsage, KbStoredDocument } from './repos/kb.js'
export { projectKbSkeleton } from './repos/projects.js'
export type { CiStageExecutionContext } from './repos/ci.js'
export type { AutomatedQaExecutionContext } from './repos/qa.js'
export type { Repos, RepoContext } from './repos/base.js'

export class VoiceChatDb {
  private readonly db: Database.Database
  private readonly newId: () => string
  private readonly now: () => number
  private readonly ctx: RepoContext
  readonly identity: IdentityRepo
  readonly settings: SettingsRepo
  readonly llm: LlmRepo
  readonly chat: ChatRepo
  readonly machines: MachinesRepo
  readonly projects: ProjectsRepo
  readonly tasks: TasksRepo
  readonly ci: CiRepo
  readonly qa: QaRepo
  readonly releases: ReleasesRepo
  readonly kb: KbRepo
  /** Close-события WebSocket могут прийти после teardown; закрытую БД больше не трогаем. */
  private get closed(): boolean { return this.ctx.closed }
  private set closed(value: boolean) { this.ctx.closed = value }

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

    // Домены делят одно соединение; соседи достижимы через ctx.repos — так кросс-доменные
    // обращения остаются явными (см. ownership.ts и гейт ownership.test.ts).
    this.ctx = { db: this.db, newId: this.newId, now: this.now, closed: false, repos: undefined as unknown as Repos }
    this.ctx.repos = {
      identity: new IdentityRepo(this.ctx),
      settings: new SettingsRepo(this.ctx),
      llm: new LlmRepo(this.ctx),
      chat: new ChatRepo(this.ctx),
      machines: new MachinesRepo(this.ctx),
      projects: new ProjectsRepo(this.ctx),
      tasks: new TasksRepo(this.ctx),
      ci: new CiRepo(this.ctx),
      qa: new QaRepo(this.ctx),
      releases: new ReleasesRepo(this.ctx),
      kb: new KbRepo(this.ctx)
    }
    this.identity = this.ctx.repos.identity
    this.settings = this.ctx.repos.settings
    this.llm = this.ctx.repos.llm
    this.chat = this.ctx.repos.chat
    this.machines = this.ctx.repos.machines
    this.projects = this.ctx.repos.projects
    this.tasks = this.ctx.repos.tasks
    this.ci = this.ctx.repos.ci
    this.qa = this.ctx.repos.qa
    this.releases = this.ctx.repos.releases
    this.kb = this.ctx.repos.kb
    this.migrate()
    this.ci.ensureKbUpdateCommand()
    this.ci.pruneDevelopmentAfterModelCommands()
    this.chat.setupMessagesFts()
  }

  /** Лёгкие миграции существующих БД (idempotent). */
  /**
   * Разовая миграция: отметка о выполнении лежит в `app_config`. Нужна там, где
   * шаг переписывает пользовательские данные — такой шаг обязан отработать один
   * раз, иначе он превращается в правило, отменяющее настройку на каждом старте.
   */
  private runOnce(key: string, step: () => void): void {
    if (this.settings.getAppConfig(key)) return
    step()
    this.settings.setAppConfig(key, '1')
  }

  private migrate(): void {
    // CHAT-193: legacy `user` becomes developer; only the two known ChatAI
    // accounts are elevated. Future accounts are never promoted implicitly.
    this.db.prepare(`UPDATE users SET role = 'developer' WHERE role = 'user'`).run()
    this.db.prepare(`UPDATE users SET role = 'admin' WHERE name IN ('admin', 'admin1')`).run()
    this.db.prepare(`UPDATE llm_engines SET allowed_roles = replace(allowed_roles, '"user"', '"developer"') WHERE allowed_roles LIKE '%"user"%'`).run()

    // Блокировка после неудачных входов (auth-roadmap п.3): три колонки поверх существующей таблицы users.
    const userCols = this.db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>
    if (userCols.length && !userCols.some((c) => c.name === 'failed_logins')) this.db.exec(`ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0`)
    if (userCols.length && !userCols.some((c) => c.name === 'locked_until')) this.db.exec(`ALTER TABLE users ADD COLUMN locked_until INTEGER`)
    if (userCols.length && !userCols.some((c) => c.name === 'lock_reason')) this.db.exec(`ALTER TABLE users ADD COLUMN lock_reason TEXT`)
    // 2FA (auth-roadmap п.6): base32-секрет TOTP; NULL — второй фактор выключен.
    if (userCols.length && !userCols.some((c) => c.name === 'totp_secret')) this.db.exec(`ALTER TABLE users ADD COLUMN totp_secret TEXT`)
    // Сброс пароля кодом от админа (auth-roadmap п.10) и обязательная смена временного пароля (п.11).
    if (userCols.length && !userCols.some((c) => c.name === 'reset_code_hash')) this.db.exec(`ALTER TABLE users ADD COLUMN reset_code_hash TEXT`)
    if (userCols.length && !userCols.some((c) => c.name === 'reset_code_expires')) this.db.exec(`ALTER TABLE users ADD COLUMN reset_code_expires INTEGER`)
    if (userCols.length && !userCols.some((c) => c.name === 'must_change_password')) this.db.exec(`ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0`)
    // Последний вход и просмотренные уведомления (пп.16, 18), лимит LLM-расхода в месяц (п.17).
    if (userCols.length && !userCols.some((c) => c.name === 'last_login')) this.db.exec(`ALTER TABLE users ADD COLUMN last_login INTEGER`)
    if (userCols.length && !userCols.some((c) => c.name === 'notices_seen_at')) this.db.exec(`ALTER TABLE users ADD COLUMN notices_seen_at INTEGER NOT NULL DEFAULT 0`)
    if (userCols.length && !userCols.some((c) => c.name === 'llm_limit_usd')) this.db.exec(`ALTER TABLE users ADD COLUMN llm_limit_usd REAL`)
    // Метаданные устройства сессии: ставятся поверх существующей таблицы, все
    // необязательные — старые строки продолжают читаться без них.
    // Журнал контекста пишет и смену настроек разговора, а не только тумблеры:
    // «кто понизил режим доступа» раньше не отвечал никто.
    const contextEventCols = this.db.prepare(`PRAGMA table_info(conversation_context_events)`).all() as Array<{ name: string }>
    if (contextEventCols.length && !contextEventCols.some((c) => c.name === 'value')) {
      this.db.exec(`ALTER TABLE conversation_context_events ADD COLUMN value TEXT`)
    }
    const eventCols = this.db.prepare(`PRAGMA table_info(security_events)`).all() as Array<{ name: string }>
    if (eventCols.length && !eventCols.some((c) => c.name === 'session_sid')) {
      this.db.exec(`ALTER TABLE security_events ADD COLUMN session_sid TEXT`)
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_security_events_sid ON security_events(session_sid, id DESC)`)
    }
    const sessionCols = this.db.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>
    if (sessionCols.length) {
      const add = (name: string, ddl: string): void => {
        if (!sessionCols.some((c) => c.name === name)) this.db.exec(`ALTER TABLE sessions ADD COLUMN ${ddl}`)
      }
      add('label', 'label TEXT')
      add('device_key', 'device_key TEXT')
      add('trusted_at', 'trusted_at INTEGER')
      add('platform', 'platform TEXT')
      add('client_version', 'client_version TEXT')
      add('geo', 'geo TEXT')
      add('requests', 'requests INTEGER NOT NULL DEFAULT 0')
      add('last_path', 'last_path TEXT')
      add('device_secret', 'device_secret TEXT')
      add('two_factor', 'two_factor INTEGER NOT NULL DEFAULT 0')
      add('end_reason', 'end_reason TEXT')
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_device ON sessions(user_name, device_key)`)
    }
    // Уровень доступа предоставленной проекту машины (machines-roadmap п.18): 'full' | 'read'.
    const shareCols = this.db.prepare(`PRAGMA table_info(machine_project_shares)`).all() as Array<{ name: string }>
    if (shareCols.length && !shareCols.some((c) => c.name === 'access')) this.db.exec(`ALTER TABLE machine_project_shares ADD COLUMN access TEXT NOT NULL DEFAULT 'full'`)
    // Токены агентов (machines-roadmap п.11): срок, дата выпуска, IP последнего подключения и привязка.
    const agentTokenCols = this.db.prepare(`PRAGMA table_info(agents)`).all() as Array<{ name: string }>
    if (agentTokenCols.length && !agentTokenCols.some((c) => c.name === 'token_expires_at')) this.db.exec(`ALTER TABLE agents ADD COLUMN token_expires_at INTEGER`)
    if (agentTokenCols.length && !agentTokenCols.some((c) => c.name === 'token_issued_at')) this.db.exec(`ALTER TABLE agents ADD COLUMN token_issued_at INTEGER`)
    if (agentTokenCols.length && !agentTokenCols.some((c) => c.name === 'last_ip')) this.db.exec(`ALTER TABLE agents ADD COLUMN last_ip TEXT`)
    if (agentTokenCols.length && !agentTokenCols.some((c) => c.name === 'pin_ip')) this.db.exec(`ALTER TABLE agents ADD COLUMN pin_ip INTEGER NOT NULL DEFAULT 0`)
    // Email пользователя (регистрация с подтверждением); уникальность — через индекс.
    if (userCols.length && !userCols.some((c) => c.name === 'email')) this.db.exec(`ALTER TABLE users ADD COLUMN email TEXT`)
    this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL`)
    // Адрес и факт успешной отправки системного инвайта (auth-roadmap п.9).
    const inviteCols = this.db.prepare(`PRAGMA table_info(invites)`).all() as Array<{ name: string }>
    if (inviteCols.length && !inviteCols.some((c) => c.name === 'email')) this.db.exec(`ALTER TABLE invites ADD COLUMN email TEXT`)
    if (inviteCols.length && !inviteCols.some((c) => c.name === 'emailed_at')) this.db.exec(`ALTER TABLE invites ADD COLUMN emailed_at INTEGER`)
    const taskLinkCols = this.db.prepare(`PRAGMA table_info(tasks)`).all() as Array<{ name: string }>
    if (taskLinkCols.length && !taskLinkCols.some((column) => column.name === 'source_task_id')) this.db.exec(`ALTER TABLE tasks ADD COLUMN source_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL`)
    if (taskLinkCols.length && !taskLinkCols.some((column) => column.name === 'auto_pilot')) this.db.exec(`ALTER TABLE tasks ADD COLUMN auto_pilot INTEGER NOT NULL DEFAULT 0`)
    if (taskLinkCols.length && !taskLinkCols.some((column) => column.name === 'auto_pilot_fix_cycles')) this.db.exec(`ALTER TABLE tasks ADD COLUMN auto_pilot_fix_cycles INTEGER NOT NULL DEFAULT 0`)
    const taskDesignCols = this.db.prepare(`PRAGMA table_info(task_designs)`).all() as Array<{ name: string }>
    if (taskDesignCols.length && !taskDesignCols.some((column) => column.name === 'mode')) this.db.exec(`ALTER TABLE task_designs ADD COLUMN mode TEXT NOT NULL DEFAULT 'whole_project'`)
    if (taskDesignCols.length && !taskDesignCols.some((column) => column.name === 'paths_json')) this.db.exec(`ALTER TABLE task_designs ADD COLUMN paths_json TEXT NOT NULL DEFAULT '[]'`)
    // Legacy: пустой path = whole_project, конкретный path = файловый режим.
    this.db.exec(`UPDATE task_designs SET mode = CASE WHEN path = '' THEN 'whole_project' ELSE 'files' END, paths_json = CASE WHEN path = '' THEN '[]' ELSE json_array(path) END WHERE paths_json = '[]' AND path <> ''`)
    const improvementCols = this.db.prepare(`PRAGMA table_info(task_improvements)`).all() as Array<{ name: string }>
    if (improvementCols.length && !improvementCols.some((column) => column.name === 'acceptance_criteria')) this.db.exec(`ALTER TABLE task_improvements ADD COLUMN acceptance_criteria TEXT NOT NULL DEFAULT ''`)
    if (improvementCols.length && !improvementCols.some((column) => column.name === 'created_task_id')) this.db.exec(`ALTER TABLE task_improvements ADD COLUMN created_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL`)
    if (improvementCols.length && !improvementCols.some((column) => column.name === 'files_json')) this.db.exec(`ALTER TABLE task_improvements ADD COLUMN files_json TEXT NOT NULL DEFAULT '[]'`)
    if (improvementCols.length) this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_task_improvements_created_task ON task_improvements(created_task_id) WHERE created_task_id IS NOT NULL`)

    const preparationCols = this.db.prepare(`PRAGMA table_info(task_preparation_runs)`).all() as Array<{ name: string }>
    const addPreparationColumn = (name: string, sql: string): void => {
      if (preparationCols.length && !preparationCols.some((column) => column.name === name)) this.db.exec(sql)
    }
    addPreparationColumn('phase', `ALTER TABLE task_preparation_runs ADD COLUMN phase TEXT NOT NULL DEFAULT 'initialization'`)
    addPreparationColumn('task_key', `ALTER TABLE task_preparation_runs ADD COLUMN task_key TEXT NOT NULL DEFAULT ''`)
    addPreparationColumn('machine_id', `ALTER TABLE task_preparation_runs ADD COLUMN machine_id TEXT`)
    addPreparationColumn('machine_name_snapshot', `ALTER TABLE task_preparation_runs ADD COLUMN machine_name_snapshot TEXT`)
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
    // Триггеры кэша стоимости снимаем до миграций: пересборка таблицы
    // (DROP + RENAME) падает, пока существует триггер с телом, которое
    // ссылается на `conversations`. В конце схемы они создаются заново.
    this.db.exec(`
      DROP TRIGGER IF EXISTS trg_messages_cost_dirty_ins;
      DROP TRIGGER IF EXISTS trg_messages_cost_dirty_upd;
      DROP TRIGGER IF EXISTS trg_messages_cost_dirty_del;
    `)
    const convCols = this.db
      .prepare(`PRAGMA table_info(conversations)`)
      .all() as Array<{ name: string }>
    if (!convCols.some((c) => c.name === 'user_id')) {
      this.db.exec(`ALTER TABLE conversations ADD COLUMN user_id TEXT`)
    }
    // Кэш стоимости беседы: в старых БД колонок нет, а `cost_dirty = 1`
    // заставит пересчитать итог при первом же показе списка.
    for (const [column, ddl] of [
      ['cost_usd', 'REAL'],
      ['cost_status', 'TEXT'],
      ['cost_prices_stamp', 'INTEGER'],
      ['cost_dirty', 'INTEGER NOT NULL DEFAULT 1']
    ] as const) {
      if (!convCols.some((c) => c.name === column)) this.db.exec(`ALTER TABLE conversations ADD COLUMN ${column} ${ddl}`)
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
    if (!convCols.some((c) => c.name === 'disabled_context_json')) {
      this.db.exec(`ALTER TABLE conversations ADD COLUMN disabled_context_json TEXT NOT NULL DEFAULT '[]'`)
    }
    if (!convCols.some((c) => c.name === 'project_id')) {
      this.db.exec(`ALTER TABLE conversations ADD COLUMN project_id TEXT`)
    }
    const orchestrationItemCols = this.db
      .prepare(`PRAGMA table_info(assistant_orchestration_items)`)
      .all() as Array<{ name: string }>
    if (orchestrationItemCols.length && !orchestrationItemCols.some((c) => c.name === 'attempts')) {
      this.db.exec(`ALTER TABLE assistant_orchestration_items ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`)
    }
    if (!convCols.some((c) => c.name === 'assistant_autonomy')) {
      this.db.exec(`ALTER TABLE conversations ADD COLUMN assistant_autonomy TEXT`)
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
    if (!convCols.some((c) => c.name === 'scope')) {
      this.db.exec(`ALTER TABLE conversations ADD COLUMN scope TEXT NOT NULL DEFAULT 'chat'`)
      this.db.exec(`UPDATE conversations SET scope = CASE
        WHEN task_id IS NOT NULL AND project_id IS NOT NULL THEN 'kanban'
        WHEN assistant_kind = 'kanban' AND project_id IS NOT NULL THEN 'kanban'
        WHEN assistant_kind = 'make' THEN 'make'
        WHEN assistant_kind = 'console-reader' THEN 'console'
        WHEN assistant_kind = 'playwright-reader' THEN 'playwright-reader'
        WHEN assistant_kind = 'web-recorder' THEN 'web-reader'
        ELSE 'chat' END`)
    }
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_user_scope_project_updated ON conversations(user_id, scope, project_id, updated_at DESC)`)
    // Чат карточки ищется по task_id: индекс по (user_id, scope, …) для этого
    // не годится, и поиск чата вырождался в перебор всех бесед пользователя.
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_task ON conversations(task_id, user_id, created_at)`)
    // В БД, созданных из schema.ts до появления студии картинок, список scope
    // зажат CHECK-констрейнтом в DDL таблицы. SQLite не умеет расширять CHECK
    // через ALTER, поэтому пересобираем таблицу: тот же DDL с новым списком,
    // копия данных и родные индексы. В старых БД scope добавлялся ALTER-ом без
    // CHECK — там пересборка не нужна и не запускается.
    const convDdl = (this.db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='conversations'`).get() as { sql: string } | undefined)?.sql
    if (convDdl && /scope IN \([^)]*\)/.test(convDdl) && !/scope IN \([^)]*'images'/.test(convDdl)) {
      const newDdl = convDdl
        .replace(/scope IN \([^)]*\)/, `scope IN ('chat','kanban','make','images','console','playwright-reader','web-reader')`)
        .replace(/^CREATE TABLE ("conversations"|conversations)/, 'CREATE TABLE conversations_new')
      const convIndexes = this.db.prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='conversations' AND sql IS NOT NULL`).all() as Array<{ sql: string }>
      this.db.exec('PRAGMA foreign_keys=OFF')
      this.db.transaction(() => {
        this.db.exec(newDdl)
        this.db.exec(`INSERT INTO conversations_new SELECT * FROM conversations`)
        this.db.exec(`DROP TABLE conversations`)
        this.db.exec(`ALTER TABLE conversations_new RENAME TO conversations`)
        for (const { sql } of convIndexes) this.db.exec(sql)
      })()
      this.db.exec('PRAGMA foreign_keys=ON')
    }
    if (!convCols.some((c) => c.name === 'status')) {
      this.db.exec(`ALTER TABLE conversations ADD COLUMN status TEXT NOT NULL DEFAULT 'developing'`)
    }
    // Триггеры ставим после всех миграций `conversations`: пересборка таблицы
    // (CHECK по scope) роняла бы их телом, ссылающимся на исчезнувшую таблицу.
    // Протухание ловим здесь, а не вызовами по коду: сообщения пишет десяток
    // мест (ход, правка, откат, импорт legacy), и любое забытое место давало бы
    // устаревшую цену в списке — ошибку, которую никто не заметит.
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_messages_cost_dirty_ins AFTER INSERT ON messages
      BEGIN UPDATE conversations SET cost_dirty = 1 WHERE id = NEW.conversation_id; END;
      CREATE TRIGGER IF NOT EXISTS trg_messages_cost_dirty_upd AFTER UPDATE ON messages
      BEGIN UPDATE conversations SET cost_dirty = 1 WHERE id = NEW.conversation_id; END;
      CREATE TRIGGER IF NOT EXISTS trg_messages_cost_dirty_del AFTER DELETE ON messages
      BEGIN UPDATE conversations SET cost_dirty = 1 WHERE id = OLD.conversation_id; END;
    `)
    // Make-чат к машине не ходит (`turns.ts`: makeChat), поэтому оставшиеся с
    // прежних времён привязки — мусор, который вводит в заблуждение: панель
    // показывала машину и каталог, которых ход не использует. Явное «без машины»
    // (`none`) сохраняем: это осознанный выбор пользователя, совпадающий с новым
    // поведением. Идемпотентно — второй запуск не находит строк.
    if (convCols.some((c) => c.name === 'assistant_kind')) {
      this.db.exec(`
        UPDATE conversations
        SET exec_target = CASE WHEN exec_target = 'none' THEN exec_target ELSE NULL END,
            workdir = NULL
        WHERE assistant_kind = 'make'
          AND ((exec_target IS NOT NULL AND exec_target <> 'none') OR workdir IS NOT NULL)
      `)
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
    if (pmCols.length && !pmCols.some((c) => c.name === 'storage_id')) {
      this.db.exec(`ALTER TABLE project_machines ADD COLUMN storage_id TEXT`)
    }
    if (pmCols.length && !pmCols.some((c) => c.name === 'directories_json')) {
      this.db.exec(`ALTER TABLE project_machines ADD COLUMN directories_json TEXT NOT NULL DEFAULT ''`)
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
    // Дерево типов проекта. Стоит ДО канонизации колонок ниже: та обязана знать тип
    // проекта, иначе «Общему проекту» на каждом открытии базы дописывался бы весь
    // конвейер разработки. Порядок внутри тоже важен: сначала узлы, потом колонка,
    // потом проставление типа старым проектам — иначе FK укажет в пустоту.
    // ALTER с REFERENCES в SQLite разрешён только при DEFAULT NULL (foreign_keys
    // включены), поэтому колонка nullable, а не NOT NULL DEFAULT.
    this.projects.seedBuiltinProjectTypes()
    const projectTypeCols = this.db.prepare(`PRAGMA table_info(projects)`).all() as Array<{ name: string }>
    if (projectTypeCols.length && !projectTypeCols.some((c) => c.name === 'project_type_id')) {
      this.db.exec(`ALTER TABLE projects ADD COLUMN project_type_id TEXT REFERENCES project_types(id)`)
    }
    // Существующие проекты — на КОРЕНЬ «Разработка ПО», а не на «Веб-приложение»:
    // возможности у них совпадают (подтип наследует всё), поведение не меняется,
    // и мы не объявляем задним числом чужой бэкенд веб-проектом.
    this.db.prepare(`UPDATE projects SET project_type_id = ? WHERE project_type_id IS NULL OR project_type_id = ''`)
      .run(DEFAULT_PROJECT_TYPE_ID)

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

      const typeOf = this.db.prepare(`SELECT project_type_id FROM projects WHERE id = ?`)
      for (const { id: projectId } of projectIds) {
        // Обязательный набор колонок задаёт ТИП проекта. Раньше конвейер разработки
        // дописывался всем подряд, и у «Общего проекта» короткая доска не пережила
        // бы ни одного перезапуска сервера.
        const typeId = (typeOf.get(projectId) as { project_type_id: string | null } | undefined)?.project_type_id || DEFAULT_PROJECT_TYPE_ID
        const typeColumns = this.projects.projectTypeDefaults(typeId).columns
        const requiredColumns: Array<[KanbanColumnSemanticType, string]> = typeColumns?.length
          ? typeColumns.map((column) => [column.semanticType, column.name])
          : workflowColumns
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
        for (const [semantic, name] of requiredColumns) {
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
            // Канонизация задаёт только порядок. Флаг hidden не трогаем: скрытие
            // колонки — пользовательская настройка (задачи при этом остаются), а
            // сброс делал её бессмысленной — каждый перезапуск сервера возвращал
            // скрытую системную колонку на доску.
            this.db.prepare(`UPDATE kanban_columns SET position=? WHERE id=?`).run(position, column.id)
            position += RANK_STEP
          }
        }
      }
    })()
    const featureProjectCols = this.db.prepare(`PRAGMA table_info(projects)`).all() as Array<{ name: string }>
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'preview_url')) this.db.exec(`ALTER TABLE projects ADD COLUMN preview_url TEXT`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'test_users_json')) this.db.exec(`ALTER TABLE projects ADD COLUMN test_users_json TEXT`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'commit_policy')) this.db.exec(`ALTER TABLE projects ADD COLUMN commit_policy TEXT NOT NULL DEFAULT 'agent_commits'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'merge_transport')) this.db.exec(`ALTER TABLE projects ADD COLUMN merge_transport TEXT NOT NULL DEFAULT 'local'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'agent_plan_approval_mode')) this.db.exec(`ALTER TABLE projects ADD COLUMN agent_plan_approval_mode TEXT NOT NULL DEFAULT 'manual'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'command_policy')) this.db.exec(`ALTER TABLE projects ADD COLUMN command_policy TEXT NOT NULL DEFAULT ''`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'test_command')) this.db.exec(`ALTER TABLE projects ADD COLUMN test_command TEXT NOT NULL DEFAULT ''`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'component_qa_command')) this.db.exec(`ALTER TABLE projects ADD COLUMN component_qa_command TEXT NOT NULL DEFAULT ''`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'integration_test_command')) this.db.exec(`ALTER TABLE projects ADD COLUMN integration_test_command TEXT NOT NULL DEFAULT ''`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'production_deploy_command')) this.db.exec(`ALTER TABLE projects ADD COLUMN production_deploy_command TEXT NOT NULL DEFAULT ''`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'production_agent_id')) this.db.exec(`ALTER TABLE projects ADD COLUMN production_agent_id TEXT`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'production_environment_mode')) this.db.exec(`ALTER TABLE projects ADD COLUMN production_environment_mode TEXT NOT NULL DEFAULT 'legacy'`)
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
    // Нормализация двух исторических дефолтов шаблона ветки — **разовая**: сами
    // значения `feature/{task_number}` человек вправе выставить осознанно, и
    // повторный прогон молча откатывал бы его настройку при каждом старте сервера.
    // Условие по `featureProjectCols` здесь не нужно и было бы вредно: это снимок
    // PRAGMA до ALTER выше, на свежей базе он колонки не видит — отметка о разовой
    // миграции не ставилась бы, и нормализация срабатывала бы на втором открытии,
    // уже поверх пользовательского значения. После ALTER колонка есть всегда.
    this.runOnce('migration.ciBranchTemplate.normalized', () => {
      this.db.prepare(`UPDATE projects SET ci_branch_template='{task_number}' WHERE ci_branch_template IN ('feature/{task_number}', 'feature/{task_number}-{slug}')`).run()
    })
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
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'automated_qa_command')) this.db.exec(`ALTER TABLE projects ADD COLUMN automated_qa_command TEXT NOT NULL DEFAULT 'npm test'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'automated_qa_mode')) this.db.exec(`ALTER TABLE projects ADD COLUMN automated_qa_mode TEXT NOT NULL DEFAULT 'command'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'automated_qa_scenario_json')) this.db.exec(`ALTER TABLE projects ADD COLUMN automated_qa_scenario_json TEXT NOT NULL DEFAULT ''`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'autopilot_default')) this.db.exec(`ALTER TABLE projects ADD COLUMN autopilot_default INTEGER NOT NULL DEFAULT 0`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'autopilot_requires_manual_qa')) this.db.exec(`ALTER TABLE projects ADD COLUMN autopilot_requires_manual_qa INTEGER NOT NULL DEFAULT 0`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'autopilot_fix_limit')) this.db.exec(`ALTER TABLE projects ADD COLUMN autopilot_fix_limit INTEGER NOT NULL DEFAULT 3`)
    const ciWorkspaceCols = this.db.prepare(`PRAGMA table_info(ci_workspaces)`).all() as Array<{ name: string }>
    if (ciWorkspaceCols.length && !ciWorkspaceCols.some((c) => c.name === 'branch')) this.db.exec(`ALTER TABLE ci_workspaces ADD COLUMN branch TEXT`)
    if (ciWorkspaceCols.length && !ciWorkspaceCols.some((c) => c.name === 'commit_sha')) this.db.exec(`ALTER TABLE ci_workspaces ADD COLUMN commit_sha TEXT`)
    if (ciWorkspaceCols.length && !ciWorkspaceCols.some((c) => c.name === 'pushed')) this.db.exec(`ALTER TABLE ci_workspaces ADD COLUMN pushed INTEGER NOT NULL DEFAULT 0`)
    if (ciWorkspaceCols.length && !ciWorkspaceCols.some((c) => c.name === 'npm_cache_dir')) this.db.exec(`ALTER TABLE ci_workspaces ADD COLUMN npm_cache_dir TEXT`)
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
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'error')) this.db.exec(`ALTER TABLE ci_runs ADD COLUMN error TEXT`)
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
    // Обязательный системный commit-step хранится в данных. Старый сокращённый
    // скрипт (`git add -A`) оставлял ветку/коммит на усмотрение fix-модели, поэтому
    // обновляем запись по её стабильному имени; условие сохраняет идемпотентность.
    this.db.prepare(`UPDATE ci_commands
      SET script = ?, version = version + 1, updated_at = ?
      WHERE name = ? AND deleted_at IS NULL AND script <> ?`)
      .run(TASK_COMMIT_COMMAND_SCRIPT, Date.now(), TASK_COMMIT_COMMAND_NAME, TASK_COMMIT_COMMAND_SCRIPT)
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
    // Снимок сценария Playwright-этапа (круг 8): старые раны его не имеют и
    // читают сценарий проекта — фолбэк в automatedQaExecutionContext.
    const qaStageCols = this.db.prepare(`PRAGMA table_info(qa_stage_runs)`).all() as Array<{ name: string }>
    if (qaStageCols.length && !qaStageCols.some((c) => c.name === 'scenario_json')) this.db.exec(`ALTER TABLE qa_stage_runs ADD COLUMN scenario_json TEXT NOT NULL DEFAULT ''`)
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
    if (this.chat.ftsTimer) clearTimeout(this.chat.ftsTimer)
    this.chat.ftsTimer = null
    this.db.close()
  }
}

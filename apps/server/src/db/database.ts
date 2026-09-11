// Точка входа слоя данных: открывает SQLite, применяет схему и миграции и раздаёт доменные
// репозитории (db.chat, db.tasks, …). Сами запросы живут в ./repos/<домен>.ts — по одному
// владельцу на таблицу (./ownership.ts); правила разреза — docs/plans/db-repositories.md.
import { DEFAULT_PROJECT_TYPE_ID, type KanbanColumnSemanticType, DEFAULT_CI_CLAUDE_MODEL, CI_KB_UPDATE_COMMAND_ID, DEFAULT_DONE_RETENTION_DAYS, DEFAULT_CI_GLOBAL_SETTINGS, isVerificationCommand } from '@voicechat/shared'
import Database from 'better-sqlite3'
import { createSqliteSql } from './sql/sqlite.js'
import { createPgSql } from './sql/pg.js'
import type { Sql } from './sql/types.js'
import { createLane, type Lane } from './sql/lane.js'
import { PG_SCHEMA } from './schemaPg.js'

/** Ключ advisory-замка установки схемы Postgres: произвольная константа, одна на все процессы стенда. */
const PG_SCHEMA_LOCK_KEY = 7_260_119
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
import { asyncPort, type AsyncPort, type Ports, type RepoContext, type Repos } from './repos/base.js'
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
export { projectKbSkeleton } from './repos/kb.js'
export type { CiStageExecutionContext } from './repos/ci.js'
export type { AutomatedQaExecutionContext } from './repos/qa.js'
export type { Repos, RepoContext, AsyncPort, Ports, PortOverrides } from './repos/base.js'

export class VoiceChatDb {
  /** Адаптер базы; репозитории пишут SQL в диалекте SQLite, различия движков закрывает адаптер. */
  private readonly sql: Sql
  readonly engine: 'sqlite' | 'postgres'
  /** Сырой драйвер SQLite — тестам, которые проверяют схему и данные напрямую; они обязаны дождаться `ready`. На Postgres — undefined. */
  protected readonly db: Database.Database | undefined
  private readonly dropSchemaOnClose: string | null
  private readonly newId: () => string
  private readonly now: () => number
  private readonly ctx: RepoContext
  /**
   * Схема и миграции применены. Порты (db.chat, db.tasks, …) и `impl` ждут этого сами; внутри
   * слоя (`ctx.repos`) ожидания нет — миграции сами работают через репозитории.
   */
  readonly ready: Promise<void>
  /** Полоса портов (sql/lane.ts): закрытие ждёт её опустошения. Отключается `DbDeps.concurrent`. */
  private readonly lane: Lane | null
  /**
   * Реализации доменов напрямую, минуя порты. Не для сервера — он ходит через порты; нужен
   * тестам, которые подменяют метод (`db.impl.tasks.isTaskClosed = async () => true`): подмена
   * видна и через порт, и соседям через this.repos.
   */
  readonly impl: Repos
  /** @deprecated Старое имя `impl`: реализации больше не синхронные. Оставлено для тестов. */
  readonly sync: Repos
  readonly identity: AsyncPort<IdentityRepo>
  readonly settings: AsyncPort<SettingsRepo>
  readonly llm: AsyncPort<LlmRepo>
  readonly chat: AsyncPort<ChatRepo>
  readonly machines: AsyncPort<MachinesRepo>
  readonly projects: AsyncPort<ProjectsRepo>
  readonly tasks: AsyncPort<TasksRepo>
  readonly ci: AsyncPort<CiRepo>
  readonly qa: AsyncPort<QaRepo>
  readonly releases: AsyncPort<ReleasesRepo>
  readonly kb: AsyncPort<KbRepo>
  /** Close-события WebSocket могут прийти после teardown; закрытую БД больше не трогаем. */
  private get closed(): boolean { return this.ctx.closed }
  private set closed(value: boolean) { this.ctx.closed = value }

  constructor(filename: string, deps: DbDeps = {}) {
    // Матрица тестов на Postgres: `VC_TEST_DB_URL` заставляет каждую `:memory:`-базу открываться
    // свежей схемой в Postgres — так весь набор тестов сервера гоняется на втором движке без правок.
    if (!deps.postgres && filename === ':memory:' && process.env.VC_TEST_DB_URL) {
      deps = { ...deps, postgres: { url: process.env.VC_TEST_DB_URL, schema: `t_${randomUUID().replace(/-/g, '').slice(0, 16)}`, dropSchemaOnClose: true } }
    }
    if (deps.postgres) {
      this.engine = 'postgres'
      this.sql = createPgSql({ connectionString: deps.postgres.url, ...(deps.postgres.schema ? { schema: deps.postgres.schema } : {}) })
      this.db = undefined
      this.dropSchemaOnClose = deps.postgres.dropSchemaOnClose && deps.postgres.schema ? deps.postgres.schema : null
    } else {
      this.engine = 'sqlite'
      const raw = new Database(filename)
      raw.pragma('journal_mode = WAL')
      raw.pragma('foreign_keys = ON')
      // Unicode-lower для регистронезависимого поиска (SQLite LIKE/lower() — только ASCII).
      raw.function('ulower', (s: unknown) => (typeof s === 'string' ? s.toLowerCase() : ''))
      this.sql = createSqliteSql(raw)
      this.db = raw
      this.dropSchemaOnClose = null
    }
    this.newId = deps.newId ?? (() => randomUUID())
    this.now = deps.now ?? (() => Date.now())

    // Домены делят одно соединение; соседи достижимы через ctx.repos — так кросс-доменные
    // обращения остаются явными (см. ownership.ts и гейт ownership.test.ts).
    this.ctx = { sql: this.sql, newId: this.newId, now: this.now, closed: false, repos: undefined as unknown as Repos }
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
    // Порты по умолчанию — репозитории за ожиданием готовности и полосой SQLite (методы по одному,
    // как при синхронном драйвере); домен на другом движке или удалённый сервис подставляется
    // фабрикой из deps.ports поверх уже собранных соседей.
    let readyDone = false
    // Полоса включена на обоих движках: сервер опирается на порядок вызовов и атомарность
    // многошаговых методов внутри процесса (см. sql/lane.ts). На Postgres это ограничивает
    // параллелизм внутри одного процесса — ровно как SQLite сегодня; параллелизм между
    // сервисами остаётся. `concurrent: true` снимает полосу, когда методы станут транзакционными.
    this.lane = deps.concurrent ? null : createLane()
    const portOptions = { ready: () => (readyDone ? undefined : this.ready), ...(this.lane ? { lane: this.lane } : {}) }
    const gate = <K extends keyof Repos>(key: K): AsyncPort<Repos[K]> => asyncPort(this.ctx.repos[key], portOptions)
    const ports: Ports = {
      identity: gate('identity'), settings: gate('settings'), llm: gate('llm'), chat: gate('chat'), machines: gate('machines'),
      projects: gate('projects'), tasks: gate('tasks'), ci: gate('ci'), qa: gate('qa'), releases: gate('releases'), kb: gate('kb')
    }
    for (const key of Object.keys(deps.ports ?? {}) as Array<keyof Ports>) {
      const factory = deps.ports?.[key]
      if (factory) (ports as Record<keyof Ports, unknown>)[key] = factory(ports)
    }
    // Тот же гейт, но под типами реализаций: подмена метода в тесте уходит в сам репозиторий.
    this.impl = ports as unknown as Repos
    this.sync = this.impl
    this.identity = ports.identity
    this.settings = ports.settings
    this.llm = ports.llm
    this.chat = ports.chat
    this.machines = ports.machines
    this.projects = ports.projects
    this.tasks = ports.tasks
    this.ci = ports.ci
    this.qa = ports.qa
    this.releases = ports.releases
    this.kb = ports.kb
    this.ready = this.init()
    void this.ready.then(() => { readyDone = true }, () => {})
  }

  /** Схема, миграции и служебные строки — один раз при открытии; ошибка здесь роняет сервер на старте. */
  private async init(): Promise<void> {
    if (this.engine === 'postgres') {
      // Postgres-база создаётся переносом из SQLite уже в актуальной схеме (или пустой), поэтому
      // ей нужны только сама схема и сиды — миграции старых SQLite-файлов к ней не относятся.
      const schema = (this.sql as { schema?: string | null }).schema
      // Соседние процессы одного стенда (ядро, канбан, машины, ридер) стартуют на одной базе одновременно, и
      // `CREATE TABLE IF NOT EXISTS …` у двух сессий берёт замки связанных таблиц в разном порядке — Postgres
      // валит одну deadlock-ом (40P01), а `CREATE SCHEMA IF NOT EXISTS` наперегонки даёт duplicate key. Схему
      // ставит тот, кто первым взял advisory-замок транзакции; остальные ждут и находят всё уже созданным.
      await this.sql.transaction(async () => {
        await this.sql.run(`SELECT pg_advisory_xact_lock(?)`, [PG_SCHEMA_LOCK_KEY])
        if (schema) await this.sql.exec(`CREATE SCHEMA IF NOT EXISTS ${schema}`)
        await this.sql.exec(PG_SCHEMA.sql)
      })
      await this.ctx.repos.projects.seedBuiltinProjectTypes()
    } else {
      // Старый model_prices ещё не знает tiers_json, а актуальный сид уже пишет в
      // эту колонку. Поднять совместимую форму таблицы нужно до выполнения схемы.
      await this.migrateModelPriceTiers()
      await this.sql.exec(SCHEMA_SQL)
      await this.migrate()
    }
    await this.ctx.repos.ci.ensureKbUpdateCommand()
    await this.ctx.repos.ci.pruneDevelopmentAfterModelCommands()
    await this.ctx.repos.chat.setupMessagesFts()
  }

  /** Лёгкие миграции существующих БД (idempotent). */
  /**
   * Разовая миграция: отметка о выполнении лежит в `app_config`. Нужна там, где
   * шаг переписывает пользовательские данные — такой шаг обязан отработать один
   * раз, иначе он превращается в правило, отменяющее настройку на каждом старте.
   */
  private async runOnce(key: string, step: () => void | Promise<void>): Promise<void> {
    if (await this.ctx.repos.settings.getAppConfig(key)) return
    await step()
    await this.ctx.repos.settings.setAppConfig(key, '1')
  }

  private async migrateModelPriceTiers(): Promise<void> {
    const columns = (await this.sql.all(`PRAGMA table_info(model_prices)`)) as Array<{ name: string }>
    if (columns.length && !columns.some((column) => column.name === 'tiers_json')) {
      await this.sql.exec(`ALTER TABLE model_prices ADD COLUMN tiers_json TEXT NOT NULL DEFAULT '[]'`)
    }
  }

  private async migrate(): Promise<void> {
    // CHAT-193: legacy `user` becomes developer; only the two known ChatAI
    // accounts are elevated. Future accounts are never promoted implicitly.
    await this.sql.run(`UPDATE users SET role = 'developer' WHERE role = 'user'`)
    await this.sql.run(`UPDATE users SET role = 'admin' WHERE name IN ('admin', 'admin1')`)
    await this.sql.run(`UPDATE llm_engines SET allowed_roles = replace(allowed_roles, '"user"', '"developer"') WHERE allowed_roles LIKE '%"user"%'`)

    // Блокировка после неудачных входов (auth-roadmap п.3): три колонки поверх существующей таблицы users.
    const userCols = (await this.sql.all(`PRAGMA table_info(users)`)) as Array<{ name: string }>
    if (userCols.length && !userCols.some((c) => c.name === 'failed_logins')) await this.sql.exec(`ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0`)
    if (userCols.length && !userCols.some((c) => c.name === 'locked_until')) await this.sql.exec(`ALTER TABLE users ADD COLUMN locked_until INTEGER`)
    if (userCols.length && !userCols.some((c) => c.name === 'lock_reason')) await this.sql.exec(`ALTER TABLE users ADD COLUMN lock_reason TEXT`)
    // 2FA (auth-roadmap п.6): base32-секрет TOTP; NULL — второй фактор выключен.
    if (userCols.length && !userCols.some((c) => c.name === 'totp_secret')) await this.sql.exec(`ALTER TABLE users ADD COLUMN totp_secret TEXT`)
    // Сброс пароля кодом от админа (auth-roadmap п.10) и обязательная смена временного пароля (п.11).
    if (userCols.length && !userCols.some((c) => c.name === 'reset_code_hash')) await this.sql.exec(`ALTER TABLE users ADD COLUMN reset_code_hash TEXT`)
    if (userCols.length && !userCols.some((c) => c.name === 'reset_code_expires')) await this.sql.exec(`ALTER TABLE users ADD COLUMN reset_code_expires INTEGER`)
    if (userCols.length && !userCols.some((c) => c.name === 'must_change_password')) await this.sql.exec(`ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0`)
    // Последний вход и просмотренные уведомления (пп.16, 18), лимит LLM-расхода в месяц (п.17).
    if (userCols.length && !userCols.some((c) => c.name === 'last_login')) await this.sql.exec(`ALTER TABLE users ADD COLUMN last_login INTEGER`)
    if (userCols.length && !userCols.some((c) => c.name === 'notices_seen_at')) await this.sql.exec(`ALTER TABLE users ADD COLUMN notices_seen_at INTEGER NOT NULL DEFAULT 0`)
    if (userCols.length && !userCols.some((c) => c.name === 'llm_limit_usd')) await this.sql.exec(`ALTER TABLE users ADD COLUMN llm_limit_usd REAL`)
    // Метаданные устройства сессии: ставятся поверх существующей таблицы, все
    // необязательные — старые строки продолжают читаться без них.
    // Журнал контекста пишет и смену настроек разговора, а не только тумблеры:
    // «кто понизил режим доступа» раньше не отвечал никто.
    const contextEventCols = (await this.sql.all(`PRAGMA table_info(conversation_context_events)`)) as Array<{ name: string }>
    if (contextEventCols.length && !contextEventCols.some((c) => c.name === 'value')) {
      await this.sql.exec(`ALTER TABLE conversation_context_events ADD COLUMN value TEXT`)
    }
    const eventCols = (await this.sql.all(`PRAGMA table_info(security_events)`)) as Array<{ name: string }>
    if (eventCols.length && !eventCols.some((c) => c.name === 'session_sid')) {
      await this.sql.exec(`ALTER TABLE security_events ADD COLUMN session_sid TEXT`)
      await this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_security_events_sid ON security_events(session_sid, id DESC)`)
    }
    const sessionCols = (await this.sql.all(`PRAGMA table_info(sessions)`)) as Array<{ name: string }>
    if (sessionCols.length) {
      const add = async (name: string, ddl: string): Promise<void> => {
        if (!sessionCols.some((c) => c.name === name)) await this.sql.exec(`ALTER TABLE sessions ADD COLUMN ${ddl}`)
      }
      await add('label', 'label TEXT')
      await add('device_key', 'device_key TEXT')
      await add('trusted_at', 'trusted_at INTEGER')
      await add('platform', 'platform TEXT')
      await add('client_version', 'client_version TEXT')
      await add('geo', 'geo TEXT')
      await add('requests', 'requests INTEGER NOT NULL DEFAULT 0')
      await add('last_path', 'last_path TEXT')
      await add('device_secret', 'device_secret TEXT')
      await add('two_factor', 'two_factor INTEGER NOT NULL DEFAULT 0')
      await add('end_reason', 'end_reason TEXT')
      await this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_device ON sessions(user_name, device_key)`)
    }
    // Уровень доступа предоставленной проекту машины (machines-roadmap п.18): 'full' | 'read'.
    const shareCols = (await this.sql.all(`PRAGMA table_info(machine_project_shares)`)) as Array<{ name: string }>
    if (shareCols.length && !shareCols.some((c) => c.name === 'access')) await this.sql.exec(`ALTER TABLE machine_project_shares ADD COLUMN access TEXT NOT NULL DEFAULT 'full'`)
    // Токены агентов (machines-roadmap п.11): срок, дата выпуска, IP последнего подключения и привязка.
    const agentTokenCols = (await this.sql.all(`PRAGMA table_info(agents)`)) as Array<{ name: string }>
    if (agentTokenCols.length && !agentTokenCols.some((c) => c.name === 'token_expires_at')) await this.sql.exec(`ALTER TABLE agents ADD COLUMN token_expires_at INTEGER`)
    if (agentTokenCols.length && !agentTokenCols.some((c) => c.name === 'token_issued_at')) await this.sql.exec(`ALTER TABLE agents ADD COLUMN token_issued_at INTEGER`)
    if (agentTokenCols.length && !agentTokenCols.some((c) => c.name === 'last_ip')) await this.sql.exec(`ALTER TABLE agents ADD COLUMN last_ip TEXT`)
    if (agentTokenCols.length && !agentTokenCols.some((c) => c.name === 'pin_ip')) await this.sql.exec(`ALTER TABLE agents ADD COLUMN pin_ip INTEGER NOT NULL DEFAULT 0`)
    // Email пользователя (регистрация с подтверждением); уникальность — через индекс.
    if (userCols.length && !userCols.some((c) => c.name === 'email')) await this.sql.exec(`ALTER TABLE users ADD COLUMN email TEXT`)
    await this.sql.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL`)
    // Адрес и факт успешной отправки системного инвайта (auth-roadmap п.9).
    const inviteCols = (await this.sql.all(`PRAGMA table_info(invites)`)) as Array<{ name: string }>
    if (inviteCols.length && !inviteCols.some((c) => c.name === 'email')) await this.sql.exec(`ALTER TABLE invites ADD COLUMN email TEXT`)
    if (inviteCols.length && !inviteCols.some((c) => c.name === 'emailed_at')) await this.sql.exec(`ALTER TABLE invites ADD COLUMN emailed_at INTEGER`)
    const taskLinkCols = (await this.sql.all(`PRAGMA table_info(tasks)`)) as Array<{ name: string }>
    if (taskLinkCols.length && !taskLinkCols.some((column) => column.name === 'source_task_id')) await this.sql.exec(`ALTER TABLE tasks ADD COLUMN source_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL`)
    if (taskLinkCols.length && !taskLinkCols.some((column) => column.name === 'auto_pilot')) await this.sql.exec(`ALTER TABLE tasks ADD COLUMN auto_pilot INTEGER NOT NULL DEFAULT 0`)
    if (taskLinkCols.length && !taskLinkCols.some((column) => column.name === 'auto_pilot_fix_cycles')) await this.sql.exec(`ALTER TABLE tasks ADD COLUMN auto_pilot_fix_cycles INTEGER NOT NULL DEFAULT 0`)
    const taskDesignCols = (await this.sql.all(`PRAGMA table_info(task_designs)`)) as Array<{ name: string }>
    if (taskDesignCols.length && !taskDesignCols.some((column) => column.name === 'mode')) await this.sql.exec(`ALTER TABLE task_designs ADD COLUMN mode TEXT NOT NULL DEFAULT 'whole_project'`)
    if (taskDesignCols.length && !taskDesignCols.some((column) => column.name === 'paths_json')) await this.sql.exec(`ALTER TABLE task_designs ADD COLUMN paths_json TEXT NOT NULL DEFAULT '[]'`)
    // Legacy: пустой path = whole_project, конкретный path = файловый режим.
    await this.sql.exec(`UPDATE task_designs SET mode = CASE WHEN path = '' THEN 'whole_project' ELSE 'files' END, paths_json = CASE WHEN path = '' THEN '[]' ELSE json_array(path) END WHERE paths_json = '[]' AND path <> ''`)
    const reworkCols = (await this.sql.all(`PRAGMA table_info(task_rework_cycles)`)) as Array<{ name: string }>
    // Все ранее созданные циклы — уже отправленные: черновиков до этой колонки не было.
    if (reworkCols.length && !reworkCols.some((column) => column.name === 'status')) await this.sql.exec(`ALTER TABLE task_rework_cycles ADD COLUMN status TEXT NOT NULL DEFAULT 'submitted'`)
    const improvementCols = (await this.sql.all(`PRAGMA table_info(task_improvements)`)) as Array<{ name: string }>
    if (improvementCols.length && !improvementCols.some((column) => column.name === 'acceptance_criteria')) await this.sql.exec(`ALTER TABLE task_improvements ADD COLUMN acceptance_criteria TEXT NOT NULL DEFAULT ''`)
    if (improvementCols.length && !improvementCols.some((column) => column.name === 'created_task_id')) await this.sql.exec(`ALTER TABLE task_improvements ADD COLUMN created_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL`)
    if (improvementCols.length && !improvementCols.some((column) => column.name === 'files_json')) await this.sql.exec(`ALTER TABLE task_improvements ADD COLUMN files_json TEXT NOT NULL DEFAULT '[]'`)
    if (improvementCols.length) await this.sql.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_task_improvements_created_task ON task_improvements(created_task_id) WHERE created_task_id IS NOT NULL`)

    const preparationCols = (await this.sql.all(`PRAGMA table_info(task_preparation_runs)`)) as Array<{ name: string }>
    const addPreparationColumn = async (name: string, sql: string): Promise<void> => {
      if (preparationCols.length && !preparationCols.some((column) => column.name === name)) await this.sql.exec(sql)
    }
    await addPreparationColumn('phase', `ALTER TABLE task_preparation_runs ADD COLUMN phase TEXT NOT NULL DEFAULT 'initialization'`)
    await addPreparationColumn('task_key', `ALTER TABLE task_preparation_runs ADD COLUMN task_key TEXT NOT NULL DEFAULT ''`)
    await addPreparationColumn('machine_id', `ALTER TABLE task_preparation_runs ADD COLUMN machine_id TEXT`)
    await addPreparationColumn('machine_name_snapshot', `ALTER TABLE task_preparation_runs ADD COLUMN machine_name_snapshot TEXT`)
    await addPreparationColumn('llm_engine_id', `ALTER TABLE task_preparation_runs ADD COLUMN llm_engine_id TEXT`)
    await addPreparationColumn('provider', `ALTER TABLE task_preparation_runs ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude'`)
    await addPreparationColumn('model', `ALTER TABLE task_preparation_runs ADD COLUMN model TEXT NOT NULL DEFAULT ''`)
    await addPreparationColumn('profile_id', `ALTER TABLE task_preparation_runs ADD COLUMN profile_id TEXT NOT NULL DEFAULT ''`)
    await addPreparationColumn('gate_results_json', `ALTER TABLE task_preparation_runs ADD COLUMN gate_results_json TEXT NOT NULL DEFAULT '[]'`)
    await addPreparationColumn('started_at', `ALTER TABLE task_preparation_runs ADD COLUMN started_at INTEGER`)
    if (preparationCols.length) {
      await this.sql.exec(`DROP INDEX IF EXISTS idx_task_preparation_active; CREATE UNIQUE INDEX idx_task_preparation_active ON task_preparation_runs(task_id) WHERE status IN ('queued','running','waiting_for_answer','validating')`)
    }

    const agentCols = (await this.sql.all(`PRAGMA table_info(agents)`)) as Array<{ name: string }>
    if (!agentCols.some((c) => c.name === 'policy')) {
      await this.sql.exec(`ALTER TABLE agents ADD COLUMN policy TEXT`)
    }
    if (!agentCols.some((c) => c.name === 'user_id')) {
      await this.sql.exec(`ALTER TABLE agents ADD COLUMN user_id TEXT`)
    }
    // Триггеры кэша стоимости снимаем до миграций: пересборка таблицы
    // (DROP + RENAME) падает, пока существует триггер с телом, которое
    // ссылается на `conversations`. В конце схемы они создаются заново.
    await this.sql.exec(`
      DROP TRIGGER IF EXISTS trg_messages_cost_dirty_ins;
      DROP TRIGGER IF EXISTS trg_messages_cost_dirty_upd;
      DROP TRIGGER IF EXISTS trg_messages_cost_dirty_del;
    `)
    const convCols = (await this.sql.all(`PRAGMA table_info(conversations)`)) as Array<{ name: string }>
    if (!convCols.some((c) => c.name === 'user_id')) {
      await this.sql.exec(`ALTER TABLE conversations ADD COLUMN user_id TEXT`)
    }
    // Кэш стоимости беседы: в старых БД колонок нет, а `cost_dirty = 1`
    // заставит пересчитать итог при первом же показе списка.
    for (const [column, ddl] of [
      ['cost_usd', 'REAL'],
      ['cost_status', 'TEXT'],
      ['cost_prices_stamp', 'INTEGER'],
      ['cost_dirty', 'INTEGER NOT NULL DEFAULT 1']
    ] as const) {
      if (!convCols.some((c) => c.name === column)) await this.sql.exec(`ALTER TABLE conversations ADD COLUMN ${column} ${ddl}`)
    }
    if (!convCols.some((c) => c.name === 'exec_target')) {
      await this.sql.exec(`ALTER TABLE conversations ADD COLUMN exec_target TEXT`)
    }
    if (!convCols.some((c) => c.name === 'workdir')) {
      await this.sql.exec(`ALTER TABLE conversations ADD COLUMN workdir TEXT`)
    }
    if (!convCols.some((c) => c.name === 'skill_names')) {
      await this.sql.exec(`ALTER TABLE conversations ADD COLUMN skill_names TEXT NOT NULL DEFAULT '[]'`)
    }
    if (!convCols.some((c) => c.name === 'llm_engine_id')) {
      await this.sql.exec(`ALTER TABLE conversations ADD COLUMN llm_engine_id TEXT`)
    }
    if (!convCols.some((c) => c.name === 'llm_provider')) {
      await this.sql.exec(`ALTER TABLE conversations ADD COLUMN llm_provider TEXT`)
    }
    if (!convCols.some((c) => c.name === 'llm_model')) {
      await this.sql.exec(`ALTER TABLE conversations ADD COLUMN llm_model TEXT`)
    }
    if (!convCols.some((c) => c.name === 'permission_mode')) {
      await this.sql.exec(`ALTER TABLE conversations ADD COLUMN permission_mode TEXT`)
    }
    if (!convCols.some((c) => c.name === 'kb_context_mode')) {
      await this.sql.exec(`ALTER TABLE conversations ADD COLUMN kb_context_mode TEXT NOT NULL DEFAULT 'auto'`)
    }
    if (!convCols.some((c) => c.name === 'disabled_context_json')) {
      await this.sql.exec(`ALTER TABLE conversations ADD COLUMN disabled_context_json TEXT NOT NULL DEFAULT '[]'`)
    }
    if (!convCols.some((c) => c.name === 'project_id')) {
      await this.sql.exec(`ALTER TABLE conversations ADD COLUMN project_id TEXT`)
    }
    const orchestrationItemCols = (await this.sql.all(`PRAGMA table_info(assistant_orchestration_items)`)) as Array<{ name: string }>
    if (orchestrationItemCols.length && !orchestrationItemCols.some((c) => c.name === 'attempts')) {
      await this.sql.exec(`ALTER TABLE assistant_orchestration_items ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`)
    }
    if (!convCols.some((c) => c.name === 'assistant_autonomy')) {
      await this.sql.exec(`ALTER TABLE conversations ADD COLUMN assistant_autonomy TEXT`)
    }
    if (!convCols.some((c) => c.name === 'preview_engine')) {
      await this.sql.exec(`ALTER TABLE conversations ADD COLUMN preview_engine TEXT NOT NULL DEFAULT 'proxy'`)
    }
    if (!convCols.some((c) => c.name === 'preview_url')) {
      await this.sql.exec(`ALTER TABLE conversations ADD COLUMN preview_url TEXT`)
    }
    if (!convCols.some((c) => c.name === 'task_id')) {
      await this.sql.exec(`ALTER TABLE conversations ADD COLUMN task_id TEXT`)
    }
    if (!convCols.some((c) => c.name === 'assistant_kind')) {
      await this.sql.exec(`ALTER TABLE conversations ADD COLUMN assistant_kind TEXT`)
    }
    if (!convCols.some((c) => c.name === 'scope')) {
      await this.sql.exec(`ALTER TABLE conversations ADD COLUMN scope TEXT NOT NULL DEFAULT 'chat'`)
      await this.sql.exec(`UPDATE conversations SET scope = CASE
        WHEN task_id IS NOT NULL AND project_id IS NOT NULL THEN 'kanban'
        WHEN assistant_kind = 'kanban' AND project_id IS NOT NULL THEN 'kanban'
        WHEN assistant_kind = 'make' THEN 'make'
        WHEN assistant_kind = 'console-reader' THEN 'console'
        WHEN assistant_kind = 'playwright-reader' THEN 'playwright-reader'
        WHEN assistant_kind = 'web-recorder' THEN 'web-reader'
        ELSE 'chat' END`)
    }
    await this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_user_scope_project_updated ON conversations(user_id, scope, project_id, updated_at DESC)`)
    // Чат карточки ищется по task_id: индекс по (user_id, scope, …) для этого
    // не годится, и поиск чата вырождался в перебор всех бесед пользователя.
    await this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_task ON conversations(task_id, user_id, created_at)`)
    // В БД, созданных из schema.ts до появления студии картинок, список scope
    // зажат CHECK-констрейнтом в DDL таблицы. SQLite не умеет расширять CHECK
    // через ALTER, поэтому пересобираем таблицу: тот же DDL с новым списком,
    // копия данных и родные индексы. В старых БД scope добавлялся ALTER-ом без
    // CHECK — там пересборка не нужна и не запускается.
    const convDdl = ((await this.sql.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='conversations'`)) as { sql: string } | undefined)?.sql
    if (convDdl && /scope IN \([^)]*\)/.test(convDdl) && !/scope IN \([^)]*'images'/.test(convDdl)) {
      const newDdl = convDdl
        .replace(/scope IN \([^)]*\)/, `scope IN ('chat','kanban','make','images','console','playwright-reader','web-reader')`)
        .replace(/^CREATE TABLE ("conversations"|conversations)/, 'CREATE TABLE conversations_new')
      const convIndexes = (await this.sql.all(`SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='conversations' AND sql IS NOT NULL`)) as Array<{ sql: string }>
      await this.sql.exec('PRAGMA foreign_keys=OFF')
      await this.sql.transaction(async () => {
        await this.sql.exec(newDdl)
        await this.sql.exec(`INSERT INTO conversations_new SELECT * FROM conversations`)
        await this.sql.exec(`DROP TABLE conversations`)
        await this.sql.exec(`ALTER TABLE conversations_new RENAME TO conversations`)
        for (const { sql } of convIndexes) await this.sql.exec(sql)
      })
      await this.sql.exec('PRAGMA foreign_keys=ON')
    }
    if (!convCols.some((c) => c.name === 'status')) {
      await this.sql.exec(`ALTER TABLE conversations ADD COLUMN status TEXT NOT NULL DEFAULT 'developing'`)
    }
    // Триггеры ставим после всех миграций `conversations`: пересборка таблицы
    // (CHECK по scope) роняла бы их телом, ссылающимся на исчезнувшую таблицу.
    // Протухание ловим здесь, а не вызовами по коду: сообщения пишет десяток
    // мест (ход, правка, откат, импорт legacy), и любое забытое место давало бы
    // устаревшую цену в списке — ошибку, которую никто не заметит.
    await this.sql.exec(`
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
      await this.sql.exec(`
        UPDATE conversations
        SET exec_target = CASE WHEN exec_target = 'none' THEN exec_target ELSE NULL END,
            workdir = NULL
        WHERE assistant_kind = 'make'
          AND ((exec_target IS NOT NULL AND exec_target <> 'none') OR workdir IS NOT NULL)
      `)
    }
    // Проекты (итерация 2): папка на машину + машина по умолчанию.
    const projCols = (await this.sql.all(`PRAGMA table_info(projects)`)) as Array<{ name: string }>
    if (projCols.length && !projCols.some((c) => c.name === 'default_agent_id')) {
      await this.sql.exec(`ALTER TABLE projects ADD COLUMN default_agent_id TEXT`)
    }
    const memberCols = (await this.sql.all(`PRAGMA table_info(project_members)`)) as Array<{ name: string }>
    if (memberCols.length && !memberCols.some((c) => c.name === 'qa_permission')) {
      await this.sql.exec(`ALTER TABLE project_members ADD COLUMN qa_permission INTEGER NOT NULL DEFAULT 0`)
    }
    // Старые проекты могли хранить владельца только в projects.created_by.
    // PK project_members исключает дубли и сохраняет роли уже существующих участников.
    if (memberCols.length) {
      await this.sql.exec(`
        INSERT OR IGNORE INTO project_members (project_id, username, role, added_at)
        SELECT id, created_by, 'owner', created_at FROM projects
      `)
    }
    const pmCols = (await this.sql.all(`PRAGMA table_info(project_machines)`)) as Array<{ name: string }>
    if (pmCols.length && !pmCols.some((c) => c.name === 'path')) {
      await this.sql.exec(`ALTER TABLE project_machines ADD COLUMN path TEXT NOT NULL DEFAULT ''`)
    }
    // Корень рабочих копий переехал от Feature Run к CI-раннеру — только имя колонки.
    if (pmCols.length && pmCols.some((c) => c.name === 'feature_repos_root') && !pmCols.some((c) => c.name === 'repos_root')) {
      await this.sql.exec(`ALTER TABLE project_machines RENAME COLUMN feature_repos_root TO repos_root`)
    } else if (pmCols.length && !pmCols.some((c) => c.name === 'repos_root')) {
      await this.sql.exec(`ALTER TABLE project_machines ADD COLUMN repos_root TEXT NOT NULL DEFAULT ''`)
    }
    if (pmCols.length && !pmCols.some((c) => c.name === 'ssh_host')) {
      await this.sql.exec(`ALTER TABLE project_machines ADD COLUMN ssh_host TEXT NOT NULL DEFAULT ''`)
    }
    if (pmCols.length && !pmCols.some((c) => c.name === 'ssh_user')) {
      await this.sql.exec(`ALTER TABLE project_machines ADD COLUMN ssh_user TEXT NOT NULL DEFAULT ''`)
    }
    if (pmCols.length && !pmCols.some((c) => c.name === 'storage_id')) {
      await this.sql.exec(`ALTER TABLE project_machines ADD COLUMN storage_id TEXT`)
    }
    if (pmCols.length && !pmCols.some((c) => c.name === 'directories_json')) {
      await this.sql.exec(`ALTER TABLE project_machines ADD COLUMN directories_json TEXT NOT NULL DEFAULT ''`)
    }
    if (pmCols.length && !pmCols.some((c) => c.name === 'added_at')) {
      await this.sql.exec(`ALTER TABLE project_machines ADD COLUMN added_at INTEGER NOT NULL DEFAULT 0`)
    }
    if (pmCols.length && !pmCols.some((c) => c.name === 'added_by')) {
      await this.sql.exec(`ALTER TABLE project_machines ADD COLUMN added_by TEXT NOT NULL DEFAULT ''`)
    }
    for (const t of ['agent_tasks', 'feature_deployments', 'feature_events', 'features', 'repository_slots']) {
      await this.sql.exec(`DROP TABLE IF EXISTS ${t}`)
    }
    const taskCols = (await this.sql.all(`PRAGMA table_info(tasks)`)) as Array<{ name: string }>
    if (taskCols.length && !taskCols.some((c) => c.name === 'type')) await this.sql.exec(`ALTER TABLE tasks ADD COLUMN type TEXT NOT NULL DEFAULT 'task'`)
    if (taskCols.length && !taskCols.some((c) => c.name === 'parent_id')) await this.sql.exec(`ALTER TABLE tasks ADD COLUMN parent_id TEXT`)
    if (taskCols.length && !taskCols.some((c) => c.name === 'acceptance_criteria')) await this.sql.exec(`ALTER TABLE tasks ADD COLUMN acceptance_criteria TEXT NOT NULL DEFAULT ''`)
    // Старым карточкам автора не угадываем: NULL отображается как «Нет данных».
    if (taskCols.length && !taskCols.some((c) => c.name === 'created_by')) await this.sql.exec(`ALTER TABLE tasks ADD COLUMN created_by TEXT`)
    if (taskCols.length && !taskCols.some((c) => c.name === 'created_by_name')) await this.sql.exec(`ALTER TABLE tasks ADD COLUMN created_by_name TEXT`)
    // NULL у старых карточек сохраняет прежнее поведение: машина проекта по умолчанию.
    if (taskCols.length && !taskCols.some((c) => c.name === 'agent_id')) await this.sql.exec(`ALTER TABLE tasks ADD COLUMN agent_id TEXT`)
    if (taskCols.length && !taskCols.some((c) => c.name === 'labels')) await this.sql.exec(`ALTER TABLE tasks ADD COLUMN labels TEXT NOT NULL DEFAULT '[]'`)
    if (taskCols.length && !taskCols.some((c) => c.name === 'skills')) await this.sql.exec(`ALTER TABLE tasks ADD COLUMN skills TEXT NOT NULL DEFAULT '[]'`)

    if (taskCols.length && !taskCols.some((c) => c.name === 'story_points')) await this.sql.exec(`ALTER TABLE tasks ADD COLUMN story_points REAL`)
    if (taskCols.length && !taskCols.some((c) => c.name === 'due_date')) await this.sql.exec(`ALTER TABLE tasks ADD COLUMN due_date INTEGER`)
    if (taskCols.length && !taskCols.some((c) => c.name === 'flagged')) await this.sql.exec(`ALTER TABLE tasks ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0`)
    // Момент завершения задачи: отсчёт срока, после которого карточка уходит с
    // доски. Уже лежащим в done проставляем время последней правки — иначе они
    // остались бы на доске навсегда.
    if (taskCols.length && !taskCols.some((c) => c.name === 'done_at')) {
      await this.sql.exec(`ALTER TABLE tasks ADD COLUMN done_at INTEGER`)
      await this.sql.exec(`
        UPDATE tasks SET done_at = updated_at
        WHERE column_id IN (SELECT id FROM kanban_columns WHERE semantic_type = 'done')
      `)
    }
    if (taskCols.length && !taskCols.some((c) => c.name === 'preview_ready')) await this.sql.exec(`ALTER TABLE tasks ADD COLUMN preview_ready INTEGER NOT NULL DEFAULT 0`)
    if (taskCols.length && !taskCols.some((c) => c.name === 'seq')) {
      await this.sql.exec(`ALTER TABLE tasks ADD COLUMN seq INTEGER`)
      // Номер по порядку создания в проекте — как ключи PRJ-1, PRJ-2 в Jira.
      await this.sql.exec(`UPDATE tasks SET seq = (
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
      await this.sql.exec(`
        UPDATE conversations SET title = 'Задача ' || title
        WHERE task_id IS NOT NULL
          AND title NOT LIKE 'Задача %'
          AND title = (SELECT t.title FROM tasks t WHERE t.id = conversations.task_id)
      `)
    }
    // Счётчик ключей задач проекта: номера не переиспользуются (как в Jira).
    if (projCols.length && !projCols.some((c) => c.name === 'task_seq')) {
      await this.sql.exec(`ALTER TABLE projects ADD COLUMN task_seq INTEGER NOT NULL DEFAULT 0`)
      await this.sql.exec(`UPDATE projects SET task_seq = (SELECT COALESCE(MAX(seq), 0) FROM tasks WHERE tasks.project_id = projects.id)`)
    }
    const colCols = (await this.sql.all(`PRAGMA table_info(kanban_columns)`)) as Array<{ name: string }>
    if (colCols.length && !colCols.some((c) => c.name === 'semantic_type')) await this.sql.exec(`ALTER TABLE kanban_columns ADD COLUMN semantic_type TEXT NOT NULL DEFAULT 'custom'`)
    if (colCols.length && !colCols.some((c) => c.name === 'wip_limit')) await this.sql.exec(`ALTER TABLE kanban_columns ADD COLUMN wip_limit INTEGER`)
    // Старые доски имели To Do / In Progress / Done без стабильной семантики.
    // Сначала сохраняем их пользовательские названия, назначая базовые роли.
    await this.sql.exec(`
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
    await this.ctx.repos.projects.seedBuiltinProjectTypes()
    const projectTypeCols = (await this.sql.all(`PRAGMA table_info(projects)`)) as Array<{ name: string }>
    if (projectTypeCols.length && !projectTypeCols.some((c) => c.name === 'project_type_id')) {
      await this.sql.exec(`ALTER TABLE projects ADD COLUMN project_type_id TEXT REFERENCES project_types(id)`)
    }
    // Существующие проекты — на КОРЕНЬ «Разработка ПО», а не на «Веб-приложение»:
    // возможности у них совпадают (подтип наследует всё), поведение не меняется,
    // и мы не объявляем задним числом чужой бэкенд веб-проектом.
    await this.sql.run(`UPDATE projects SET project_type_id = ? WHERE project_type_id IS NULL OR project_type_id = ''`, [DEFAULT_PROJECT_TYPE_ID])

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
    await this.sql.transaction(async () => {
      const projectIds = (await this.sql.all(`SELECT id FROM projects ORDER BY created_at, id`)) as Array<{ id: string }>
      const loadColumns = async (projectId: string) => (await this.sql.all(`SELECT id, name, semantic_type, position, created_at FROM kanban_columns WHERE project_id=? ORDER BY position, created_at, id`, [projectId])) as WorkflowColumnRow[]
      const mergeColumns = async (projectId: string, targetId: string, sourceIds: string[]) => {
        if (!sourceIds.length) return
        const targetTasks = (await this.sql.all(`SELECT id FROM tasks WHERE project_id=? AND column_id=? ORDER BY position, created_at, id`, [projectId, targetId])) as WorkflowTaskRow[]
        const placeholders = sourceIds.map(() => '?').join(',')
        const sourceTasks = (await this.sql.all(`SELECT t.id FROM tasks t JOIN kanban_columns c ON c.id=t.column_id WHERE t.project_id=? AND t.column_id IN (${placeholders}) ORDER BY c.position, t.position, t.created_at, t.id`, [projectId, ...sourceIds])) as WorkflowTaskRow[]
        for (const [index, task] of [...targetTasks, ...sourceTasks].entries()) {
          await this.sql.run(`UPDATE tasks SET column_id=?, position=? WHERE id=?`, [targetId, (index + 1) * RANK_STEP, task.id])
        }
        await this.sql.run(`DELETE FROM kanban_columns WHERE project_id=? AND id IN (${placeholders})`, [projectId, ...sourceIds])
      }

      const typeOf = this.sql.prepare(`SELECT project_type_id FROM projects WHERE id = ?`)
      for (const { id: projectId } of projectIds) {
        // Обязательный набор колонок задаёт ТИП проекта. Раньше конвейер разработки
        // дописывался всем подряд, и у «Общего проекта» короткая доска не пережила
        // бы ни одного перезапуска сервера.
        const typeId = ((await typeOf.get(projectId)) as { project_type_id: string | null } | undefined)?.project_type_id || DEFAULT_PROJECT_TYPE_ID
        const typeColumns = (await this.ctx.repos.projects.projectTypeDefaults(typeId)).columns
        const requiredColumns: Array<[KanbanColumnSemanticType, string]> = typeColumns?.length
          ? typeColumns.map((column) => [column.semanticType, column.name])
          : workflowColumns
        let columns = (await loadColumns(projectId))
        // Сохранённая семантика (и тем самым id существующей системной колонки) —
        // основной признак. Только если её ещё нет, старую системную колонку можно
        // однократно узнать по точному legacy-заголовку, не двигая её карточки.
        if (!columns.some(column => column.semantic_type === 'cancelled')) {
          const legacyCancelled = columns.find(column => column.semantic_type === 'custom' && column.name === 'Отменены')
          if (legacyCancelled) {
            await this.sql.run(`UPDATE kanban_columns SET semantic_type='cancelled' WHERE id=?`, [legacyCancelled.id])
            columns = (await loadColumns(projectId))
          }
        }
        let nextPosition = Math.max(0, ...columns.map(column => column.position)) + RANK_STEP
        for (const [semantic, name] of requiredColumns) {
          if (columns.some(column => column.semantic_type === semantic)) continue
          await this.sql.run(`INSERT INTO kanban_columns (id, project_id, name, semantic_type, position, hidden, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`, [this.newId(), projectId, name, semantic, nextPosition, this.now()])
          nextPosition += RANK_STEP
          columns = (await loadColumns(projectId))
        }

        // Схлопываем дубликаты системных колонок, сохраняя первую по визуальному
        // порядку и добавляя карточки дублей после уже лежащих в ней.
        for (const [semantic] of workflowColumns) {
          const matches = columns.filter(column => column.semantic_type === semantic)
          if (matches.length > 1) {
            await mergeColumns(projectId, matches[0].id, matches.slice(1).map(column => column.id))
            columns = (await loadColumns(projectId))
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
            await mergeColumns(projectId, target.id, sources.map(column => column.id))
            columns = (await loadColumns(projectId))
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
            await this.sql.run(`UPDATE kanban_columns SET position=? WHERE id=?`, [position, column.id])
            position += RANK_STEP
          }
        }
      }
    })
    const featureProjectCols = (await this.sql.all(`PRAGMA table_info(projects)`)) as Array<{ name: string }>
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'preview_url')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN preview_url TEXT`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'test_users_json')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN test_users_json TEXT`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'commit_policy')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN commit_policy TEXT NOT NULL DEFAULT 'agent_commits'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'merge_transport')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN merge_transport TEXT NOT NULL DEFAULT 'local'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'agent_plan_approval_mode')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN agent_plan_approval_mode TEXT NOT NULL DEFAULT 'manual'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'command_policy')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN command_policy TEXT NOT NULL DEFAULT ''`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'test_command')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN test_command TEXT NOT NULL DEFAULT ''`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'component_qa_command')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN component_qa_command TEXT NOT NULL DEFAULT ''`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'integration_test_command')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN integration_test_command TEXT NOT NULL DEFAULT ''`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'production_deploy_command')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN production_deploy_command TEXT NOT NULL DEFAULT ''`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'production_agent_id')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN production_agent_id TEXT`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'production_environment_mode')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN production_environment_mode TEXT NOT NULL DEFAULT 'legacy'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'production_checkout_path')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN production_checkout_path TEXT NOT NULL DEFAULT ''`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'production_health_check_command')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN production_health_check_command TEXT NOT NULL DEFAULT ''`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'release_timeouts_json')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN release_timeouts_json TEXT NOT NULL DEFAULT '{}'`)
    const qaSessionCols = (await this.sql.all(`PRAGMA table_info(qa_sessions)`)) as Array<{ name: string }>
    if (qaSessionCols.length && !qaSessionCols.some(c => c.name === 'additional_issues')) await this.sql.exec(`ALTER TABLE qa_sessions ADD COLUMN additional_issues TEXT NOT NULL DEFAULT ''`)
    if (qaSessionCols.length && !qaSessionCols.some(c => c.name === 'linked_fix_run_id')) await this.sql.exec(`ALTER TABLE qa_sessions ADD COLUMN linked_fix_run_id TEXT`)
    const releaseCols = (await this.sql.all(`PRAGMA table_info(project_releases)`)) as Array<{ name: string }>
    if (releaseCols.length && !releaseCols.some(c=>c.name==='agent_id')) await this.sql.exec(`ALTER TABLE project_releases ADD COLUMN agent_id TEXT`)
    if (releaseCols.length && !releaseCols.some(c=>c.name==='checkout_path')) await this.sql.exec(`ALTER TABLE project_releases ADD COLUMN checkout_path TEXT`)
    if (releaseCols.length && !releaseCols.some(c=>c.name==='deleted_at')) await this.sql.exec(`ALTER TABLE project_releases ADD COLUMN deleted_at INTEGER`)
    const releaseStepCols = (await this.sql.all(`PRAGMA table_info(project_release_steps)`)) as Array<{ name: string }>
    if (releaseStepCols.length && !releaseStepCols.some(c=>c.name==='limit_ms')) await this.sql.exec(`ALTER TABLE project_release_steps ADD COLUMN limit_ms INTEGER`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'default_skills_epic')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN default_skills_epic TEXT NOT NULL DEFAULT '[]'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'default_skills_story')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN default_skills_story TEXT NOT NULL DEFAULT '[]'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'default_skills_task')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN default_skills_task TEXT NOT NULL DEFAULT '[]'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'ci_base_branch')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN ci_base_branch TEXT NOT NULL DEFAULT 'main'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'ci_branch_template')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN ci_branch_template TEXT NOT NULL DEFAULT '{task_number}'`)
    // Нормализация двух исторических дефолтов шаблона ветки — **разовая**: сами
    // значения `feature/{task_number}` человек вправе выставить осознанно, и
    // повторный прогон молча откатывал бы его настройку при каждом старте сервера.
    // Условие по `featureProjectCols` здесь не нужно и было бы вредно: это снимок
    // PRAGMA до ALTER выше, на свежей базе он колонки не видит — отметка о разовой
    // миграции не ставилась бы, и нормализация срабатывала бы на втором открытии,
    // уже поверх пользовательского значения. После ALTER колонка есть всегда.
    await this.runOnce('migration.ciBranchTemplate.normalized', async () => {
      await this.sql.run(`UPDATE projects SET ci_branch_template='{task_number}' WHERE ci_branch_template IN ('feature/{task_number}', 'feature/{task_number}-{slug}')`)
    })
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'ci_reuse_strategy')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN ci_reuse_strategy TEXT NOT NULL DEFAULT 'fail'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'ci_exec_auth_ref')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN ci_exec_auth_ref TEXT NOT NULL DEFAULT ''`)
    // Режим базы знаний в ходах модели CI-рана: настройка проекта, не чата.
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'ci_kb_context_mode')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN ci_kb_context_mode TEXT NOT NULL DEFAULT 'auto'`)
    // Старые cleanup уже удалили клоны, но связанные чаты остались в их путях.
    // Сбрасываем только чаты задач с released workspace: активные и сохранённые
    // после ошибки рабочие копии остаются доступными для разбора.
    await this.sql.exec(`
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
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'done_retention_days')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN done_retention_days INTEGER DEFAULT ${DEFAULT_DONE_RETENTION_DAYS}`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'ci_test_fix_cycle_limit')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN ci_test_fix_cycle_limit INTEGER NOT NULL DEFAULT 10`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'automated_qa_command')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN automated_qa_command TEXT NOT NULL DEFAULT 'npm test'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'automated_qa_mode')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN automated_qa_mode TEXT NOT NULL DEFAULT 'command'`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'automated_qa_scenario_json')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN automated_qa_scenario_json TEXT NOT NULL DEFAULT ''`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'autopilot_default')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN autopilot_default INTEGER NOT NULL DEFAULT 0`)
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'autopilot_requires_manual_qa')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN autopilot_requires_manual_qa INTEGER NOT NULL DEFAULT 0`)
    if (taskLinkCols.length && !taskLinkCols.some((column) => column.name === 'auto_pilot_requires_manual_qa')) {
      await this.sql.exec(`ALTER TABLE tasks ADD COLUMN auto_pilot_requires_manual_qa INTEGER NOT NULL DEFAULT 0`)
      // Preserve existing pauses during migration; subsequent changes belong to each task.
      await this.sql.exec(`UPDATE tasks SET auto_pilot_requires_manual_qa = COALESCE((SELECT autopilot_requires_manual_qa FROM projects WHERE projects.id = tasks.project_id), 0)`)
    }
    if (featureProjectCols.length && !featureProjectCols.some((c) => c.name === 'autopilot_fix_limit')) await this.sql.exec(`ALTER TABLE projects ADD COLUMN autopilot_fix_limit INTEGER NOT NULL DEFAULT 3`)
    const ciWorkspaceCols = (await this.sql.all(`PRAGMA table_info(ci_workspaces)`)) as Array<{ name: string }>
    if (ciWorkspaceCols.length && !ciWorkspaceCols.some((c) => c.name === 'branch')) await this.sql.exec(`ALTER TABLE ci_workspaces ADD COLUMN branch TEXT`)
    if (ciWorkspaceCols.length && !ciWorkspaceCols.some((c) => c.name === 'commit_sha')) await this.sql.exec(`ALTER TABLE ci_workspaces ADD COLUMN commit_sha TEXT`)
    if (ciWorkspaceCols.length && !ciWorkspaceCols.some((c) => c.name === 'pushed')) await this.sql.exec(`ALTER TABLE ci_workspaces ADD COLUMN pushed INTEGER NOT NULL DEFAULT 0`)
    if (ciWorkspaceCols.length && !ciWorkspaceCols.some((c) => c.name === 'npm_cache_dir')) await this.sql.exec(`ALTER TABLE ci_workspaces ADD COLUMN npm_cache_dir TEXT`)
    const mergeRunCols = (await this.sql.all(`PRAGMA table_info(merge_runs)`)) as Array<{ name: string }>
    if (mergeRunCols.length) {
      await this.sql.exec(`DROP INDEX IF EXISTS idx_merge_runs_one_active_task`)
      await this.sql.exec(`CREATE UNIQUE INDEX idx_merge_runs_one_active_task ON merge_runs(task_id) WHERE status IN ('queued','checking','fetching','merging','resolving_conflicts','kb_update','testing','pushing')`)
    }
    if (mergeRunCols.length && !mergeRunCols.some((c) => c.name === 'stages_json')) await this.sql.exec(`ALTER TABLE merge_runs ADD COLUMN stages_json TEXT NOT NULL DEFAULT '[]'`)
    if (mergeRunCols.length && !mergeRunCols.some((c) => c.name === 'checks_json')) await this.sql.exec(`ALTER TABLE merge_runs ADD COLUMN checks_json TEXT NOT NULL DEFAULT '[]'`)
    if (mergeRunCols.length && !mergeRunCols.some((c) => c.name === 'recommended_action')) await this.sql.exec(`ALTER TABLE merge_runs ADD COLUMN recommended_action TEXT`)
    if (mergeRunCols.length && !mergeRunCols.some((c) => c.name === 'push_started_at')) await this.sql.exec(`ALTER TABLE merge_runs ADD COLUMN push_started_at INTEGER`)
    if (mergeRunCols.length && !mergeRunCols.some((c) => c.name === 'requested_llm_provider')) await this.sql.exec(`ALTER TABLE merge_runs ADD COLUMN requested_llm_provider TEXT`)
    if (mergeRunCols.length && !mergeRunCols.some((c) => c.name === 'requested_llm_model')) await this.sql.exec(`ALTER TABLE merge_runs ADD COLUMN requested_llm_model TEXT`)
    if (mergeRunCols.length && !mergeRunCols.some((c) => c.name === 'llm_fallback_reason')) await this.sql.exec(`ALTER TABLE merge_runs ADD COLUMN llm_fallback_reason TEXT`)
    const ciRunCols = (await this.sql.all(`PRAGMA table_info(ci_runs)`)) as Array<{ name: string }>
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'error')) await this.sql.exec(`ALTER TABLE ci_runs ADD COLUMN error TEXT`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'run_column_id')) await this.sql.exec(`ALTER TABLE ci_runs ADD COLUMN run_column_id TEXT`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'terminal_column_id')) await this.sql.exec(`ALTER TABLE ci_runs ADD COLUMN terminal_column_id TEXT`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'agent_owner_id')) await this.sql.exec(`ALTER TABLE ci_runs ADD COLUMN agent_owner_id TEXT`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'agent_owner_name')) await this.sql.exec(`ALTER TABLE ci_runs ADD COLUMN agent_owner_name TEXT`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'agent_selection_source')) await this.sql.exec(`ALTER TABLE ci_runs ADD COLUMN agent_selection_source TEXT`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'llm_engine_id')) await this.sql.exec(`ALTER TABLE ci_runs ADD COLUMN llm_engine_id TEXT`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'llm_provider')) await this.sql.exec(`ALTER TABLE ci_runs ADD COLUMN llm_provider TEXT NOT NULL DEFAULT 'claude'`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'llm_model')) await this.sql.exec(`ALTER TABLE ci_runs ADD COLUMN llm_model TEXT NOT NULL DEFAULT '${DEFAULT_CI_CLAUDE_MODEL}'`)
    // Режим запуска (план/разработка), глубина уточнений и связанный чат рана.
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'mode')) await this.sql.exec(`ALTER TABLE ci_runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'development'`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'clarify_level')) await this.sql.exec(`ALTER TABLE ci_runs ADD COLUMN clarify_level TEXT NOT NULL DEFAULT 'few'`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'clarify_max')) await this.sql.exec(`ALTER TABLE ci_runs ADD COLUMN clarify_max INTEGER NOT NULL DEFAULT 3`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'conversation_id')) await this.sql.exec(`ALTER TABLE ci_runs ADD COLUMN conversation_id TEXT`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'model_session_id')) await this.sql.exec(`ALTER TABLE ci_runs ADD COLUMN model_session_id TEXT`)
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'fix_context_json')) await this.sql.exec(`ALTER TABLE ci_runs ADD COLUMN fix_context_json TEXT`)
    const ciFixCols = (await this.sql.all(`PRAGMA table_info(ci_fix_attempts)`)) as Array<{ name: string }>
    if (ciFixCols.length && !ciFixCols.some((c) => c.name === 'changed_files_json')) await this.sql.exec(`ALTER TABLE ci_fix_attempts ADD COLUMN changed_files_json TEXT NOT NULL DEFAULT '[]'`)
    if (ciFixCols.length && !ciFixCols.some((c) => c.name === 'targeted_tests_json')) await this.sql.exec(`ALTER TABLE ci_fix_attempts ADD COLUMN targeted_tests_json TEXT NOT NULL DEFAULT '[]'`)
    if (ciFixCols.length && !ciFixCols.some((c) => c.name === 'full_rerun_json')) await this.sql.exec(`ALTER TABLE ci_fix_attempts ADD COLUMN full_rerun_json TEXT`)
    if (ciFixCols.length && !ciFixCols.some((c) => c.name === 'failures_json')) await this.sql.exec(`ALTER TABLE ci_fix_attempts ADD COLUMN failures_json TEXT NOT NULL DEFAULT '[]'`)
    // Режим базы знаний рана — снимок настройки проекта на момент старта.
    if (ciRunCols.length && !ciRunCols.some((c) => c.name === 'kb_context_mode')) await this.sql.exec(`ALTER TABLE ci_runs ADD COLUMN kb_context_mode TEXT NOT NULL DEFAULT 'auto'`)
    const ciLlmCols = (await this.sql.all(`PRAGMA table_info(ci_llm_configs)`)) as Array<{ name: string }>
    if (ciLlmCols.length && !ciLlmCols.some((c) => c.name === 'llm_engine_id')) await this.sql.exec(`ALTER TABLE ci_llm_configs ADD COLUMN llm_engine_id TEXT`)
    if (ciLlmCols.length && !ciLlmCols.some((c) => c.name === 'mode')) await this.sql.exec(`ALTER TABLE ci_llm_configs ADD COLUMN mode TEXT NOT NULL DEFAULT 'development'`)
    if (ciLlmCols.length && !ciLlmCols.some((c) => c.name === 'clarify_level')) await this.sql.exec(`ALTER TABLE ci_llm_configs ADD COLUMN clarify_level TEXT NOT NULL DEFAULT 'few'`)
    if (ciLlmCols.length && !ciLlmCols.some((c) => c.name === 'clarify_max')) await this.sql.exec(`ALTER TABLE ci_llm_configs ADD COLUMN clarify_max INTEGER NOT NULL DEFAULT 3`)
    const ciCmdCols = (await this.sql.all(`PRAGMA table_info(ci_commands)`)) as Array<{ name: string }>
    if (ciCmdCols.length && !ciCmdCols.some((c) => c.name === 'builtin')) await this.sql.exec(`ALTER TABLE ci_commands ADD COLUMN builtin TEXT`)
    // Обязательный системный commit-step хранится в данных. Старый сокращённый
    // скрипт (`git add -A`) оставлял ветку/коммит на усмотрение fix-модели, поэтому
    // обновляем запись по её стабильному имени; условие сохраняет идемпотентность.
    await this.sql.run(`UPDATE ci_commands
      SET script = ?, version = version + 1, updated_at = ?
      WHERE name = ? AND deleted_at IS NULL AND script <> ?`, [TASK_COMMIT_COMMAND_SCRIPT, Date.now(), TASK_COMMIT_COMMAND_NAME, TASK_COMMIT_COMMAND_SCRIPT])
    if (ciCmdCols.length && !ciCmdCols.some((c) => c.name === 'is_test')) {
      await this.sql.exec(`ALTER TABLE ci_commands ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0`)
      // Бэкфилл: гейт в уже заведённых справочниках помечаем сами — иначе после
      // обновления модель по-прежнему видит «Запустить тестирование» инструментом
      // и прогоняет тесты до шага воркфлоу.
      const rows = (await this.sql.all(`SELECT id, name, script FROM ci_commands`)) as Array<{ id: string; name: string; script: string }>
      const mark = this.sql.prepare(`UPDATE ci_commands SET is_test = 1, available_to_model = 0 WHERE id = ?`)
      for (const r of rows) if (isVerificationCommand(r)) await mark.run(r.id)
    }
    // Стандартный гейт живёт в данных справочника. Переводим только его точный
    // прежний текст, не затрагивая пользовательские команды с другим скриптом.
    await this.sql.run(`UPDATE ci_commands
      SET script = 'npm run affected-check', is_test = 1, available_to_model = 1,
          version = version + 1, updated_at = ?
      WHERE script = 'npm run typecheck && npm test'`, [Date.now()])
    await this.sql.run(`UPDATE ci_commands SET available_to_model = 1
      WHERE script = 'npm run affected-check' AND available_to_model = 0`)
    await this.sql.run(`UPDATE ci_commands
      SET allow_failure = 0,
          description = 'Модель дописывает в базу знаний, что изменилось в этом ране: темы docs/kb/*.md в рабочей копии и статьи раздела проекта. Ошибка шага останавливает ран.'
      WHERE id = ?`, [CI_KB_UPDATE_COMMAND_ID])
    // Семантика входных токенов строки расхода. Старые строки остаются с NULL:
    // у codex это «вход вместе с кэшем», и отчёт приводит их на чтении.
    const ciUsageCols = (await this.sql.all(`PRAGMA table_info(ci_run_usage)`)) as Array<{ name: string }>
    if (ciUsageCols.length && !ciUsageCols.some((c) => c.name === 'input_semantics')) await this.sql.exec(`ALTER TABLE ci_run_usage ADD COLUMN input_semantics TEXT`)
    const ciSettingsCols = (await this.sql.all(`PRAGMA table_info(ci_settings)`)) as Array<{ name: string }>
    if (ciSettingsCols.length && !ciSettingsCols.some((c) => c.name === 'interaction_wait_ms')) await this.sql.exec(`ALTER TABLE ci_settings ADD COLUMN interaction_wait_ms INTEGER NOT NULL DEFAULT 1800000`)
    if (ciSettingsCols.length && !ciSettingsCols.some((c) => c.name === 'stage_models')) await this.sql.exec(`ALTER TABLE ci_settings ADD COLUMN stage_models TEXT`)
    // Увеличиваем втрое только прежний полный набор дефолтных предохранителей.
    // Любая вручную изменённая настройка сохраняется без вмешательства.
    await this.sql.exec(`UPDATE ci_settings
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
        await this.sql.exec(`ALTER TABLE ci_settings ADD COLUMN ${column} INTEGER NOT NULL DEFAULT ${fallback}`)
      }
    }
    const ciToolCallCols = (await this.sql.all(`PRAGMA table_info(ci_run_tool_calls)`)) as Array<{ name: string }>
    if (ciToolCallCols.length && !ciToolCallCols.some((c) => c.name === 'chars')) await this.sql.exec(`ALTER TABLE ci_run_tool_calls ADD COLUMN chars INTEGER NOT NULL DEFAULT 0`)
    // Снимок сценария Playwright-этапа (круг 8): старые раны его не имеют и
    // читают сценарий проекта — фолбэк в automatedQaExecutionContext.
    const qaStageCols = (await this.sql.all(`PRAGMA table_info(qa_stage_runs)`)) as Array<{ name: string }>
    if (qaStageCols.length && !qaStageCols.some((c) => c.name === 'scenario_json')) await this.sql.exec(`ALTER TABLE qa_stage_runs ADD COLUMN scenario_json TEXT NOT NULL DEFAULT ''`)
    const qaPreparationCols = (await this.sql.all(`PRAGMA table_info(qa_preparation_runs)`)) as Array<{ name: string }>
    if (qaPreparationCols.length && !qaPreparationCols.some((c) => c.name === 'attempt')) await this.sql.exec(`ALTER TABLE qa_preparation_runs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1`)
    if (qaPreparationCols.length && !qaPreparationCols.some((c) => c.name === 'diagnostics_json')) await this.sql.exec(`ALTER TABLE qa_preparation_runs ADD COLUMN diagnostics_json TEXT NOT NULL DEFAULT '[]'`)

    // Привязка обращения к БЗ к рану и шагу CI: отчёты по ране/задаче строятся
    // по ним, а старые строки просто остаются с NULL (это обращения из чата).
    const kbUsageCols = (await this.sql.all(`PRAGMA table_info(kb_usage_queries)`)) as Array<{ name: string }>
    if (kbUsageCols.length && !kbUsageCols.some((c) => c.name === 'ci_run_id')) await this.sql.exec(`ALTER TABLE kb_usage_queries ADD COLUMN ci_run_id TEXT`)
    if (kbUsageCols.length && !kbUsageCols.some((c) => c.name === 'ci_step_id')) await this.sql.exec(`ALTER TABLE kb_usage_queries ADD COLUMN ci_step_id TEXT`)
    if (kbUsageCols.length) await this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_kb_usage_ci_run ON kb_usage_queries(ci_run_id, created_at DESC)`)
    const kbSectionCols = (await this.sql.all(`PRAGMA table_info(kb_usage_sections)`)) as Array<{ name: string }>
    if (kbSectionCols.length && !kbSectionCols.some((c) => c.name === 'related_files')) await this.sql.exec(`ALTER TABLE kb_usage_sections ADD COLUMN related_files TEXT NOT NULL DEFAULT '[]'`)

    const llmEngineCols = (await this.sql.all(`PRAGMA table_info(llm_engines)`)) as Array<{ name: string }>
    if (llmEngineCols.length && !llmEngineCols.some((c) => c.name === 'token')) await this.sql.exec(`ALTER TABLE llm_engines ADD COLUMN token TEXT NOT NULL DEFAULT ''`)
    if (llmEngineCols.length && !llmEngineCols.some((c) => c.name === 'enabled')) await this.sql.exec(`ALTER TABLE llm_engines ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1`)
    if (llmEngineCols.length && !llmEngineCols.some((c) => c.name === 'allowed_roles')) await this.sql.exec(`ALTER TABLE llm_engines ADD COLUMN allowed_roles TEXT NOT NULL DEFAULT '[\"admin\",\"developer\",\"tester\",\"observer\"]'`)
    if (llmEngineCols.length && !llmEngineCols.some((c) => c.name === 'is_default')) await this.sql.exec(`ALTER TABLE llm_engines ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0`)
    if (llmEngineCols.length && !llmEngineCols.some((c) => c.name === 'created_at')) await this.sql.exec(`ALTER TABLE llm_engines ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0`)
    if (llmEngineCols.length) {
      await this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_llm_engines_kind_enabled ON llm_engines(kind, enabled, created_at)`)
      await this.sql.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_engines_default_kind ON llm_engines(kind) WHERE is_default = 1`)
    }

    const msgCols = (await this.sql.all(`PRAGMA table_info(messages)`)) as Array<{ name: string }>
    if (!msgCols.some((c) => c.name === 'engine')) {
      await this.sql.exec(`ALTER TABLE messages ADD COLUMN engine TEXT`)
    }
    if (!msgCols.some((c) => c.name === 'meta')) {
      await this.sql.exec(`ALTER TABLE messages ADD COLUMN meta TEXT`)
    }
    if (!msgCols.some((c) => c.name === 'exec_target')) {
      await this.sql.exec(`ALTER TABLE messages ADD COLUMN exec_target TEXT`)
    }
    if (!msgCols.some((c) => c.name === 'attachments')) {
      await this.sql.exec(`ALTER TABLE messages ADD COLUMN attachments TEXT`)
    }
    if (!msgCols.some((c) => c.name === 'state')) {
      await this.sql.exec(`ALTER TABLE messages ADD COLUMN state TEXT NOT NULL DEFAULT 'published'`)
    }
    if (!msgCols.some((c) => c.name === 'history_position')) {
      await this.sql.exec(`ALTER TABLE messages ADD COLUMN history_position INTEGER`)
      await this.sql.exec(`UPDATE messages SET history_position = rowid WHERE state = 'published'`)
    }
    await this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_messages_history ON messages(conversation_id, state, history_position)`)
    // Ответ агента наследует цель ближайшей пользовательской реплики того же разговора.
    // Заполняет сообщения, созданные до сохранения exec_target у AI-ответов.
    await this.sql.exec(`
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
    await this.sql.exec(`DELETE FROM conversations WHERE user_id IS NULL`) // messages/speakers — по CASCADE
    await this.sql.exec(`DELETE FROM agents WHERE user_id IS NULL`)
    // Одноразово удаляем только старые ручные черновики с полностью дефолтными
    // полями. Любая настройка, проект, служебный тип, задача или CLI-сессия
    // делает строку неоднозначной и сохраняет её.
    const cleanup = await this.sql.run(`INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES ('cleanup-empty-manual-drafts-v1', ?)`, [Date.now()])
    if (cleanup.changes) {
      await this.sql.exec(`
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

  async close(): Promise<void> {
    if (this.closed) return
    // Не закрывать соединение под ногами у миграций и вызовов, поставленных в полосу без await:
    // раньше они выполнялись синхронно при вызове, и код вокруг на это полагается.
    await this.ready.catch(() => {})
    await this.lane?.idle()
    if (this.closed) return
    this.closed = true
    if (this.ctx.repos.chat.ftsTimer) clearTimeout(this.ctx.repos.chat.ftsTimer)
    this.ctx.repos.chat.ftsTimer = null
    if (this.dropSchemaOnClose) await this.sql.exec(`DROP SCHEMA IF EXISTS ${this.dropSchemaOnClose} CASCADE`).catch(() => {})
    await this.sql.close()
  }
}

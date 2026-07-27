import Database from 'better-sqlite3'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { SCHEMA_SQL } from './schema'
import {
  DEFAULT_SETTINGS,
  DEFAULT_AGENT_POLICY,
  type AgentCreated,
  type AgentPolicy,
  type Conversation,
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
  type TaskPriority
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
  position: number
  hidden: number
  created_at: number
}

interface TaskRow {
  id: string
  project_id: string
  column_id: string
  title: string
  description: string
  priority: string
  assignee: string | null
  position: number
  created_at: number
  updated_at: number
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

function mapColumn(r: ColumnRow): KanbanColumn {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    position: r.position,
    hidden: r.hidden !== 0,
    createdAt: r.created_at
  }
}

function mapTask(r: TaskRow): Task {
  return {
    id: r.id,
    projectId: r.project_id,
    columnId: r.column_id,
    title: r.title,
    description: r.description,
    priority: normPriority(r.priority),
    assignee: r.assignee,
    position: r.position,
    createdAt: r.created_at,
    updatedAt: r.updated_at
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
    return { id, title, createdAt: ts, updatedAt: ts, messageCount: 0, claudeSessionId: null, execTarget: null, workdir: null, skillNames: [], llmProvider: null, llmModel: null, permissionMode: null, lastExecTarget: null }
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

  clearConversationExecTargetForAgent(userId: string, agentId: string): void {
    this.db
      .prepare(`UPDATE conversations SET exec_target = NULL WHERE user_id = ? AND exec_target = ?`)
      .run(userId, agentId)
  }

  deleteConversation(userId: string, id: string): void {
    // ON DELETE CASCADE удалит сообщения и спикеров.
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
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      role: myRole === 'owner' ? 'owner' : 'member'
    }
  }

  /** Создаёт проект: владелец-участник + дефолтные колонки (в одной транзакции). */
  createProject(
    userId: string,
    args: { name: string; description?: string; gitUrl?: string; technologies?: string[]; skills?: string[] }
  ): ProjectDetail {
    const id = this.newId()
    const ts = this.now()
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO projects (id, name, description, git_url, technologies, skills, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
          ts
        )
      this.db
        .prepare(`INSERT INTO project_members (project_id, username, role, added_at) VALUES (?, ?, 'owner', ?)`)
        .run(id, userId, ts)
      const insCol = this.db.prepare(
        `INSERT INTO kanban_columns (id, project_id, name, position, hidden, created_at) VALUES (?, ?, ?, ?, 0, ?)`
      )
      ;['To Do', 'In Progress', 'Done'].forEach((name, i) =>
        insCol.run(this.newId(), id, name, (i + 1) * RANK_STEP, ts)
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
    const machineIds = (
      this.db.prepare(`SELECT agent_id FROM project_machines WHERE project_id = ?`).all(id) as Array<{
        agent_id: string
      }>
    ).map((x) => x.agent_id)
    return { ...this.mapProjectSummary(row, row.my_role), members, machineIds }
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
      .prepare(`INSERT OR IGNORE INTO project_machines (project_id, agent_id) VALUES (?, ?)`)
      .run(id, agentId)
    return this.getProject(userId, id)
  }

  unlinkMachine(userId: string, id: string, agentId: string): ProjectDetail | null {
    if (!this.isProjectOwner(userId, id)) return null
    this.db.prepare(`DELETE FROM project_machines WHERE project_id = ? AND agent_id = ?`).run(id, agentId)
    return this.getProject(userId, id)
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
        .prepare(`SELECT * FROM tasks WHERE project_id = ? ORDER BY column_id ASC, position ASC`)
        .all(projectId) as TaskRow[]
    ).map(mapTask)
    return { columns, tasks }
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
    return mapColumn({ id, project_id: projectId, name, position, hidden: 0, created_at: ts })
  }

  renameColumn(userId: string, projectId: string, columnId: string, name: string): boolean {
    if (!this.isProjectMember(userId, projectId) || !this.columnInProject(projectId, columnId)) return false
    this.db.prepare(`UPDATE kanban_columns SET name = ? WHERE id = ? AND project_id = ?`).run(name, columnId, projectId)
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
    // CASCADE удалит задачи колонки.
    const info = this.db.prepare(`DELETE FROM kanban_columns WHERE id = ? AND project_id = ?`).run(columnId, projectId)
    if (info.changes) this.touchProject(projectId)
    return info.changes > 0
  }

  createTask(
    userId: string,
    projectId: string,
    args: {
      columnId: string
      title: string
      description?: string
      priority?: TaskPriority
      assignee?: string | null
    }
  ): Task | null {
    if (!this.isProjectMember(userId, projectId)) return null
    if (!this.columnInProject(projectId, args.columnId)) return null
    if (args.assignee != null && !this.isProjectMember(args.assignee, projectId)) {
      throw new Error('Исполнитель не участник проекта')
    }
    const id = this.newId()
    const ts = this.now()
    const max = (
      this.db
        .prepare(`SELECT MAX(position) AS m FROM tasks WHERE project_id = ? AND column_id = ?`)
        .get(projectId, args.columnId) as { m: number | null }
    ).m
    const position = (max ?? 0) + RANK_STEP
    this.db
      .prepare(
        `INSERT INTO tasks (id, project_id, column_id, title, description, priority, assignee, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        projectId,
        args.columnId,
        args.title,
        args.description ?? '',
        normPriority(args.priority ?? 'medium'),
        args.assignee ?? null,
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
    fields: { title?: string; description?: string; priority?: TaskPriority; assignee?: string | null }
  ): Task | null {
    if (!this.isProjectMember(userId, projectId)) return null
    const current = this.getTask(projectId, taskId)
    if (!current) return null
    if (fields.assignee != null && !this.isProjectMember(fields.assignee, projectId)) {
      throw new Error('Исполнитель не участник проекта')
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
    if (fields.priority !== undefined) {
      set.push('priority = ?')
      vals.push(normPriority(fields.priority))
    }
    if (fields.assignee !== undefined) {
      set.push('assignee = ?')
      vals.push(fields.assignee)
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
    const info = this.db.prepare(`DELETE FROM tasks WHERE id = ? AND project_id = ?`).run(taskId, projectId)
    if (info.changes) this.touchProject(projectId)
    return info.changes > 0
  }
}

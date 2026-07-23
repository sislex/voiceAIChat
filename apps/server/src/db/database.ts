import Database from 'better-sqlite3'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { SCHEMA_SQL } from './schema'
import {
  DEFAULT_SETTINGS,
  DEFAULT_AGENT_POLICY,
  type AgentCreated,
  type AgentPolicy,
  type Conversation,
  type LlmProvider,
  type Message,
  type MessageRole,
  type Settings,
  type TurnMeta
} from '@voicechat/shared'

/** Инъектируемые зависимости — для детерминированных тестов. */
export interface DbDeps {
  /** Генератор id (по умолчанию crypto.randomUUID). */
  newId?: () => string
  /** Источник текущего времени в мс (по умолчанию Date.now). */
  now?: () => number
}

const SETTINGS_KEY = 'app'

interface ConversationRow {
  id: string
  title: string
  created_at: number
  updated_at: number
  claude_session_id: string | null
}

interface AgentRow {
  id: string
  name: string
  token_hash: string
  created_at: number
  last_seen: number | null
  policy: string | null
}

/** Запись машины-агента из БД (онлайн-статус добавляется реестром). */
export interface AgentRecord {
  id: string
  name: string
  createdAt: number
  lastSeen: number | null
  policy: AgentPolicy
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
    const msgCols = this.db.prepare(`PRAGMA table_info(messages)`).all() as Array<{ name: string }>
    if (!msgCols.some((c) => c.name === 'engine')) {
      this.db.exec(`ALTER TABLE messages ADD COLUMN engine TEXT`)
    }
    if (!msgCols.some((c) => c.name === 'meta')) {
      this.db.exec(`ALTER TABLE messages ADD COLUMN meta TEXT`)
    }
  }

  close(): void {
    this.db.close()
  }

  // ---- Conversations ----------------------------------------------------

  createConversation(title = 'Новый разговор'): Conversation {
    const id = this.newId()
    const ts = this.now()
    this.db
      .prepare(
        `INSERT INTO conversations (id, title, created_at, updated_at, claude_session_id)
         VALUES (?, ?, ?, ?, NULL)`
      )
      .run(id, title, ts, ts)
    return { id, title, createdAt: ts, updatedAt: ts, messageCount: 0, claudeSessionId: null }
  }

  listConversations(): Conversation[] {
    const rows = this.db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
         FROM conversations c
         ORDER BY c.updated_at DESC`
      )
      .all() as Array<ConversationRow & { message_count: number }>
    return rows.map((r) => this.mapConversation(r, r.message_count))
  }

  getConversation(id: string): Conversation | null {
    const row = this.db
      .prepare(`SELECT * FROM conversations WHERE id = ?`)
      .get(id) as ConversationRow | undefined
    if (!row) return null
    const count = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?`).get(id) as {
        n: number
      }
    ).n
    return this.mapConversation(row, count)
  }

  /** Поиск по названию разговора и тексту его сообщений (регистронезависимо). */
  searchConversations(query: string): Conversation[] {
    const q = query.trim()
    if (!q) return this.listConversations()
    const like = `%${q.toLowerCase().replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`
    const rows = this.db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
         FROM conversations c
         WHERE ulower(c.title) LIKE ? ESCAPE '\\'
            OR EXISTS (SELECT 1 FROM messages m
                       WHERE m.conversation_id = c.id AND ulower(m.text) LIKE ? ESCAPE '\\')
         ORDER BY c.updated_at DESC`
      )
      .all(like, like) as Array<ConversationRow & { message_count: number }>
    return rows.map((r) => this.mapConversation(r, r.message_count))
  }

  renameConversation(id: string, title: string): void {
    this.db
      .prepare(`UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?`)
      .run(title, this.now(), id)
  }

  deleteConversation(id: string): void {
    // ON DELETE CASCADE удалит сообщения и спикеров.
    this.db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id)
  }

  setClaudeSession(id: string, sessionId: string | null): void {
    this.db
      .prepare(`UPDATE conversations SET claude_session_id = ? WHERE id = ?`)
      .run(sessionId, id)
  }

  // ---- Messages ---------------------------------------------------------

  addMessage(
    conversationId: string,
    role: MessageRole,
    text: string,
    time: string,
    engine?: LlmProvider,
    meta?: TurnMeta
  ): Message {
    const id = this.newId()
    const createdAt = this.now()
    const insert = this.db.prepare(
      `INSERT INTO messages (id, conversation_id, role, text, time, created_at, engine, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const touch = this.db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`)
    const metaJson = meta && Object.keys(meta).length > 0 ? JSON.stringify(meta) : null
    this.db.transaction(() => {
      insert.run(id, conversationId, role, text, time, createdAt, engine ?? null, metaJson)
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
      ...(meta && Object.keys(meta).length > 0 ? { meta } : {})
    }
  }

  /** Удаляет одно сообщение по id (в рамках разговора). */
  deleteMessage(conversationId: string, messageId: string): void {
    this.db
      .prepare(`DELETE FROM messages WHERE id = ? AND conversation_id = ?`)
      .run(messageId, conversationId)
  }

  listMessages(conversationId: string): Message[] {
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
      ...(r.meta ? { meta: parseMeta(r.meta) } : {})
    }))
  }

  // ---- Settings ---------------------------------------------------------

  getSettings(): Settings {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(SETTINGS_KEY) as
      | { value: string }
      | undefined
    if (!row) return { ...DEFAULT_SETTINGS }
    try {
      // Мержим с дефолтами, чтобы новые поля не ломали старый конфиг.
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(row.value) as Partial<Settings>) }
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  saveSettings(settings: Settings): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(SETTINGS_KEY, JSON.stringify(settings))
  }

  // ---- Agents (машины для удалённого выполнения команд) ------------------

  /** Создаёт машину-агента; возвращает токен открытым текстом (единственный раз). */
  createAgent(name: string): AgentCreated {
    const id = this.newId()
    const token = randomBytes(24).toString('hex')
    this.db
      .prepare(
        `INSERT INTO agents (id, name, token_hash, created_at, last_seen, policy)
         VALUES (?, ?, ?, ?, NULL, ?)`
      )
      .run(id, name, hashAgentToken(token), this.now(), JSON.stringify(DEFAULT_AGENT_POLICY))
    return { id, name, token }
  }

  private mapAgent(r: AgentRow): AgentRecord {
    return {
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      lastSeen: r.last_seen,
      policy: parsePolicy(r.policy)
    }
  }

  listAgents(): AgentRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM agents ORDER BY created_at ASC`)
      .all() as AgentRow[]
    return rows.map((r) => this.mapAgent(r))
  }

  /** Ищет агента по хэшу токена (авторизация WS-подключения). */
  findAgentByTokenHash(tokenHash: string): AgentRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM agents WHERE token_hash = ?`)
      .get(tokenHash) as AgentRow | undefined
    return row ? this.mapAgent(row) : null
  }

  /** Задаёт политику возможностей машины. */
  setAgentPolicy(id: string, policy: AgentPolicy): void {
    this.db.prepare(`UPDATE agents SET policy = ? WHERE id = ?`).run(JSON.stringify(policy), id)
  }

  /** Перевыпускает токен машины (старый перестаёт работать). Возвращает новый токен. */
  regenerateAgentToken(id: string): { token: string } {
    const token = randomBytes(24).toString('hex')
    this.db.prepare(`UPDATE agents SET token_hash = ? WHERE id = ?`).run(hashAgentToken(token), id)
    return { token }
  }

  deleteAgent(id: string): void {
    this.db.prepare(`DELETE FROM agents WHERE id = ?`).run(id)
  }

  /** Обновляет last_seen (при регистрации и по pong). */
  touchAgent(id: string): void {
    this.db.prepare(`UPDATE agents SET last_seen = ? WHERE id = ?`).run(this.now(), id)
  }

  // ---- helpers ----------------------------------------------------------

  private mapConversation(row: ConversationRow, messageCount: number): Conversation {
    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount,
      claudeSessionId: row.claude_session_id
    }
  }
}

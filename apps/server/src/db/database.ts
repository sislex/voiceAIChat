import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { SCHEMA_SQL } from './schema'
import {
  DEFAULT_SETTINGS,
  type Conversation,
  type Message,
  type MessageRole,
  type Settings
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

interface MessageRow {
  id: string
  conversation_id: string
  role: string
  text: string
  time: string
  created_at: number
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
    this.db.exec(SCHEMA_SQL)
    this.newId = deps.newId ?? (() => randomUUID())
    this.now = deps.now ?? (() => Date.now())
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

  addMessage(conversationId: string, role: MessageRole, text: string, time: string): Message {
    const id = this.newId()
    const createdAt = this.now()
    const insert = this.db.prepare(
      `INSERT INTO messages (id, conversation_id, role, text, time, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    const touch = this.db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`)
    this.db.transaction(() => {
      insert.run(id, conversationId, role, text, time, createdAt)
      touch.run(createdAt, conversationId)
    })()
    return { id, conversationId, role, text, time, createdAt }
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
      createdAt: r.created_at
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

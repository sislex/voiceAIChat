/** DDL схемы БД. Идемпотентно: безопасно выполнять при каждом старте. */
export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS conversations (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  claude_session_id TEXT,
  user_id           TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role            TEXT NOT NULL,
  text            TEXT NOT NULL,
  time            TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  engine          TEXT,
  meta            TEXT,
  exec_target     TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS speakers (
  conversation_id TEXT NOT NULL,
  speaker_id      INTEGER NOT NULL,
  label           TEXT NOT NULL,
  PRIMARY KEY (conversation_id, speaker_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER,
  policy     TEXT,
  user_id    TEXT
);

CREATE TABLE IF NOT EXISTS users (
  name          TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL,
  blocked       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
`

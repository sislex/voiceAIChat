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
  user_id           TEXT,
  exec_target       TEXT,
  workdir           TEXT,
  skill_names       TEXT NOT NULL DEFAULT '[]',
  llm_provider      TEXT,
  llm_model         TEXT,
  kb_context_mode   TEXT NOT NULL DEFAULT 'auto'
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

CREATE TABLE IF NOT EXISTS projects (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  git_url      TEXT,
  technologies TEXT NOT NULL DEFAULT '[]',
  skills       TEXT NOT NULL DEFAULT '[]',
  created_by   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL,
  username   TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member',
  added_at   INTEGER NOT NULL,
  PRIMARY KEY (project_id, username),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_members_user
  ON project_members(username);

CREATE TABLE IF NOT EXISTS project_machines (
  project_id TEXT NOT NULL,
  agent_id   TEXT NOT NULL,
  PRIMARY KEY (project_id, agent_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id)   REFERENCES agents(id)   ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS kanban_columns (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name       TEXT NOT NULL,
  position   REAL NOT NULL,
  hidden     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_kanban_columns_project
  ON kanban_columns(project_id, position);

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  column_id   TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority    TEXT NOT NULL DEFAULT 'medium',
  assignee    TEXT,
  position    REAL NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)       ON DELETE CASCADE,
  FOREIGN KEY (column_id)  REFERENCES kanban_columns(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tasks_column
  ON tasks(project_id, column_id, position);
`

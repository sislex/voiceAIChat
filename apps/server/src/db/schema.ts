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
  kb_context_mode   TEXT NOT NULL DEFAULT 'auto',
  project_id        TEXT,
  status            TEXT NOT NULL DEFAULT 'developing'
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
  updated_at   INTEGER NOT NULL,
  default_agent_id TEXT,
  commit_policy TEXT NOT NULL DEFAULT 'agent_commits',
  merge_transport TEXT NOT NULL DEFAULT 'local',
  agent_plan_approval_mode TEXT NOT NULL DEFAULT 'manual',
  test_command TEXT NOT NULL DEFAULT '',
  production_deploy_command TEXT NOT NULL DEFAULT '',
  task_seq INTEGER NOT NULL DEFAULT 0
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
  path       TEXT NOT NULL DEFAULT '',
  feature_repos_root TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (project_id, agent_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id)   REFERENCES agents(id)   ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS kanban_columns (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name       TEXT NOT NULL,
  semantic_type TEXT NOT NULL DEFAULT 'custom',
  position   REAL NOT NULL,
  hidden     INTEGER NOT NULL DEFAULT 0,
  wip_limit  INTEGER,
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
  acceptance_criteria TEXT NOT NULL DEFAULT '',
  type        TEXT NOT NULL DEFAULT 'task',
  parent_id   TEXT,
  priority    TEXT NOT NULL DEFAULT 'medium',
  assignee    TEXT,
  labels      TEXT NOT NULL DEFAULT '[]',
  story_points REAL,
  due_date    INTEGER,
  flagged     INTEGER NOT NULL DEFAULT 0,
  seq         INTEGER,
  position    REAL NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)       ON DELETE CASCADE,
  FOREIGN KEY (column_id)  REFERENCES kanban_columns(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id)  REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_column
  ON tasks(project_id, column_id, position);

CREATE TABLE IF NOT EXISTS repository_slots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  feature_id TEXT,
  current_branch TEXT,
  reserved_at INTEGER,
  heartbeat_at INTEGER,
  block_reason TEXT,
  last_error TEXT,
  UNIQUE(agent_id, path),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS features (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_task_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  previous_feature_id TEXT,
  conversation_id TEXT,
  repository_slot_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  deploy_status TEXT NOT NULL DEFAULT 'not_requested',
  base_branch TEXT NOT NULL DEFAULT 'main',
  feature_branch TEXT NOT NULL,
  base_commit_sha TEXT,
  tested_commit_sha TEXT,
  merged_commit_sha TEXT,
  commit_policy TEXT NOT NULL,
  merge_transport TEXT NOT NULL,
  agent_plan_approval_mode TEXT NOT NULL,
  auto_merge INTEGER NOT NULL DEFAULT 0,
  auto_deploy_production INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  last_error TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(source_task_id, attempt),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (source_task_id) REFERENCES tasks(id) ON DELETE RESTRICT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
  FOREIGN KEY (repository_slot_id) REFERENCES repository_slots(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_features_project ON features(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_features_task ON features(source_task_id, attempt DESC);

CREATE TABLE IF NOT EXISTS agent_tasks (
  id TEXT PRIMARY KEY,
  feature_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'custom',
  status TEXT NOT NULL DEFAULT 'planned',
  created_by TEXT NOT NULL,
  depends_on TEXT NOT NULL DEFAULT '[]',
  attempt INTEGER NOT NULL DEFAULT 1,
  result_summary TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE
);



CREATE TABLE IF NOT EXISTS feature_deployments (
  id TEXT PRIMARY KEY,
  feature_id TEXT NOT NULL,
  requested_main_sha TEXT NOT NULL,
  deployed_main_sha TEXT,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  error TEXT,
  FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_feature_deployments_feature ON feature_deployments(feature_id, created_at DESC);

CREATE TABLE IF NOT EXISTS feature_events (
  id TEXT PRIMARY KEY,
  feature_id TEXT NOT NULL,
  type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_feature_events_feature ON feature_events(feature_id, created_at);

`

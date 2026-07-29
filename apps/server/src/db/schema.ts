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
  task_id           TEXT,
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
  default_skills_epic  TEXT NOT NULL DEFAULT '[]',
  default_skills_story TEXT NOT NULL DEFAULT '[]',
  default_skills_task  TEXT NOT NULL DEFAULT '[]',
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
  skills      TEXT NOT NULL DEFAULT '[]',

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


-- ============================ CI-раннер ============================

CREATE TABLE IF NOT EXISTS ci_commands (
  id                TEXT PRIMARY KEY,
  scope             TEXT NOT NULL DEFAULT 'project',
  project_id        TEXT,
  name              TEXT NOT NULL,
  script            TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  workdir           TEXT NOT NULL DEFAULT '',
  timeout_sec       INTEGER,
  env_json          TEXT NOT NULL DEFAULT '{}',
  allow_failure     INTEGER NOT NULL DEFAULT 0,
  is_cleanup        INTEGER NOT NULL DEFAULT 0,
  available_to_model INTEGER NOT NULL DEFAULT 1,
  version           INTEGER NOT NULL DEFAULT 1,
  created_by        TEXT NOT NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  deleted_at        INTEGER,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ci_commands_scope ON ci_commands(scope, project_id, deleted_at);

CREATE TABLE IF NOT EXISTS ci_slot_commands (
  id          TEXT PRIMARY KEY,
  owner_type  TEXT NOT NULL,
  owner_id    TEXT NOT NULL,
  slot        TEXT NOT NULL,
  command_id  TEXT NOT NULL,
  position    INTEGER NOT NULL,
  FOREIGN KEY (command_id) REFERENCES ci_commands(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ci_slot_commands_owner ON ci_slot_commands(owner_type, owner_id, slot, position);

CREATE TABLE IF NOT EXISTS ci_workspaces (
  id                 TEXT PRIMARY KEY,
  project_id         TEXT NOT NULL,
  task_id            TEXT NOT NULL,
  agent_id           TEXT,
  path               TEXT NOT NULL,
  state              TEXT NOT NULL DEFAULT 'active',
  size_bytes         INTEGER,
  created_at         INTEGER NOT NULL,
  released_by_step_id TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ci_workspaces_project ON ci_workspaces(project_id, state);

CREATE TABLE IF NOT EXISTS ci_runs (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL,
  task_id        TEXT NOT NULL,
  agent_id       TEXT,
  status         TEXT NOT NULL DEFAULT 'queued',
  workspace_id   TEXT,
  triggered_by   TEXT NOT NULL,
  prev_column_id TEXT,
  llm_provider   TEXT NOT NULL DEFAULT 'claude',
  llm_model      TEXT NOT NULL DEFAULT 'sonnet',
  slot_progress_json TEXT NOT NULL DEFAULT '{}',
  started_at     INTEGER,
  finished_at    INTEGER,
  duration_ms    INTEGER,
  created_at     INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES ci_workspaces(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_ci_runs_project ON ci_runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ci_runs_task ON ci_runs(task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ci_run_steps (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL,
  slot            TEXT,
  position        INTEGER NOT NULL,
  kind            TEXT NOT NULL,
  parent_step_id  TEXT,
  initiated_by    TEXT NOT NULL DEFAULT 'system',
  command_id      TEXT,
  command_snapshot TEXT,
  title           TEXT NOT NULL DEFAULT '',
  workdir         TEXT,
  status          TEXT NOT NULL DEFAULT 'queued',
  exit_code       INTEGER,
  attempt         INTEGER NOT NULL DEFAULT 1,
  fixed_by_model  INTEGER NOT NULL DEFAULT 0,
  started_at      INTEGER,
  finished_at     INTEGER,
  duration_ms     INTEGER,
  FOREIGN KEY (run_id) REFERENCES ci_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (command_id) REFERENCES ci_commands(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_ci_run_steps_run ON ci_run_steps(run_id, position);

CREATE TABLE IF NOT EXISTS ci_run_logs (
  id       TEXT PRIMARY KEY,
  run_id   TEXT NOT NULL,
  step_id  TEXT NOT NULL,
  seq      INTEGER NOT NULL,
  stream   TEXT NOT NULL DEFAULT 'stdout',
  chunk    TEXT NOT NULL,
  at       INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES ci_runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ci_run_logs_run ON ci_run_logs(run_id, seq);

CREATE TABLE IF NOT EXISTS ci_fix_attempts (
  id           TEXT PRIMARY KEY,
  run_step_id  TEXT NOT NULL,
  attempt_no   INTEGER NOT NULL,
  diagnosis    TEXT NOT NULL DEFAULT '',
  action       TEXT NOT NULL DEFAULT '',
  result       TEXT NOT NULL DEFAULT 'retrying',
  diff         TEXT,
  duration_ms  INTEGER,
  tokens_used  INTEGER,
  created_at   INTEGER NOT NULL,
  FOREIGN KEY (run_step_id) REFERENCES ci_run_steps(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ci_fix_attempts_step ON ci_fix_attempts(run_step_id, attempt_no);

CREATE TABLE IF NOT EXISTS ci_command_suggestions (
  id             TEXT PRIMARY KEY,
  command_id     TEXT NOT NULL,
  run_step_id    TEXT,
  reason         TEXT NOT NULL DEFAULT '',
  proposed_script TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'new',
  occurrences    INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL,
  resolved_by    TEXT,
  resolved_at    INTEGER,
  FOREIGN KEY (command_id) REFERENCES ci_commands(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ci_suggestions_command ON ci_command_suggestions(command_id, status);

CREATE TABLE IF NOT EXISTS ci_events (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_id     TEXT,
  command_id TEXT,
  type       TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id   TEXT,
  payload    TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ci_events_project ON ci_events(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ci_events_run ON ci_events(run_id, created_at);

CREATE TABLE IF NOT EXISTS ci_settings (
  id                     INTEGER PRIMARY KEY CHECK (id = 1),
  max_fix_attempts       INTEGER NOT NULL,
  fix_time_limit_ms      INTEGER NOT NULL,
  fix_token_limit        INTEGER NOT NULL,
  default_step_timeout_sec INTEGER NOT NULL,
  metrics_window         INTEGER NOT NULL,
  max_concurrent_runs    INTEGER NOT NULL,
  max_model_command_calls INTEGER NOT NULL
);

`

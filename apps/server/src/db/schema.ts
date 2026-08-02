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
  llm_engine_id     TEXT,
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

-- Состояние бэкфилла FTS-индексов. Живёт отдельно от settings: это внутренняя
-- служебная запись движка, а не настройка пользователя.
CREATE TABLE IF NOT EXISTS fts_state (
  name       TEXT PRIMARY KEY,
  -- Докуда дошёл бэкфилл (rowid messages) и до какого rowid он вообще идёт:
  -- всё, что появилось после старта бэкфилла, уже проиндексировано триггерами.
  last_rowid INTEGER NOT NULL DEFAULT 0,
  max_rowid  INTEGER NOT NULL DEFAULT 0,
  done       INTEGER NOT NULL DEFAULT 0,
  -- Сколько раз индекс пересобирали после проваленной integrity-check.
  repairs    INTEGER NOT NULL DEFAULT 0
);

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

CREATE TABLE IF NOT EXISTS llm_engines (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,
  base_url      TEXT NOT NULL,
  token         TEXT NOT NULL DEFAULT '',
  enabled       INTEGER NOT NULL DEFAULT 1,
  allowed_roles TEXT NOT NULL DEFAULT '["admin","user"]',
  is_default    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_engines_kind_enabled
  ON llm_engines(kind, enabled, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_engines_default_kind
  ON llm_engines(kind)
  WHERE is_default = 1;

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
  task_seq INTEGER NOT NULL DEFAULT 0,
  -- Через сколько дней завершённая задача уходит с доски (NULL — не скрывать).
  done_retention_days INTEGER DEFAULT 14
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
  repos_root TEXT NOT NULL DEFAULT '',
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
  -- Момент попадания в колонку с семантикой done (NULL — задача не завершена).
  done_at     INTEGER,
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
  -- Команда-проверка (тесты/typecheck/линт): её гоняет только воркфлоу, модели она не видна.
  is_test           INTEGER NOT NULL DEFAULT 0,
  -- Встроенный серверный шаг (см. CiBuiltinStep): script не исполняется, раннер зовёт хук.
  builtin           TEXT,
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

CREATE TABLE IF NOT EXISTS ci_llm_configs (
  owner_type TEXT NOT NULL,
  owner_id   TEXT NOT NULL,
  provider   TEXT NOT NULL,
  model      TEXT NOT NULL,
  mode           TEXT NOT NULL DEFAULT 'development',
  clarify_level  TEXT NOT NULL DEFAULT 'few',
  clarify_max    INTEGER NOT NULL DEFAULT 3,
  PRIMARY KEY (owner_type, owner_id)
);

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
  llm_engine_id  TEXT,
  llm_provider   TEXT NOT NULL DEFAULT 'claude',
  llm_model      TEXT NOT NULL DEFAULT 'opus',
  mode           TEXT NOT NULL DEFAULT 'development',
  clarify_level  TEXT NOT NULL DEFAULT 'few',
  clarify_max    INTEGER NOT NULL DEFAULT 3,
  conversation_id TEXT,
  -- Снимок режима БЗ проекта на старте рана (auto|manual|off).
  kb_context_mode TEXT NOT NULL DEFAULT 'auto',
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

-- Пауза рана в ожидании пользователя: уточняющие вопросы модели или одобрение
-- плана. Ответить можно из ленты рана или из связанного чата — первый победил.
CREATE TABLE IF NOT EXISTS ci_interactions (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL,
  step_id         TEXT NOT NULL,
  seq             INTEGER NOT NULL,
  kind            TEXT NOT NULL,
  questions_json  TEXT NOT NULL DEFAULT '[]',
  plan_text       TEXT,
  answer_text     TEXT,
  decision        TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  conversation_id TEXT,
  message_id      TEXT,
  created_at      INTEGER NOT NULL,
  answered_at     INTEGER,
  answered_by     TEXT,
  FOREIGN KEY (run_id) REFERENCES ci_runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ci_interactions_run ON ci_interactions(run_id, seq);

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

-- Расход модели по ходам рана: строка на каждый ход CLI (он же «запрос к
-- модели»). Стоимость хранится только та, что сообщил CLI; когда её нет,
-- отчёт считает оценку по прайсу — иначе смена цен переписывала бы историю.
CREATE TABLE IF NOT EXISTS ci_run_usage (
  id                    TEXT PRIMARY KEY,
  run_id                TEXT NOT NULL,
  -- Ссылки на ci_run_steps намеренно нет: расход пишется по факту хода, а шаг
  -- может быть синтетическим (повтор, вложенный вызов) — метрика не имеет права
  -- уронить ран нарушением внешнего ключа.
  step_id               TEXT,
  kind                  TEXT NOT NULL DEFAULT 'model_work',
  provider              TEXT NOT NULL DEFAULT 'claude',
  model                 TEXT NOT NULL DEFAULT '',
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd              REAL,
  duration_ms           INTEGER,
  num_turns             INTEGER,
  -- Что означает input_tokens: 'no_cache' — вход без прочитанного кэша (единая
  -- семантика, приводится на записи). NULL — историческая строка: у codex там
  -- вход ВМЕСТЕ с кэшем, и складывать его с claude нельзя. Историю задним
  -- числом не переписываем, поэтому различаем на чтении.
  input_semantics       TEXT,
  at                    INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES ci_runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ci_run_usage_run ON ci_run_usage(run_id, at);

-- Вызовы инструментов модели за ран, по видам (bash/read/grep/edit/kb/other) и
-- отдельной строкой denied — отказы (неодобренное разрешение CLI либо отказ
-- remote-моста). Ключ-значение, поэтому новый вид не требует миграции.
-- Отдельная таблица, а не колонки расхода: ход без строки расхода (мгновенная
-- отмена) всё равно успевает вызвать инструменты, а «нет строки» должно
-- отличаться от «нуля вызовов» — у ранов до фичи счётчика нет вовсе.
CREATE TABLE IF NOT EXISTS ci_run_tool_calls (
  run_id     TEXT NOT NULL,
  tool       TEXT NOT NULL,
  calls      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, tool),
  FOREIGN KEY (run_id) REFERENCES ci_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ci_run_kb_metrics (
  run_id             TEXT PRIMARY KEY,
  sections_delivered INTEGER NOT NULL,
  sections_hit       INTEGER NOT NULL,
  hit_ratio          REAL NOT NULL,
  calculated_at      INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES ci_runs(id) ON DELETE CASCADE
);

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
  max_model_command_calls INTEGER NOT NULL,
  interaction_wait_ms    INTEGER NOT NULL DEFAULT 1800000,
  -- Модель на стадию рана (JSON вида {"kb_update":"sonnet"}); NULL — дефолты кода.
  stage_models           TEXT
);

-- Использование базы знаний моделью: одно обращение = одна строка. Пишется
-- только то, что видела модель (авто-инъекция контекста перед ходом и вызовы
-- mcp__kb__*); ручной поиск человека по странице «База знаний» сюда не идёт.
-- seq монотонен внутри разговора и служит курсором для инкрементальных
-- WS-кадров, project_id — СНИМОК на момент обращения (чат может сменить проект).
CREATE TABLE IF NOT EXISTS kb_usage_queries (
  id              TEXT PRIMARY KEY,
  seq             INTEGER NOT NULL,
  user_id         TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  project_id      TEXT,
  turn_id         TEXT,
  message_id      TEXT,
  -- Ран CI-раннера и шаг его ленты, если обращение случилось в ходе рана.
  ci_run_id       TEXT,
  ci_step_id      TEXT,
  source          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'delivered',
  query           TEXT NOT NULL DEFAULT '',
  confidence      TEXT,
  injected        INTEGER NOT NULL DEFAULT 0,
  sections_count  INTEGER NOT NULL DEFAULT 0,
  chars           INTEGER NOT NULL DEFAULT 0,
  est_tokens      INTEGER NOT NULL DEFAULT 0,
  bundle_tokens   INTEGER,
  prompt_chars    INTEGER,
  turn_input_tokens INTEGER,
  duration_ms     INTEGER,
  error           TEXT,
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_usage_seq ON kb_usage_queries(conversation_id, seq);
CREATE INDEX IF NOT EXISTS idx_kb_usage_project ON kb_usage_queries(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kb_usage_turn ON kb_usage_queries(turn_id);
-- Индекс по ci_run_id создаёт migrate(): на БД, которая старше этих колонок,
-- CREATE TABLE IF NOT EXISTS их не добавит, и индекс здесь упал бы на старте.

CREATE TABLE IF NOT EXISTS kb_usage_sections (
  id          TEXT PRIMARY KEY,
  query_id    TEXT NOT NULL,
  document_id TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  heading     TEXT NOT NULL DEFAULT '',
  anchor      TEXT NOT NULL DEFAULT '',
  source_path TEXT NOT NULL DEFAULT '',
  related_files TEXT NOT NULL DEFAULT '[]',
  chars       INTEGER NOT NULL DEFAULT 0,
  est_tokens  INTEGER NOT NULL DEFAULT 0,
  score       REAL,
  match_types TEXT NOT NULL DEFAULT '[]',
  freshness   TEXT NOT NULL DEFAULT 'unknown',
  position    INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (query_id) REFERENCES kb_usage_queries(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_kb_usage_sections_query ON kb_usage_sections(query_id);
CREATE INDEX IF NOT EXISTS idx_kb_usage_sections_doc ON kb_usage_sections(document_id, anchor);

-- Статьи базы знаний, которые ведут пользователь и модель. Файлы docs/kb/*.md
-- остаются разделом «Использование» (одинаков для всех), а здесь живут
-- персональные знания (scope='user', владелец в owner_id) и знания по
-- разработке проекта (scope='project', проект в project_id). Доступ считает
-- сервер по членству в проекте — в таблице только принадлежность.
CREATE TABLE IF NOT EXISTS kb_documents (
  id          TEXT PRIMARY KEY,
  scope       TEXT NOT NULL,
  owner_id    TEXT,
  project_id  TEXT,
  title       TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'subsystem',
  tags        TEXT NOT NULL DEFAULT '[]',
  areas       TEXT NOT NULL DEFAULT '[]',
  body        TEXT NOT NULL DEFAULT '',
  -- Дата сверки с кодом (как во фронтматтере файловых тем) — строкой, для человека.
  checked_on  TEXT,
  created_by  TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_kb_documents_scope ON kb_documents(scope, project_id, owner_id);

`

/**
 * FTS5-индекс сообщений: отдельно от `SCHEMA_SQL`, потому что сборка SQLite
 * может быть без FTS5 — тогда `exec` бросает, а сервер обязан подняться
 * (поиск деградирует до «ничего не найдено», см. `setupMessagesFts`).
 *
 * `content='messages'` — внешнее содержимое: индекс не дублирует текст, а
 * читает его из таблицы. Синхронизацию держат триггеры, поэтому любая правка
 * `messages` обязана проходить через них (не через `INSERT OR REPLACE` в обход).
 * Токенайзер `unicode61 remove_diacritics 2` нужен русскому: он режет по
 * юникод-границам и складывает регистр кириллицы («СЕРВЕРНОЙ» = «серверной»),
 * а диакритику снимает с латиницы («café» = «cafe»). Кириллическую «ё» он в «е»
 * не превращает — это разные токены, и поиск по «елка» «ёлку» не найдёт.
 */
export const MESSAGES_FTS_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  text,
  content='messages',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts (rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts (messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts (messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO messages_fts (rowid, text) VALUES (new.rowid, new.text);
END;
`

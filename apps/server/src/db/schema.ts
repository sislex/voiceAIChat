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
  disabled_context_json TEXT NOT NULL DEFAULT '[]',
  project_id        TEXT,
  preview_url       TEXT,
  task_id           TEXT,
  assistant_kind    TEXT,
  -- Режим применения мутаций канбан-ассистентом: auto (сразу) или confirm.
  assistant_autonomy TEXT,
  status            TEXT NOT NULL DEFAULT 'developing'
);


CREATE TABLE IF NOT EXISTS conversation_draft_requests (
  user_id        TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  PRIMARY KEY (user_id, idempotency_key),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  name       TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
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
  attachments     TEXT,
  state           TEXT NOT NULL DEFAULT 'published',
  history_position INTEGER,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages(conversation_id, created_at);

-- Персистентная FIFO-очередь ходов. message_id одновременно является ключом
-- идемпотентности: повторная доставка claude.send не создаёт второй элемент.
CREATE TABLE IF NOT EXISTS conversation_turn_queue (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  message_id      TEXT NOT NULL UNIQUE,
  payload         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'queued',
  position        INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_turn_queue_position
  ON conversation_turn_queue(conversation_id, position);
CREATE INDEX IF NOT EXISTS idx_turn_queue_owner
  ON conversation_turn_queue(user_id, conversation_id, status, position);

CREATE TABLE IF NOT EXISTS conversation_turn_control (
  conversation_id TEXT PRIMARY KEY,
  paused           INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- Редактируемый прайс моделей: USD за 1M токенов. Начальные строки Codex/OpenAI
-- зафиксированы по developers.openai.com/api/docs/pricing (Standard, short context,
-- 04.08.2026); INSERT OR IGNORE сохраняет будущие ручные обновления.
CREATE TABLE IF NOT EXISTS model_prices (
  provider          TEXT NOT NULL,
  model             TEXT NOT NULL,
  input_per_million REAL NOT NULL,
  cached_input_per_million REAL NOT NULL,
  cache_write_per_million REAL NOT NULL DEFAULT 0,
  output_per_million REAL NOT NULL,
  source_url        TEXT NOT NULL,
  effective_at      INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  PRIMARY KEY (provider, model)
);
INSERT OR IGNORE INTO model_prices VALUES
  ('codex','gpt-5.6-sol',5.00,0.50,6.25,30.00,'https://developers.openai.com/api/docs/pricing',1785801600000,1785801600000),
  ('codex','gpt-5.6-terra',2.00,0.20,2.50,12.00,'https://developers.openai.com/api/docs/pricing',1785801600000,1785801600000),
  ('codex','gpt-5.6-luna',0.20,0.02,0.25,1.20,'https://developers.openai.com/api/docs/pricing',1785801600000,1785801600000),
  ('codex','gpt-5.5',5.00,0.50,0,30.00,'https://developers.openai.com/api/docs/pricing',1785801600000,1785801600000),
  ('codex','gpt-5.5-pro',30.00,0,0,180.00,'https://developers.openai.com/api/docs/pricing',1785801600000,1785801600000),
  ('codex','gpt-5.4',2.50,0.25,0,15.00,'https://developers.openai.com/api/docs/pricing',1785801600000,1785801600000),
  ('codex','gpt-5.4-mini',0.75,0.075,0,4.50,'https://developers.openai.com/api/docs/pricing',1785801600000,1785801600000),
  ('codex','gpt-5.4-nano',0.20,0.02,0,1.25,'https://developers.openai.com/api/docs/pricing',1785801600000,1785801600000),
  ('codex','gpt-5.4-pro',30.00,0,0,180.00,'https://developers.openai.com/api/docs/pricing',1785801600000,1785801600000),
  ('codex','gpt-5.3-codex',1.75,0.175,0,14.00,'https://developers.openai.com/api/docs/pricing',1785801600000,1785801600000);

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

CREATE TABLE IF NOT EXISTS machine_storages (
  id             TEXT PRIMARY KEY,
  machine_id     TEXT NOT NULL,
  root_path      TEXT NOT NULL,
  format_version INTEGER NOT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  UNIQUE(machine_id, root_path),
  FOREIGN KEY (machine_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_storage_bindings (
  conversation_id TEXT PRIMARY KEY,
  machine_id      TEXT NOT NULL,
  storage_id      TEXT NOT NULL,
  relative_path   TEXT NOT NULL,
  updated_at      INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (machine_id) REFERENCES agents(id) ON DELETE RESTRICT,
  FOREIGN KEY (storage_id) REFERENCES machine_storages(id) ON DELETE RESTRICT
);

-- Git workspace binding is deliberately separate from chat file storage and
-- legacy conversations.workdir. Only verified managers may publish these rows.
CREATE TABLE IF NOT EXISTS conversation_workspaces (
  conversation_id TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL,
  machine_id      TEXT NOT NULL,
  storage_id      TEXT NOT NULL,
  mode            TEXT NOT NULL,
  base_sha        TEXT NOT NULL,
  branch          TEXT NOT NULL,
  repository_path TEXT NOT NULL UNIQUE,
  state           TEXT NOT NULL,
  diagnostic      TEXT,
  updated_at      INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (machine_id) REFERENCES agents(id) ON DELETE RESTRICT,
  FOREIGN KEY (storage_id) REFERENCES machine_storages(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS generated_cleanup_retry (
  conversation_id TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT NOT NULL,
  next_attempt_at INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_generated_cleanup_retry_due ON generated_cleanup_retry(next_attempt_at);

CREATE TABLE IF NOT EXISTS users (
  name          TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL,
  blocked       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_verifications (
  token_hash TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_verifications_email ON email_verifications(email);

-- Сброс пароля по подтверждённому email: наружу уходит сырой токен, в БД хранится только sha256.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_name);

CREATE TABLE IF NOT EXISTS invites (
  token TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1,
  uses INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  email TEXT,
  emailed_at INTEGER
);

CREATE TABLE IF NOT EXISTS machine_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  source TEXT NOT NULL,
  command TEXT NOT NULL,
  exit_code INTEGER,
  timed_out INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  conversation_id TEXT,
  output_excerpt TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_machine_commands_machine ON machine_commands(machine_id, id DESC);

CREATE TABLE IF NOT EXISTS machine_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  state TEXT NOT NULL,
  at INTEGER NOT NULL,
  offline_for_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_machine_events_machine ON machine_events(machine_id, id DESC);

-- Журнал контекста разговора: кто и когда выключил или вернул источник.
-- Нужен, чтобы отвечать на вопрос «почему этот чат ведёт себя иначе» — по
-- одному текущему набору disabled_context_json этого не понять.
CREATE TABLE IF NOT EXISTS conversation_context_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  -- Кто изменил: обычно владелец разговора, но админ правит и чужие чаты.
  actor TEXT NOT NULL,
  item_id TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  -- Новое значение настройки разговора (режим доступа, база знаний, движок).
  -- NULL — событие тумблера: у него состояние выражает колонка enabled.
  -- Колонка добавляется в migrate() и на существующей базе.
  value TEXT
);
CREATE INDEX IF NOT EXISTS idx_context_events_conversation ON conversation_context_events(conversation_id, id DESC);

CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  user_name TEXT NOT NULL,
  type TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  -- Сессия, к которой относится событие. По ней строится история устройства:
  -- пара «User-Agent + адрес» рвётся при смене сети и склеивает разные входы.
  session_sid TEXT
);
CREATE INDEX IF NOT EXISTS idx_security_events_user ON security_events(user_name, at DESC);
-- Индекс по session_sid создаётся в migrate(): на существующей базе схема
-- выполняется до ALTER TABLE, и индекс по ещё не добавленной колонке падает.

CREATE TABLE IF NOT EXISTS login_device_emails (
  user_name TEXT NOT NULL,
  ip TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (user_name, ip, user_agent)
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  user_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  revoked_at INTEGER,
  -- Метаданные устройства: имя от пользователя, ключ устройства (доверие и
  -- распознавание нового входа), место по адресу и грубая мера активности.
  label TEXT,
  device_key TEXT,
  trusted_at INTEGER,
  platform TEXT,
  client_version TEXT,
  geo TEXT,
  requests INTEGER NOT NULL DEFAULT 0,
  last_path TEXT,
  -- Почему сессия закончилась: revoked | evicted | panic | logout_all | admin | stale.
  end_reason TEXT,
  -- SHA-256 секрета устройства из cookie vc_device: доверие привязано к нему, а
  -- не к угадываемым свойствам запроса (User-Agent и подсеть подделываются).
  device_secret TEXT,
  -- Подтверждали ли этот вход вторым фактором. Доверять можно только такой
  -- сессии: иначе доверие выдаётся входу, который сам проверку не проходил.
  two_factor INTEGER NOT NULL DEFAULT 0
);
-- Индекс по device_key создаётся в migrate(), а не здесь: на старой базе схема
-- выполняется до ALTER TABLE, и индекс по ещё не добавленной колонке падает.
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_name);
-- Активность всех пользователей разом (метрика «активны сейчас» и колонка списка):
-- без этого индекса агрегат читает всю таблицу сессий на каждое открытие раздела.
CREATE INDEX IF NOT EXISTS idx_sessions_live ON sessions(revoked_at, expires_at, user_name);
-- Отчёты расхода читают только ai-сообщения за период: без этого индекса каждый
-- отчёт сканирует таблицу сообщений целиком.
CREATE INDEX IF NOT EXISTS idx_messages_role_created ON messages(role, created_at);

CREATE TABLE IF NOT EXISTS session_revocations (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_llm_access (
  user_name TEXT NOT NULL,
  provider  TEXT NOT NULL,
  model_id  TEXT NOT NULL,
  PRIMARY KEY (user_name, provider, model_id),
  FOREIGN KEY (user_name) REFERENCES users(name) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS llm_engines (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,
  base_url      TEXT NOT NULL,
  token         TEXT NOT NULL DEFAULT '',
  enabled       INTEGER NOT NULL DEFAULT 1,
  allowed_roles TEXT NOT NULL DEFAULT '["admin","developer","tester","observer"]',
  is_default    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_engines_kind_enabled
  ON llm_engines(kind, enabled, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_engines_default_kind
  ON llm_engines(kind)
  WHERE is_default = 1;

-- Дерево типов проекта. Встроенные узлы (builtin=1) сеются при открытии базы и
-- не удаляются; личные узлы заводит любой пользователь и может отправить на
-- утверждение администратору (private → pending → published | rejected).
-- ON DELETE RESTRICT: узел с детьми или с проектами удалить нельзя — вместо
-- каскада, который тихо осиротил бы проекты, пользователь получает отказ.
-- Приглашения в проект (как на GitHub): владелец зовёт по логину или адресу,
-- уходит письмо со ссылкой, приглашённый подтверждает сам. Токен хранится хешем —
-- как в email_verifications: утёкшая база не даёт вступить в чужой проект.
-- Частичные уникальные индексы держат ровно одно живое приглашение на адресата.
CREATE TABLE IF NOT EXISTS project_invitations (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL,
  email            TEXT,
  invited_username TEXT,
  role             TEXT NOT NULL DEFAULT 'member',
  token_hash       TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL DEFAULT 'pending',
  invited_by       TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL,
  responded_at     INTEGER,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_invitations_pending_email
  ON project_invitations(project_id, email)
  WHERE status = 'pending' AND email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_invitations_pending_user
  ON project_invitations(project_id, invited_username)
  WHERE status = 'pending' AND invited_username IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_project_invitations_user
  ON project_invitations(invited_username, status);

CREATE TABLE IF NOT EXISTS project_types (
  id            TEXT PRIMARY KEY,
  parent_id     TEXT,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  features_json TEXT NOT NULL DEFAULT '{}',
  defaults_json TEXT NOT NULL DEFAULT '{}',
  builtin       INTEGER NOT NULL DEFAULT 0,
  owner_id      TEXT,
  status        TEXT NOT NULL DEFAULT 'private',
  review_note   TEXT NOT NULL DEFAULT '',
  reviewed_by   TEXT,
  reviewed_at   INTEGER,
  created_by    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES project_types(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_project_types_parent ON project_types(parent_id);
CREATE INDEX IF NOT EXISTS idx_project_types_status ON project_types(status, owner_id);

-- Неизменяемая история решений по публикации типов.
CREATE TABLE IF NOT EXISTS project_type_review_audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type_id    TEXT NOT NULL,
  actor      TEXT NOT NULL,
  old_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_project_type_review_audit_type ON project_type_review_audit(type_id, at);

CREATE TABLE IF NOT EXISTS projects (
  id           TEXT PRIMARY KEY,
  project_type_id TEXT REFERENCES project_types(id),
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  git_url      TEXT,
  preview_url  TEXT,
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
  automated_qa_command TEXT NOT NULL DEFAULT 'npm test',
  automated_qa_mode TEXT NOT NULL DEFAULT 'command',
  automated_qa_scenario_json TEXT NOT NULL DEFAULT '',
  autopilot_requires_manual_qa INTEGER NOT NULL DEFAULT 0,
  autopilot_fix_limit INTEGER NOT NULL DEFAULT 3,
  production_deploy_command TEXT NOT NULL DEFAULT '',
  production_agent_id TEXT,
  production_environment_mode TEXT NOT NULL DEFAULT 'legacy',
  production_checkout_path TEXT NOT NULL DEFAULT '',
  production_health_check_command TEXT NOT NULL DEFAULT '',
  release_timeouts_json TEXT NOT NULL DEFAULT '{}',
  default_skills_epic  TEXT NOT NULL DEFAULT '[]',
  default_skills_story TEXT NOT NULL DEFAULT '[]',
  default_skills_task  TEXT NOT NULL DEFAULT '[]',
  task_seq INTEGER NOT NULL DEFAULT 0,
  -- Через сколько дней завершённая задача уходит с доски (NULL — не скрывать).
  done_retention_days INTEGER DEFAULT 14,
  -- Максимум автоматических возвратов testing → development; 0 запрещает auto-fix.
  ci_test_fix_cycle_limit INTEGER NOT NULL DEFAULT 10
);


CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL,
  username   TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member',
  qa_permission INTEGER NOT NULL DEFAULT 0,
  added_at   INTEGER NOT NULL,
  PRIMARY KEY (project_id, username),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_members_user
  ON project_members(username);

-- Неизменяемый аудит назначения и снятия проектных ролей.
CREATE TABLE IF NOT EXISTS project_member_role_audit (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL,
  target_user   TEXT NOT NULL,
  actor         TEXT NOT NULL,
  old_role      TEXT,
  new_role      TEXT,
  action        TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_project_member_role_audit_project
  ON project_member_role_audit(project_id, created_at);

CREATE TABLE IF NOT EXISTS project_machines (
  project_id TEXT NOT NULL,
  agent_id   TEXT NOT NULL,
  path       TEXT NOT NULL DEFAULT '',
  repos_root TEXT NOT NULL DEFAULT '',
  ssh_host   TEXT NOT NULL DEFAULT '',
  ssh_user   TEXT NOT NULL DEFAULT '',
  storage_id TEXT,
  directories_json TEXT NOT NULL DEFAULT '',
  added_at  INTEGER NOT NULL,
  added_by  TEXT NOT NULL,
  PRIMARY KEY (project_id, agent_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id)   REFERENCES agents(id)   ON DELETE CASCADE,
  FOREIGN KEY (storage_id) REFERENCES machine_storages(id) ON DELETE SET NULL
);

-- Explicit access grant. Existing project_machines rows are deliberately not
-- copied here: a machine is private until its owner shares it with this project.
CREATE TABLE IF NOT EXISTS machine_project_shares (
  project_id TEXT NOT NULL,
  agent_id   TEXT NOT NULL,
  shared     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (project_id, agent_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

-- Вид доски конкретного человека в проекте (фильтры, свимлейны, показ скрытых
-- и завершённых). Раньше жил в localStorage и терялся на другом компьютере.
CREATE TABLE IF NOT EXISTS board_views (
  username   TEXT NOT NULL,
  project_id TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (username, project_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_project_machine_defaults (
  username   TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_id   TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (username, project_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS machine_project_share_audit (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  agent_id   TEXT NOT NULL,
  actor      TEXT NOT NULL,
  old_value INTEGER NOT NULL,
  new_value INTEGER NOT NULL,
  created_at INTEGER NOT NULL
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
  source_task_id TEXT,
  priority    TEXT NOT NULL DEFAULT 'medium',
  assignee    TEXT,
  created_by  TEXT,
  created_by_name TEXT,
  agent_id    TEXT,
  labels      TEXT NOT NULL DEFAULT '[]',
  skills      TEXT NOT NULL DEFAULT '[]',

  story_points REAL,
  due_date    INTEGER,
  flagged     INTEGER NOT NULL DEFAULT 0,
  auto_pilot  INTEGER NOT NULL DEFAULT 0,
  auto_pilot_fix_cycles INTEGER NOT NULL DEFAULT 0,
  -- Момент попадания в колонку с семантикой done (NULL — задача не завершена).
  done_at     INTEGER,
  preview_ready INTEGER NOT NULL DEFAULT 0,
  seq         INTEGER,
  position    REAL NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)       ON DELETE CASCADE,
  FOREIGN KEY (column_id)  REFERENCES kanban_columns(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id)  REFERENCES tasks(id) ON DELETE SET NULL,
  FOREIGN KEY (source_task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_column
  ON tasks(project_id, column_id, position);

-- Связь карточки с дизайном из Make: отдельная таблица, а не JSON в tasks, —
-- панель Make спрашивает обратное направление («какие задачи ссылаются на эту
-- страницу»), и по колонке JSON такой запрос не построить.
CREATE TABLE IF NOT EXISTS task_designs (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  -- Путь файла внутри Make-проекта; пустая строка — проект целиком.
  path            TEXT NOT NULL DEFAULT '',
  label           TEXT NOT NULL DEFAULT '',
  created_by      TEXT,
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_designs_unique
  ON task_designs(task_id, conversation_id, path);

CREATE INDEX IF NOT EXISTS idx_task_designs_source
  ON task_designs(conversation_id, path);

CREATE TABLE IF NOT EXISTS task_creation_requests (
  actor TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  task_id TEXT NOT NULL,
  PRIMARY KEY (actor, idempotency_key),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_creation_audit (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL UNIQUE,
  created_by TEXT,
  created_by_name TEXT,
  assignee TEXT,
  source TEXT NOT NULL,
  assignment_method TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- ============================ CI-раннер =====================
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

CREATE TABLE IF NOT EXISTS ci_task_process_stages (
  task_id     TEXT PRIMARY KEY,
  stages_json TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ci_llm_configs (
  owner_type TEXT NOT NULL,
  owner_id   TEXT NOT NULL,
  llm_engine_id TEXT,
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
  branch             TEXT,
  commit_sha         TEXT,
  pushed             INTEGER NOT NULL DEFAULT 0,
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
  agent_owner_id TEXT,
  agent_owner_name TEXT,
  agent_selection_source TEXT,
  status         TEXT NOT NULL DEFAULT 'queued',
  error          TEXT,
  workspace_id   TEXT,
  triggered_by   TEXT NOT NULL,
  prev_column_id TEXT,
  run_column_id TEXT,
  terminal_column_id TEXT,
  llm_engine_id  TEXT,
  llm_provider   TEXT NOT NULL DEFAULT 'claude',
  llm_model      TEXT NOT NULL DEFAULT 'opus',
  mode           TEXT NOT NULL DEFAULT 'development',
  clarify_level  TEXT NOT NULL DEFAULT 'few',
  clarify_max    INTEGER NOT NULL DEFAULT 3,
  conversation_id TEXT,
  model_session_id TEXT,
  fix_context_json TEXT,
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

-- Merge — отдельный от development жизненный цикл. Снимок параметров и журнал
-- остаются после рестарта; partial unique index запрещает два активных рана.
CREATE TABLE IF NOT EXISTS merge_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  triggered_by TEXT NOT NULL,
  source_branch TEXT NOT NULL,
  target_branch TEXT NOT NULL DEFAULT 'main',
  source_sha TEXT,
  target_sha TEXT,
  merge_sha TEXT,
  revert_sha TEXT,
  agent_id TEXT NOT NULL,
  llm_engine_id TEXT,
  llm_provider TEXT NOT NULL DEFAULT 'claude',
  llm_model TEXT NOT NULL DEFAULT '',
  requested_llm_provider TEXT,
  requested_llm_model TEXT,
  llm_fallback_reason TEXT,
  stage TEXT NOT NULL DEFAULT 'queued',
  conflicts_json TEXT NOT NULL DEFAULT '[]',
  deploy_id TEXT,
  deploy_version TEXT,
  production_status TEXT,
  error TEXT,
  log TEXT NOT NULL DEFAULT '',
  stages_json TEXT NOT NULL DEFAULT '[]',
  checks_json TEXT NOT NULL DEFAULT '[]',
  recommended_action TEXT,
  push_started_at INTEGER,
  started_at INTEGER,
  finished_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_merge_runs_task ON merge_runs(task_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_merge_runs_one_active_task ON merge_runs(task_id)
  WHERE status IN ('queued','checking','fetching','merging','resolving_conflicts','kb_update','testing','pushing');

-- Учёт репозиториев задачи по машинам: dev-workspace и merge-клоны. Запись
-- создаётся при клонировании, помечается deleted после подтверждённого rm -rf;
-- при закрытии задачи все активные копии удаляются на всех доступных машинах.
CREATE TABLE IF NOT EXISTS task_repositories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  UNIQUE (task_id, agent_id, path),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task_repositories_task ON task_repositories(task_id, state);

-- Наследуемая конфигурация автоматического этапа: owner = project|task.
-- NULL в поле означает наследование этого поля со следующего уровня.
CREATE TABLE IF NOT EXISTS ci_stage_llm_configs (
  owner_type    TEXT NOT NULL,
  owner_id      TEXT NOT NULL,
  stage         TEXT NOT NULL,
  llm_engine_id TEXT,
  provider      TEXT,
  model         TEXT,
  PRIMARY KEY (owner_type, owner_id, stage)
);

-- Самостоятельное выполнение этапа. Тройка LLM здесь — снимок на старте:
-- последующее изменение настроек не переписывает историю и стоимость.
CREATE TABLE IF NOT EXISTS ci_stage_runs (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL,
  task_id       TEXT NOT NULL,
  stage         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'queued',
  llm_engine_id TEXT,
  llm_provider  TEXT NOT NULL,
  llm_model     TEXT NOT NULL,
  outcome       TEXT,
  started_at    INTEGER,
  finished_at   INTEGER,
  duration_ms   INTEGER,
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES ci_runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ci_stage_runs_run ON ci_stage_runs(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ci_stage_runs_task ON ci_stage_runs(task_id, created_at DESC);

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
  changed_files_json TEXT NOT NULL DEFAULT '[]',
  targeted_tests_json TEXT NOT NULL DEFAULT '[]',
  full_rerun_json TEXT,
  failures_json TEXT NOT NULL DEFAULT '[]',
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
-- chars — сколько СИМВОЛОВ ответов этого вида легло в контекст хода: число
-- вызовов о цене не говорит (40 окон read дешевле одного npm ci), а платится
-- именно за объём, перечитываемый на каждом следующем запросе.
CREATE TABLE IF NOT EXISTS ci_run_tool_calls (
  run_id     TEXT NOT NULL,
  tool       TEXT NOT NULL,
  calls      INTEGER NOT NULL DEFAULT 0,
  chars      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, tool),
  FOREIGN KEY (run_id) REFERENCES ci_runs(id) ON DELETE CASCADE
);

-- Пробелы базы знаний, о которых сообщила сама модель (fenced-блок kb-gaps в
-- конце ответа): вопрос, на который база не ответила или ответила неполно, и
-- проверенный по коду ответ. Их читает шаг «Актуализировать базу знаний» — без
-- этой таблицы найденный в коде ответ умирал бы вместе с контекстом хода.
--
-- Ключ (ран, вопрос): fix-loop и повторные ходы называют тот же пробел снова, а
-- дубль в промпте шага превращается в две записи об одном и том же. Ссылки на
-- ci_run_steps нет намеренно — шаг может быть синтетическим (повтор, вложенный
-- вызов), и терять пробел из-за внешнего ключа нельзя.
CREATE TABLE IF NOT EXISTS ci_run_kb_gaps (
  run_id   TEXT NOT NULL,
  question TEXT NOT NULL,
  answer   TEXT NOT NULL DEFAULT '',
  topic    TEXT,
  step_id  TEXT,
  at       INTEGER NOT NULL,
  PRIMARY KEY (run_id, question),
  FOREIGN KEY (run_id) REFERENCES ci_runs(id) ON DELETE CASCADE
);
-- Самые тяжёлые ответы инструментов рана: у «контекст раздулся» должен быть
-- виновник с именем. Хранится не вся лента вызовов, а верхушка по объёму
-- (CI_TOOL_RESPONSES_KEEP строк на ран, лишние удаляются на записи) — это
-- метрика, а сама лента и так лежит в ci_run_logs.
CREATE TABLE IF NOT EXISTS ci_run_tool_responses (
  id             TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL,
  -- Ссылки на ci_run_steps нет по той же причине, что у ci_run_usage: шаг бывает
  -- синтетическим, а метрика не имеет права уронить ран нарушением FK.
  step_id        TEXT,
  tool           TEXT NOT NULL DEFAULT '',
  kind           TEXT NOT NULL DEFAULT 'other',
  label          TEXT NOT NULL DEFAULT '',
  chars          INTEGER NOT NULL DEFAULT 0,
  -- Сколько было до обрезки; NULL — ответ влез целиком.
  original_chars INTEGER,
  at             INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES ci_runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ci_run_tool_responses_run ON ci_run_tool_responses(run_id, chars DESC);

CREATE TABLE IF NOT EXISTS ci_run_kb_metrics (
  run_id             TEXT PRIMARY KEY,
  sections_delivered INTEGER NOT NULL,
  sections_hit       INTEGER NOT NULL,
  hit_ratio          REAL NOT NULL,
  calculated_at      INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES ci_runs(id) ON DELETE CASCADE
);

-- Предложения улучшений отделены от технических логов. fingerprint стабилен
-- внутри задачи; повторный ран дополняет evidence_json существующей записи.
CREATE TABLE IF NOT EXISTS task_improvements (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  run_id TEXT,
  step_id TEXT,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  acceptance_criteria TEXT NOT NULL DEFAULT '',
  created_task_id TEXT,
  fingerprint TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  occurrences INTEGER NOT NULL DEFAULT 1,
  suggested_action TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolved_by TEXT,
  resolved_at INTEGER,
  UNIQUE(task_id, fingerprint),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (created_task_id) REFERENCES tasks(id) ON DELETE SET NULL,
  UNIQUE(created_task_id)
);
CREATE INDEX IF NOT EXISTS idx_task_improvements_task ON task_improvements(task_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_improvements_project ON task_improvements(project_id, status, updated_at DESC);

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

-- Группированный fail-fast pipeline. Конфигурация принадлежит проекту, а каждый
-- run/group хранит неизменяемый commit SHA; результаты разных ревизий не смешиваются.
CREATE TABLE IF NOT EXISTS ci_test_group_configs (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL,
  command         TEXT NOT NULL,
  command_version INTEGER NOT NULL DEFAULT 1,
  position        INTEGER NOT NULL,
  required        INTEGER NOT NULL DEFAULT 1,
  applicability   TEXT NOT NULL DEFAULT 'always',
  enabled         INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ci_test_group_config_position ON ci_test_group_configs(project_id, position);

CREATE TABLE IF NOT EXISTS ci_test_runs (
  id                 TEXT PRIMARY KEY,
  project_id         TEXT NOT NULL,
  task_id            TEXT NOT NULL,
  branch             TEXT NOT NULL,
  commit_sha         TEXT NOT NULL,
  workspace          TEXT NOT NULL,
  agent_id           TEXT,
  preview_id         TEXT,
  preview_commit_sha TEXT,
  analysis_model     TEXT NOT NULL,
  triggered_by       TEXT NOT NULL,
  attempt            INTEGER NOT NULL,
  previous_run_id    TEXT,
  status             TEXT NOT NULL,
  current_group_id   TEXT,
  started_at         INTEGER,
  finished_at        INTEGER,
  duration_ms        INTEGER,
  created_at         INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (previous_run_id) REFERENCES ci_test_runs(id)
);
CREATE INDEX IF NOT EXISTS idx_ci_test_runs_task ON ci_test_runs(task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ci_test_group_runs (
  id                   TEXT PRIMARY KEY,
  test_run_id          TEXT NOT NULL,
  config_id            TEXT NOT NULL,
  name                 TEXT NOT NULL,
  kind                 TEXT NOT NULL,
  command              TEXT NOT NULL,
  command_version      INTEGER NOT NULL,
  position             INTEGER NOT NULL,
  required             INTEGER NOT NULL,
  status               TEXT NOT NULL,
  commit_sha           TEXT NOT NULL,
  started_at           INTEGER,
  finished_at          INTEGER,
  duration_ms          INTEGER,
  exit_code            INTEGER,
  counters_json        TEXT NOT NULL DEFAULT '{}',
  current_suite        TEXT,
  current_test         TEXT,
  progress             REAL,
  log                  TEXT NOT NULL DEFAULT '',
  failures_json        TEXT NOT NULL DEFAULT '[]',
  artifacts_json       TEXT NOT NULL DEFAULT '[]',
  skip_reason          TEXT,
  not_applicable_json  TEXT,
  browser_project      TEXT,
  base_url             TEXT,
  test_data            TEXT,
  FOREIGN KEY (test_run_id) REFERENCES ci_test_runs(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ci_test_group_runs_position ON ci_test_group_runs(test_run_id, position);

CREATE TABLE IF NOT EXISTS ci_test_events (
  id         TEXT PRIMARY KEY,
  run_id     TEXT NOT NULL,
  group_id   TEXT,
  type       TEXT NOT NULL,
  user_id    TEXT,
  payload    TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES ci_test_runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ci_test_events_run ON ci_test_events(run_id, created_at);

CREATE TABLE IF NOT EXISTS ci_test_targeted_runs (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL,
  group_id    TEXT NOT NULL,
  command     TEXT NOT NULL,
  exit_code   INTEGER,
  result_json TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES ci_test_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES ci_test_group_runs(id) ON DELETE CASCADE
);

-- Межстадийные циклы исправления полного grouped pipeline.
CREATE TABLE IF NOT EXISTS ci_test_fix_task_state (
  task_id          TEXT PRIMARY KEY,
  used_attempts    INTEGER NOT NULL DEFAULT 0 CHECK (used_attempts >= 0),
  override_limit   INTEGER CHECK (override_limit IS NULL OR override_limit >= 0),
  active_cycle_id  TEXT,
  updated_at       INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ci_test_fix_cycles (
  id                 TEXT PRIMARY KEY,
  project_id         TEXT NOT NULL,
  task_id            TEXT NOT NULL,
  test_run_id        TEXT NOT NULL,
  failed_group_id    TEXT NOT NULL,
  source_commit_sha  TEXT NOT NULL,
  attempt_no         INTEGER NOT NULL,
  effective_limit    INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'queued',
  classification     TEXT NOT NULL,
  failures_json      TEXT NOT NULL DEFAULT '[]',
  llm_engine_id      TEXT,
  llm_provider       TEXT NOT NULL,
  llm_model          TEXT NOT NULL,
  model_session_id   TEXT,
  diagnosis          TEXT NOT NULL DEFAULT '',
  action             TEXT NOT NULL DEFAULT '',
  changed_files_json TEXT NOT NULL DEFAULT '[]',
  fix_commit_sha     TEXT,
  next_test_run_id   TEXT,
  full_test_result   TEXT,
  blocked_reason     TEXT,
  created_at         INTEGER NOT NULL,
  started_at         INTEGER,
  finished_at        INTEGER,
  UNIQUE (test_run_id, failed_group_id),
  UNIQUE (task_id, attempt_no),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (test_run_id) REFERENCES ci_test_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (failed_group_id) REFERENCES ci_test_group_runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ci_test_fix_cycles_task ON ci_test_fix_cycles(task_id, attempt_no DESC);

CREATE TABLE IF NOT EXISTS ci_test_fix_targeted_runs (
  id            TEXT PRIMARY KEY,
  fix_cycle_id  TEXT NOT NULL,
  command       TEXT NOT NULL,
  status        TEXT NOT NULL,
  exit_code     INTEGER,
  log           TEXT NOT NULL DEFAULT '',
  started_at    INTEGER NOT NULL,
  finished_at   INTEGER,
  FOREIGN KEY (fix_cycle_id) REFERENCES ci_test_fix_cycles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ci_test_fix_targeted_cycle ON ci_test_fix_targeted_runs(fix_cycle_id, started_at);

CREATE TABLE IF NOT EXISTS ci_test_fix_decisions (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  task_id     TEXT NOT NULL,
  cycle_id    TEXT,
  kind        TEXT NOT NULL,
  reason      TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  old_value   INTEGER,
  new_value   INTEGER,
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

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
  stage_models             TEXT,
  bash_output_limit_chars INTEGER NOT NULL DEFAULT 8000,
  read_output_limit_chars INTEGER NOT NULL DEFAULT 24000,
  read_window_max_lines   INTEGER NOT NULL DEFAULT 600,
  grep_match_limit        INTEGER NOT NULL DEFAULT 100,
  grep_output_limit_chars INTEGER NOT NULL DEFAULT 8000
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

-- Серверная граница просмотра бейджа. Телеметрия остаётся неизменной; одна
-- отметка изолирована одновременно владельцем и разговором.
CREATE TABLE IF NOT EXISTS kb_usage_views (
  user_id         TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  last_seq        INTEGER NOT NULL DEFAULT 0,
  viewed_at       INTEGER NOT NULL,
  PRIMARY KEY (user_id, conversation_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

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

-- Пред-разработческая подготовка задачи. Не смешивается с qa_preparation_runs:
-- те строят сценарии ручного QA уже после development.
CREATE TABLE IF NOT EXISTS task_preparation_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  phase TEXT NOT NULL DEFAULT 'initialization',
  attempt INTEGER NOT NULL DEFAULT 1,
  task_key TEXT NOT NULL DEFAULT '',
  machine_id TEXT,
  machine_name_snapshot TEXT,
  llm_engine_id TEXT,
  provider TEXT NOT NULL DEFAULT 'claude',
  model TEXT NOT NULL DEFAULT '',
  profile_id TEXT NOT NULL DEFAULT '',
  log TEXT NOT NULL DEFAULT '',
  error TEXT,
  readiness_json TEXT,
  gate_reasons_json TEXT NOT NULL DEFAULT '[]',
  gate_results_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task_preparation_task ON task_preparation_runs(task_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_preparation_active ON task_preparation_runs(task_id) WHERE status IN ('queued','running','waiting_for_answer','validating');

CREATE TABLE IF NOT EXISTS task_preparation_events (
  event_id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL,
  phase TEXT NOT NULL,
  text TEXT NOT NULL,
  data_json TEXT,
  UNIQUE(attempt_id, sequence),
  FOREIGN KEY (attempt_id) REFERENCES task_preparation_runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task_preparation_events_attempt ON task_preparation_events(attempt_id, sequence);
CREATE TABLE IF NOT EXISTS task_preparation_steps (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  started_at INTEGER,
  finished_at INTEGER,
  error TEXT,
  UNIQUE(attempt_id, ordinal),
  FOREIGN KEY (attempt_id) REFERENCES task_preparation_runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task_preparation_steps_attempt ON task_preparation_steps(attempt_id, ordinal);
CREATE TABLE IF NOT EXISTS task_preparation_questions (
  question_id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  text TEXT NOT NULL,
  material INTEGER NOT NULL DEFAULT 1,
  answer TEXT,
  asked_at INTEGER NOT NULL,
  answered_at INTEGER,
  answered_by TEXT,
  FOREIGN KEY (attempt_id) REFERENCES task_preparation_runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task_preparation_questions_attempt ON task_preparation_questions(attempt_id, asked_at);

-- Закрытие относится только к представлению конкретного вопроса конкретным
-- пользователем и не меняет жизненный цикл подготовки.
CREATE TABLE IF NOT EXISTS task_preparation_notification_dismissals (
  question_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  dismissed_at INTEGER NOT NULL,
  PRIMARY KEY (question_id, user_id),
  FOREIGN KEY (question_id) REFERENCES task_preparation_questions(question_id) ON DELETE CASCADE
);

-- Идемпотентный результат обработки task-launch. Ошибка запуска хранится отдельно:
-- повтор использует уже созданную задачу и повторяет только preparation-run.
CREATE TABLE IF NOT EXISTS task_launch_results (
  project_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  action TEXT NOT NULL,
  task_id TEXT NOT NULL,
  run_id TEXT,
  error TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, proposal_id, action),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- Три пост-development QA-этапа имеют самостоятельные попытки и выборки.
-- Discriminator stage не позволяет смешать их с CI, preparation, manual QA или merge.
CREATE TABLE IF NOT EXISTS qa_stage_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK(stage IN ('component_qa','integration_tests','automated_qa')),
  status TEXT NOT NULL DEFAULT 'queued',
  attempt INTEGER NOT NULL,
  triggered_by TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT '',
  commit_sha TEXT NOT NULL DEFAULT '',
  llm_engine_id TEXT,
  llm_provider TEXT NOT NULL DEFAULT 'claude',
  llm_model TEXT NOT NULL DEFAULT '',
  current_step TEXT NOT NULL DEFAULT 'queued',
  progress_json TEXT NOT NULL DEFAULT '{"current":0,"total":0,"label":""}',
  log_json TEXT NOT NULL DEFAULT '[]',
  result_json TEXT,
  gate_reasons_json TEXT NOT NULL DEFAULT '[]',
  -- Снимок сценария Playwright-этапа на момент запуска: настройку проекта
  -- владелец правит, а ран обязан помнить, что прогонял именно он.
  scenario_json TEXT NOT NULL DEFAULT '',
  error TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_qa_stage_runs_task_stage ON qa_stage_runs(task_id, stage, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_qa_stage_runs_one_active
  ON qa_stage_runs(task_id, stage)
  WHERE status IN ('queued','running','awaiting_input');

-- ======================= Integration test creation =======================
CREATE TABLE IF NOT EXISTS integration_test_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  development_run_id TEXT,
  linked_fix_run_id TEXT,
  branch TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued','running','passed','failed','blocked','cancelled','stale','skipped')),
  readiness_run_id TEXT NOT NULL,
  snapshot_version TEXT NOT NULL,
  test_cases_json TEXT NOT NULL DEFAULT '[]',
  automation_links_json TEXT NOT NULL DEFAULT '[]',
  commands_json TEXT NOT NULL DEFAULT '[]',
  log TEXT NOT NULL DEFAULT '',
  failure_classification TEXT,
  failure_reason TEXT,
  blocker_reasons_json TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL DEFAULT '',
  stale_reason TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (development_run_id) REFERENCES ci_runs(id)
);
CREATE INDEX IF NOT EXISTS idx_integration_test_runs_task ON integration_test_runs(task_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_test_runs_active
  ON integration_test_runs(task_id) WHERE status IN ('queued','running');

-- ============================ Component QA ============================
-- Самостоятельный audit trail, зафиксированный на development workspace/SHA и
-- версии readiness. Существующие карточки component_qa не получают synthetic pass.
CREATE TABLE IF NOT EXISTS component_qa_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  development_run_id TEXT NOT NULL,
  linked_fix_run_id TEXT,
  branch TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  ui_impact TEXT NOT NULL,
  readiness_run_id TEXT NOT NULL,
  readiness_version TEXT NOT NULL,
  scenarios_json TEXT NOT NULL DEFAULT '[]',
  components_json TEXT NOT NULL DEFAULT '[]',
  commands_json TEXT NOT NULL DEFAULT '[]',
  artifacts_json TEXT NOT NULL DEFAULT '[]',
  failure_classification TEXT,
  blocker_reasons_json TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL DEFAULT '',
  log TEXT NOT NULL DEFAULT '',
  storybook_url TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  stale_reason TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (development_run_id) REFERENCES ci_runs(id)
);
CREATE INDEX IF NOT EXISTS idx_component_qa_task ON component_qa_runs(task_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_component_qa_active ON component_qa_runs(task_id)
  WHERE status IN ('queued','running');

-- ============================ Ручное QA ============================
CREATE TABLE IF NOT EXISTS acceptance_criteria (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, position INTEGER NOT NULL,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', preconditions TEXT NOT NULL DEFAULT '',
  steps TEXT NOT NULL DEFAULT '', test_data TEXT NOT NULL DEFAULT '', expected_result TEXT NOT NULL DEFAULT '',
  required INTEGER NOT NULL DEFAULT 1, test_type TEXT NOT NULL DEFAULT 'manual',
  current_version INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1,
  author TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_acceptance_criteria_position ON acceptance_criteria(task_id, position) WHERE active = 1;

CREATE TABLE IF NOT EXISTS acceptance_criterion_versions (
  criterion_id TEXT NOT NULL, version INTEGER NOT NULL, snapshot_json TEXT NOT NULL,
  author TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, superseded_by INTEGER,
  PRIMARY KEY (criterion_id, version),
  FOREIGN KEY (criterion_id) REFERENCES acceptance_criteria(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS qa_preparation_runs (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  task_id     TEXT NOT NULL,
  branch      TEXT NOT NULL,
  commit_sha  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'running',
  log         TEXT NOT NULL DEFAULT '',
  error       TEXT,
  attempt     INTEGER NOT NULL DEFAULT 1,
  diagnostics_json TEXT NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL,
  finished_at INTEGER,
  UNIQUE(task_id, commit_sha),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_qa_preparation_task ON qa_preparation_runs(task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS qa_sessions (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, project_id TEXT NOT NULL, branch TEXT NOT NULL,
  commit_sha TEXT NOT NULL, test_run_id TEXT NOT NULL, preview_id TEXT, preview_sha TEXT,
  app_url TEXT, storybook_url TEXT, test_data_scenario TEXT NOT NULL DEFAULT '',
  criteria_snapshot_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
  tester_id TEXT, initiated_by TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER,
  stale_reason TEXT, summary TEXT NOT NULL DEFAULT '', additional_issues TEXT NOT NULL DEFAULT '', linked_fix_run_id TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_qa_sessions_one_active ON qa_sessions(task_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS qa_criterion_results (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, criterion_id TEXT NOT NULL, criterion_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_tested', draft INTEGER NOT NULL DEFAULT 0,
  tester_id TEXT, assignee_id TEXT, started_at INTEGER, finished_at INTEGER,
  branch TEXT NOT NULL, commit_sha TEXT NOT NULL, preview_id TEXT, preview_sha TEXT,
  app_url TEXT, storybook_url TEXT, test_data_scenario TEXT NOT NULL DEFAULT '',
  executed_steps TEXT NOT NULL DEFAULT '', expected_result TEXT NOT NULL DEFAULT '',
  actual_result TEXT NOT NULL DEFAULT '', comment TEXT NOT NULL DEFAULT '', environment TEXT NOT NULL DEFAULT '',
  blocker_reason TEXT NOT NULL DEFAULT '', blocker_type TEXT, blocker_owner TEXT,
  not_applicable_reason TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES qa_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (criterion_id, criterion_version) REFERENCES acceptance_criterion_versions(criterion_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_qa_result_per_snapshot ON qa_criterion_results(session_id, criterion_id, criterion_version);

CREATE TABLE IF NOT EXISTS qa_issues (
  id TEXT PRIMARY KEY, result_id TEXT NOT NULL UNIQUE, classification TEXT NOT NULL,
  severity TEXT NOT NULL, frequency TEXT NOT NULL, reproduction TEXT NOT NULL,
  proposed_route TEXT NOT NULL, requirement_proposal TEXT NOT NULL DEFAULT '',
  resolution TEXT NOT NULL DEFAULT '', linked_fix_run_id TEXT, created_at INTEGER NOT NULL,
  FOREIGN KEY (result_id) REFERENCES qa_criterion_results(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS qa_attachments (
  id TEXT PRIMARY KEY, result_id TEXT NOT NULL, upload_id TEXT NOT NULL,
  name TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL,
  width INTEGER, height INTEGER, caption TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL, created_at INTEGER NOT NULL, commit_sha TEXT NOT NULL,
  FOREIGN KEY (result_id) REFERENCES qa_criterion_results(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_qa_attachments_result ON qa_attachments(result_id);

CREATE TABLE IF NOT EXISTS qa_audit (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL, session_id TEXT,
  criterion_id TEXT, result_id TEXT, action TEXT NOT NULL, actor TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_qa_audit_task ON qa_audit(task_id, created_at);

-- Версионные релизы: release фиксирует выбранную origin/release/* ревизию,
-- steps дают ленту обязательных ворот, events — неизменяемый аудит повторов.
-- ======================= Оркестрация ассистента =======================
-- План работ, который канбан-ассистент ведёт сам: создать задачи, запустить
-- разработку, дождаться merge и продолжить. Хранится в БД, а не в памяти хода,
-- потому что ожидание merge длиннее любого ответа модели и обязано пережить
-- перезагрузку страницы и рестарт сервера.
CREATE TABLE IF NOT EXISTS assistant_orchestrations (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL,
  conversation_id TEXT,
  owner           TEXT NOT NULL,
  title           TEXT NOT NULL,
  status          TEXT NOT NULL,
  error           TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_assistant_orchestrations_project ON assistant_orchestrations(project_id, status);

CREATE TABLE IF NOT EXISTS assistant_orchestration_items (
  id               TEXT PRIMARY KEY,
  orchestration_id TEXT NOT NULL,
  position         INTEGER NOT NULL,
  kind             TEXT NOT NULL,
  title            TEXT NOT NULL,
  task_id          TEXT,
  depends_on_json  TEXT NOT NULL DEFAULT '[]',
  payload_json     TEXT NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL,
  attempts         INTEGER NOT NULL DEFAULT 0,
  run_id           TEXT,
  result_json      TEXT,
  error            TEXT,
  started_at       INTEGER,
  finished_at      INTEGER,
  FOREIGN KEY (orchestration_id) REFERENCES assistant_orchestrations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_assistant_orchestration_items_run ON assistant_orchestration_items(orchestration_id, position);

CREATE TABLE IF NOT EXISTS project_releases (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, version TEXT NOT NULL, branch TEXT NOT NULL,
  commit_sha TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', triggered_by TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1, previous_release_id TEXT, created_at INTEGER NOT NULL,
  released_at INTEGER, agent_id TEXT, checkout_path TEXT, deleted_at INTEGER,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (previous_release_id) REFERENCES project_releases(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_release_attempt ON project_releases(project_id, branch, attempt);
CREATE INDEX IF NOT EXISTS idx_project_releases_project ON project_releases(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS project_release_steps (
  id TEXT PRIMARY KEY, release_id TEXT NOT NULL, kind TEXT NOT NULL, position INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', model TEXT, attempt INTEGER NOT NULL,
  log TEXT NOT NULL DEFAULT '', started_at INTEGER, finished_at INTEGER, limit_ms INTEGER,
  FOREIGN KEY (release_id) REFERENCES project_releases(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_release_step ON project_release_steps(release_id, position);

CREATE TABLE IF NOT EXISTS project_release_events (
  id TEXT PRIMARY KEY, release_id TEXT NOT NULL, type TEXT NOT NULL, actor TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL,
  FOREIGN KEY (release_id) REFERENCES project_releases(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_project_release_events ON project_release_events(release_id, created_at);

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

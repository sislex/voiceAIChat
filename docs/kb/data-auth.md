---
title: Данные и доступ: SQLite, пользователи, роли
updated: 2026-07-30
checked: a2c30d6
areas:
  - apps/server/src/db
  - apps/server/src/users
  - apps/server/src/uploads.ts
  - apps/server/src/routes/admin.ts
  - packages/shared/src/types.ts
  - packages/shared/src/admin.ts
---

# Данные и доступ: SQLite, пользователи, роли

## Схема

`apps/server/src/db/schema.ts` — единая строка DDL, идемпотентная (`IF NOT EXISTS`),
выполняется при каждом старте; отдельного механизма миграций нет. `PRAGMA
journal_mode = WAL`, `foreign_keys = ON`.

| Таблица | Смысл |
|---|---|
| `conversations` | разговор: `title`, таймстемпы, `claude_session_id` (для `--resume`), `user_id`, `exec_target` (изменяемая цель новых ходов чата), `permission_mode` (режим прав только этого чата; NULL — из общих настроек), `status` (persistent-статус жизненного цикла, по умолчанию `developing`) |
| `messages` | `role` (`u<N>` для говорящих, `ai`), `text`, `engine`, `meta` (JSON `TurnMeta`), `exec_target` (неизменяемый снимок цели выполнения), каскад по разговору |
| `messages_fts` | FTS5-индекс текста сообщений (`content='messages'`, внешнее содержимое) + `fts_state` — состояние бэкфилла |
| `speakers` | метки говорящих внутри разговора |
| `settings` | key-value, значения — JSON-строки |
| `agents` | машины: `token_hash`, `last_seen`, `policy` (JSON), `user_id` |
| `users` | `name` (PK и он же id владельца), `password_hash`, `role`, `blocked` |
| `kb_usage_queries` | обращение к базе знаний: `seq` (монотонный курсор внутри разговора — по нему клиент отсекает устаревшие кадры `kb.usage`), `source` (`auto`/`tool_*`), `status`, `chars`/`est_tokens`, `prompt_chars`, `project_id` — СНИМОК проекта на момент обращения; каскад по разговору |
| `kb_usage_sections` | разделы одного обращения (`document_id`+`anchor`, символы и оценка токенов), каскад по обращению |
| `kb_documents` | статьи базы знаний, которые ведут пользователь и модель: `scope` (`usage`/`user`/`project`), `owner_id` для персональных, `project_id` для проектных (каскад по проекту); файловые темы `docs/kb/*.md` сюда не попадают |

Файл БД — `<dataDir>/voicechat.db` (в Docker `/data`). Тесты работают на
`:memory:` через `BuildOptions.db`. Вложения — `apps/server/src/uploads.ts`
(`POST /api/uploads` → id, путь резолвится в промпт для модели).

Видимость статей `kb_documents` считает не БД, а слой БЗ (`apps/server/src/kb/scoped.ts`
поверх «вида» из `kb/access.ts`): персональная статья — только владельцу, проектная —
участникам проекта (`db.getProject(uid, projectId)`), «Использование» — всем. В таблице
хранится только принадлежность; см. `features/project-knowledge-base.md`.

Итоги обращений к БЗ считаются ОТДЕЛЬНЫМ запросом по `kb_usage_queries`, без
JOIN с `kb_usage_sections`: иначе суммы размножаются по числу разделов. `prompt_chars`
суммируется по одному значению на `turn_id` — промпт хода общий для всех его
обращений. Изоляция: отчёт по чату начинается с `getConversation(userId, id)`,
проектный — с `isProjectMember` (иначе 404). Подробности — `features/kb-usage.md`.

**У desktop своя копия схемы** (`apps/desktop/src/main/db/schema.ts`) — меняя одну,
проверь вторую (см. `architecture.md`, раздел про осознанную дубликацию).

## Полнотекстовый поиск по сообщениям (FTS5)

`messages_fts` — виртуальная таблица FTS5 с **внешним содержимым**
(`content='messages'`, `content_rowid='rowid'`): текст не дублируется, индекс
читает его из `messages`. DDL лежит отдельно от `SCHEMA_SQL` —
`MESSAGES_FTS_SQL` в `schema.ts`, и выполняется в `try/catch`: сборка SQLite без
FTS5 не должна валить старт (тогда `searchMessages` просто отдаёт пустую страницу).

Синхронизацию держат три триггера (`AFTER INSERT/UPDATE/DELETE ON messages`).
Отсюда правило: **правки `messages` идут обычным SQL**, чтобы триггеры сработали;
массовая вставка в обход них разошлась бы с индексом молча.

Токенайзер — `unicode61 remove_diacritics 2`: складывает регистр кириллицы и
снимает диакритику с латиницы. Кириллическую «ё» в «е» он **не** превращает —
это разные токены.

Бэкфилл истории (боевая база до фичи) идёт порциями по 500 сообщений через
`unref`-нутый таймер: старт сервера не ждёт индексации 100k сообщений
(`backfillMessagesFts` — одна порция, `ensureMessagesIndexed` — всё сразу, для
тестов и bench). Состояние — таблица `fts_state`: `last_rowid` (докуда дошли),
`max_rowid` (граница на момент старта — всё новее уже проиндексировано
триггерами), `done`, `repairs`. Старт с `last_rowid = 0` начинается с
`'delete-all'`, поэтому повторный запуск или потерянное состояние **пересобирают**
индекс, а не удваивают его; по завершении — `'integrity-check'` и одна попытка
пересборки, если проверка не прошла.

`searchMessages(userId, { q, projectId?, conversationId?, limit, cursor })`:
ранжирование `bm25()` (меньше — релевантнее), сниппет
`snippet(messages_fts, 0, '<mark>', '</mark>', '…', 12)`, курсор — непрозрачная
пара `(score, rowid)` в base64url. Владелец фильтруется джойном на
`conversations.user_id`, поэтому чужие сообщения недостижимы при любых
параметрах (в том числе при явном `conversationId` или чужом курсоре).
Пользовательский ввод превращает в MATCH `toFtsMatchQuery` (`db/fts.ts`): слова в
кавычках, спецсинтаксис FTS обезврежен, последнее незакрытое слово ищется
префиксом. Стоимость запроса линейна по числу совпадений (~2.8 мкс на
совпадение): на 100k сообщений типичный запрос — 5–75 мс, слово, встречающееся в
70% сообщений, — около 200 мс. Замер: `db/search.perf.test.ts`
(`VC_SEARCH_BENCH=1`).

## Пользователи и роли

`UserRole = 'admin' | 'user'` (`packages/shared/src/types.ts`). Роль ограничивает
доступные модели: `isModelAllowed` / `modelsForRole` / `clampModelForRole` —
зажим применяется на сервере в `turns.ts`, а не только в UI.

Первый запуск на пустой БД создаёт `admin`; пароль берётся из
`VC_ADMIN_PASSWORD` (пусто — без пароля). Если БД уже существует, переменная
ничего не меняет — пароль правится в UI (Настройки → Пользователи). Хеширование —
`apps/server/src/users/passwords.ts`.

## Сессии и авторизация запросов

`POST /api/session/login` → подписанный токен (секрет — `<dataDir>` файл, либо
эфемерный; в тестах инъектируется `sessionSecret`). Клиент шлёт
`Authorization: Bearer …` во все `/api/*` и передаёт токен в WS. Глобальный
`preHandler` (`users/auth.ts`) наполняет `req.user`, проверяет блокировку; список
публичных путей — функция `isPublic` там же. Админские роуты — `requireAdmin`
(403 для не-админа).

**Изоляция данных — по логину**: `uid(req)` возвращает `req.user.name`, и разговоры,
машины и ходы фильтруются по нему. Добавляя роут, работающий с данными
пользователя, обязательно фильтруй по `uid(req)` — забытый фильтр открывает чужие
разговоры. В desktop мостa сессии нет → `authRequired = false` и экран логина не
показывается.

## Админка

`/api/admin/users*` (`routes/admin.ts`, типы в `packages/shared/src/admin.ts`):
список, создание/удаление, блокировка, отчёт по использованию
(`UsageReport`/`UsageUnit`), просмотр чужих разговоров и сообщений. UI —
`packages/ui/src/components/UsersAdmin.tsx`.

## Чтение файлов с диска сервера (`/api/files/read`)

Нужно для картинок, которые создаёт сам CLI. Роут отдаёт файл **только** если его
реальный путь лежит внутри «своей» области пользователя: профиль CLI
(`<dataDir>/cli-users/<base64url(логин)>`), каталог загрузок и заданный им
`settings.workdir`. Проверка — `apps/server/src/serverFiles.ts`, и делается она
**после `realpathSync`**: иначе симлинк внутри профиля превращается в чтение любого
файла контейнера. Чужой путь, системный файл и несуществующий дают одинаковый 404 —
по ответу не должно быть видно, что где лежит. Лимит `SERVER_FILE_MAX_BYTES` 32 МБ
(больше → 413). Расширяешь список корней — помни, что это единственная граница.

**Проекты** (таблицы `projects`/`project_members`/`project_machines`/`kanban_columns`/`tasks`, доступ по членству, а не по единственному владельцу) — см. [projects.md](projects.md).

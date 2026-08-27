---
title: Данные и доступ: SQLite, пользователи, роли
updated: 2026-08-28
checked: bdee3724
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
выполняется при каждом старте. Изменение старых схем по-прежнему делает
`VoiceChatDb.migrate()`; таблица `schema_migrations` хранит маркеры одноразовых
операций над данными. `PRAGMA journal_mode = WAL`, `foreign_keys = ON`.

Вся схема — один шаблонный литерал (`export const SCHEMA_SQL = \`…\``), поэтому в
SQL-комментариях внутри него **нельзя обратных кавычек**: они закрывают литерал, и
файл перестаёт разбираться (typecheck падает не в комментарии, а где-то ниже — искать
приходится глазами). Имена таблиц и колонок в комментариях пишутся без кавычек.

| Таблица | Смысл |
|---|---|
| `conversations` | разговор: `title`, таймстемпы, `claude_session_id` (для `--resume`), `user_id`, `exec_target` (изменяемая цель новых ходов чата), `permission_mode` (режим прав только этого чата; NULL — из общих настроек), `status` (persistent-статус жизненного цикла, по умолчанию `developing`) |
| `conversation_draft_requests` | соответствие `(user_id, idempotency_key)` созданному разговору; обеспечивает повтор первой отправки без дубля и удаляется каскадно вместе с разговором |
| `schema_migrations` | выполненные одноразовые операции над данными |
| `messages` | `role` (`u<N>` для говорящих, `ai`), `text`, `engine`, `meta` (JSON `TurnMeta`), `exec_target` (неизменяемый снимок цели выполнения), каскад по разговору |
| `messages_fts` | FTS5-индекс текста сообщений (`content='messages'`, внешнее содержимое) + `fts_state` — состояние бэкфилла |
| `speakers` | метки говорящих внутри разговора |
| `settings` | key-value, значения — JSON-строки |
| `agents` | машины: `token_hash`, `last_seen`, `policy` (JSON), `user_id` |
| `users` | `name` (PK и он же id владельца), `password_hash`, `role`, `blocked` |
| `session_revocations` | SHA-256 отозванного Bearer-токена и время отзыва; deny-list переживает рестарт сервера |
| `llm_engines` | реестр HTTP-исполнителей LLM для админки: `name`, `kind` (`claude`/`codex`), `base_url`, открытый `token`, `enabled`, `allowed_roles` (JSON-массив ролей), `is_default`, `created_at` |
| `model_prices` | поддерживаемые тарифы Codex/OpenAI: USD за 1M обычных, кэшированных, записанных в кэш и выходных токенов, источник и даты тарифа/обновления; стартовые строки обновляются только через `INSERT OR IGNORE` |
| `kb_usage_queries` | обращение к базе знаний: `seq` (монотонный курсор внутри разговора — по нему клиент отсекает устаревшие кадры `kb.usage`), `source` (`auto`/`tool_*`), `status`, `chars`/`est_tokens`, `prompt_chars`, `project_id` — СНИМОК проекта на момент обращения, `ci_run_id`/`ci_step_id` — ран и шаг CI-раннера, если обращение случилось в его ходе (NULL — обычный чат); каскад по разговору |
| `kb_usage_sections` | разделы одного обращения (`document_id`+`anchor`, символы и оценка токенов), каскад по обращению |
| `kb_documents` | статьи базы знаний, которые ведут пользователь и модель: `scope` (`usage`/`user`/`project`), `owner_id` для персональных, `project_id` для проектных (каскад по проекту); файловые темы `docs/kb/*.md` сюда не попадают |

Файл БД — `<dataDir>/voicechat.db` (в Docker `/data`). Тесты работают на
`:memory:` через `BuildOptions.db`. Вложения — `apps/server/src/uploads.ts`
(`POST /api/uploads` → id, путь резолвится в промпт для модели).

`llm_engines` живёт в той же схеме без отдельного migration-фреймворка:
`schema.ts` создаёт таблицу и индексы на новых базах, а `VoiceChatDb.migrate()`
добавляет недостающие колонки и индексы на уже существующих. Это важно для
старых инсталляций: тест на legacy-БД фиксирует, что появление `llm_engines` не
ломает чтение старых `conversations` и не требует ручного шага миграции.

В конструкторе `VoiceChatDb` присвоение `this.newId`/`this.now` идёт **до**
`this.migrate()`: миграции тоже пишут строки (например, досоздание системных
workflow-колонок канбана). Инцидент 2026-08-18 (релиз 0.1.74): миграция
вызывала `this.newId()` до его присвоения, прод падал на старте с
`TypeError: this.newId is not a function`, при этом гейт был зелёным — на
свежей `:memory:`-БД у проектов нет недостающих колонок и ветка не выполнялась.
Урок: миграцию, зависящую от данных, тестируй на переоткрытии файла с
искусственно «состаренной» строкой (см. тест «инцидент 2026-08-18» в
`database.projects.test.ts`), а не только на пустой базе.

`createConversationDraft()` в `apps/server/src/db/database.ts` атомарно создаёт
обычный разговор, применяет проект и сохраняет первую реплику. Ключ запроса уникален
только внутри пользователя; повтор возвращает тот же разговор с сообщениями.
Одноразовая операция `cleanup-empty-manual-drafts-v1` удаляет старые пустые ручные
строки только при полном наборе дефолтных признаков. Проект, задача, служебный тип,
CLI-сессия, переименование или любая настройка сохраняют разговор.

У реестра два инварианта на уровне SQLite: индекс
`idx_llm_engines_kind_enabled` обслуживает список по `kind/enabled/created_at`, а
частичный unique-индекс `idx_llm_engines_default_kind` не даёт держать две
default-записи одного `kind`. Сам токен хранится в БД открытым текстом;
ограничение доступа обеспечивается не схемой, а тем, что CRUD и health-check
висят только на `requireAdmin` в `apps/server/src/routes/admin.ts`.

Отчёт `usageSummary(from, to)` агрегирует всех пользователей одной SQL-выборкой: на дашборд возвращаются totals и `byModel`, включая нулевые строки пользователей. Админский `GET /api/admin/users/usage-summary` защищён `requireAdmin` и принимает необязательные timestamps `from`/`to`.

Личные API для виджета — `GET /api/me/usage` и `GET /api/me/llm-access`: оба берут владельца только из `uid(req)`, не из query или URL. У первого те же необязательные `unit` (`hour`/`day`/`week`), `from`, `to` и `conversationId`, что у `GET /api/usage`, и он возвращает `UsageReport`; второй возвращает `UserLlmAccess[]`. Старые `GET /api/usage` и `GET /api/llm-access` остаются сессионными алиасами, но web-мост обращается к новым `/api/me/*` путям.

Видимость статей `kb_documents` считает не БД, а слой БЗ (`apps/server/src/kb/scoped.ts`
поверх «вида» из `kb/access.ts`): персональная статья — только владельцу, проектная —
участникам проекта (`db.getProject(uid, projectId)`), «Использование» — всем. В таблице
хранится только принадлежность; см. `features/project-knowledge-base.md`.

Итоги обращений к БЗ считаются ОТДЕЛЬНЫМ запросом по `kb_usage_queries`, без
JOIN с `kb_usage_sections`: иначе суммы размножаются по числу разделов. `prompt_chars`
суммируется по одному значению на `turn_id` — промпт хода общий для всех его
обращений. Изоляция: отчёт по чату начинается с `getConversation(userId, id)`,
проектный, по рану и по задаче — с `isProjectMember` (иначе 404).
Подробности — `features/kb-usage.md`.

Срез отчёта — это только `WHERE`: итоги (`kbUsageTotals`), разделы
(`kbUsageSections`) и лента (`kbUsageQueries`) — приватные хелперы с общим
условием по алиасу `q`, а чат/проект/ран/задача подставляют своё
(`q.ci_run_id = ?`, для задачи — подзапрос по `ci_runs`). Четыре копии одного
`GROUP BY` разъехались бы в мелочах вроде порядка сортировки, и одни и те же
обращения показывали бы разные числа в чате и в карточке задачи.

`ci_run_id`, `ci_step_id` и индекс `idx_kb_usage_ci_run` добавляет только
`migrate()`, а не `SCHEMA_SQL`: на базе, которая старше этих колонок,
`CREATE TABLE IF NOT EXISTS` их не создаст, и `CREATE INDEX` в общей DDL-строке
уронил бы старт. Тот же приём — у CI-полей `projects` (`ci_kb_context_mode`,
`auto`|`manual`|`off`, дефолт `auto`) и у `ci_runs.kb_context_mode` — снимка
этой настройки на момент старта рана.

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

`UserRole = 'admin' | 'developer' | 'tester' | 'observer'` (`packages/shared/src/types.ts`). Проектные полномочия централизованы в `apps/server/src/users/auth.ts`: `admin` разрешены все текущие и будущие операции; `developer` — просмотр, создание и редактирование задач, запуск и повтор workflow, а также merge; `tester` и `observer` пока не имеют отдельных разрешений. Подготовка release, production deploy, управление пользователями и ролями, а также настройки проекта доступны только `admin`. `projectPermissionForRequest` классифицирует защищённые HTTP-операции в глобальном auth-hook до обращения к данным, а маршрутные `requireProjectPermission(...)` фиксируют требуемое полномочие рядом с обработчиком; прямой HTTP-запрос поэтому не обходит UI. Админский API принимает все четыре роли при создании пользователя и меняет роль через `PATCH /api/admin/users/:name`. Legacy-роль `user` мигрирует в `developer`, а только конкретные существующие аккаунты ChatAI `admin` и `admin1` повышаются до `admin`, поэтому будущие пользователи автоматически привилегий не получают.

Роль по-прежнему отдельно участвует в `llm_engines.allowed_roles`; это не механизм персонального доступа к моделям. Модели разрешаются через `user_llm_access`: каждая строка deny-list — `(user_name, provider, model_id)`, а `model_id = '*'` запрещает весь provider. Отсутствие строк означает полный доступ, поэтому новые пользователи и модели, позднее добавленные в `CLAUDE_MODELS`/`CODEX_MODELS`, не требуют миграции прав. Внешний контракт и чистые проверки (`isProviderAllowed`, `allowedModels`, `clampModel`, `firstAllowedProvider`) находятся в `packages/shared/src/llmAccess.ts`.

`getUserLlmAccess`/`setUserLlmAccess` читают и атомарно заменяют список запретов. Администратор работает через защищённые `GET/PUT /api/admin/users/:name/llm-access`; PUT принимает только `claude`/`codex`, `*` или известный id модели и убирает дубликаты. Пользователь может прочитать только собственный список через `GET /api/llm-access`. При удалении пользователя строки прав удаляются каскадным внешним ключом таблицы.

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

Каждый login получает отдельный токен: `signToken()` в `users/accounts.ts` добавляет
случайный `sid` в подписанный payload. `POST /api/session/logout` принимает только
действующий текущий Bearer, сохраняет его SHA-256 через `VoiceChatDb.revokeSession()`
и удаляет preview-cookie. Глобальная проверка сессии и выпуск preview-cookie сверяются
с `session_revocations`, поэтому отозванный токен не действует и после рестарта;
другие сессии аккаунта и новый login остаются рабочими.

Web-мост `packages/ui/src/remote/index.ts` удаляет `vc.session.token` и переподключает
WebSocket только после успешного ответа logout. При ошибке токен и пользовательское
состояние сохраняются, а store показывает уведомление. Успешный выход очищает
сессионное состояние UI и ведёт на экран входа после подтверждения в меню пользователя.
Он не удаляет чаты, проекты, задачи или настройки и не меняет CLI-профили и входы
Claude, Codex и других внешних сервисов.

**Изоляция данных — по логину**: `uid(req)` возвращает `req.user.name`, и разговоры,
машины и ходы фильтруются по нему. Добавляя роут, работающий с данными
пользователя, обязательно фильтруй по `uid(req)` — забытый фильтр открывает чужие
разговоры. В desktop мостa сессии нет → `authRequired = false` и экран логина не
показывается.

## Админка

`/api/admin/users*` (`routes/admin.ts`, типы в `packages/shared/src/admin.ts`):
список, создание/удаление, блокировка, отчёт по использованию
(`UsageReport`/`UsageUnit`), просмотр чужих разговоров и сообщений. Отчёт принимает
`from`, `to`, `unit` и необязательный `conversationId`, возвращает агрегаты по
бакетам, моделям и разговорам. Для сообщений Codex без `meta.costUsd`
`model_prices` редактируются только админом через `GET/PUT/DELETE /api/admin/model-prices`. `usageReport` всегда возвращает две независимые суммы: `costUsd` (что сообщил CLI) и `costFromPrices` (пересчёт по `model_prices`) для Claude и Codex; обычный вход считается как
`inputTokens - cacheReadTokens`, чтобы кэш не оплачивался дважды. Таблица содержит
USD за 1M обычных/кэшированных/записанных в кэш/выходных токенов, URL источника и
даты тарифа/обновления; начальные строки OpenAI сидятся `INSERT OR IGNORE`, поэтому
будущее ручное обновление цен переживает рестарт. Неизвестная модель не получает
семейный выдуманный тариф: её известная часть суммы равна нулю, а в `UsageReport`
ставится `costIncomplete`; UI показывает «—», а не ложные `$0.0000`. UI —
`packages/admin-app/src/UsersAdmin.tsx`. Store административного модуля не использует личные `GET /api/llm-access` и `GET /api/usage`: выбранный пользователь загружается только защищёнными admin-операциями. Host adapter после изменения собственной роли обновляет сессию и собственный LLM access; потеря роли admin очищает store и закрывает модуль. Deny-list остаётся отдельным от роли механизмом и заменяется атомарно.

## Чтение файлов с диска сервера (`/api/files/read`)

Нужно для картинок, которые создаёт сам CLI. Роут отдаёт файл **только** если его
реальный путь лежит внутри «своей» области пользователя: профиль CLI
(`<dataDir>/cli-users/<base64url(логин)>`), каталог загрузок и заданный им
`settings.workdir`. Проверка — `apps/server/src/serverFiles.ts`, и делается она
**после `realpathSync`**: иначе симлинк внутри профиля превращается в чтение любого
файла контейнера. Чужой путь, системный файл и несуществующий дают одинаковый 404 —
по ответу не должно быть видно, что где лежит. Лимит `SERVER_FILE_MAX_BYTES` 32 МБ
(больше → 413). Расширяешь список корней — помни, что это единственная граница.

Сам профиль создаёт уже не сервер: `cliProfiles.ts` переехал в
`apps/llm-runner/src/cli/`. Путь совпадает, пока сервер и исполнитель делят один
`VC_DATA_DIR` (сейчас — один контейнер); разъедутся тома — этот роут перестанет
видеть картинки, созданные CLI.

**Проекты** (таблицы `projects`/`project_members`/`project_machines`/`kanban_columns`/`tasks`, доступ по членству, а не по единственному владельцу) — см. [projects.md](projects.md).

**Rate-limit входа (auth-roadmap п.1).** `POST /api/session/login` считает попытки двумя `SlidingWindowLimiter` (`apps/server/src/make/rateLimit.ts`): по `req.ip` и по имени (в нижнем регистре), 10 за 10 минут каждый; превышение — 429 с заголовком `Retry-After` и телом `{ error, retryAfterSec }`. Успешный вход счётчик не сбрасывает (окно скользящее), поэтому 11-я попытка с одного IP за окно блокируется даже при верном пароле. Лимитеры живут в памяти процесса — после рестарта сервера обнуляются; за прокси нужен корректный `trustProxy`, иначе все клиенты делят один IP.

**Политика пароля (auth-roadmap п.2).** `checkPasswordPolicy(password, { name })` из `@shared/passwordPolicy` — общий для сервера и форм: пустой, короче `PASSWORD_MIN_LENGTH` (10), один повторяющийся символ, из списка частых или содержащий логин → текст причины. `POST /api/admin/users` отвечает 400 с этим текстом; в админке placeholder поля пароля напоминает про 10 символов. Опционально `VC_HIBP_CHECK=1` включает `pwnedCount` (`users/pwned.ts`): SHA-1 пароля, наружу — только 5 hex-символов префикса (`api.pwnedpasswords.com/range/`), таймаут 3 с, ошибка сети — fail-open. Пароли, заведённые до правила (в т.ч. пустые), не трогаются: политика проверяется только при установке.

**Блокировка после неудачных входов (auth-roadmap п.3).** В `users` добавлены `failed_logins`, `locked_until` (мс, wall-clock `Date.now()`, а не тестовые часы БД) и `lock_reason`. `recordLoginFailure(name)` инкрементирует счётчик подряд: с `LOGIN_LOCK_FAILS` (5) ставит `locked_until = now + 15 мин`, с `LOGIN_HARD_LOCK_FAILS` (10) выставляет `blocked = 1, lock_reason = 'auto'`. Логин при действующем замке отвечает 423 с `Retry-After` до проверки пароля; успешный вход вызывает `resetLoginFailures` и `forget` окна rate-limit по имени; `setUserBlocked(name, false)` снимает и замок, и счётчик. Rate-limit по IP поднят до 30/10 мин (NAT), по имени — 10. Уведомление админу — предупреждение в лог сервера (`auth: аккаунт заблокирован автоматически…`) и статусы в `AdminUserInfo` (`failedLogins`, `lockedUntil`, `lockReason`), которые админка показывает бейджами; тесты сбрасывают лимитеры через `app.resetLoginLimiters()`.

**Сессии с TTL и отзывом (auth-roadmap п.4).** Таблица `sessions (sid, user_name, created_at, last_seen, expires_at, ip, user_agent, revoked_at)`; `sid` — тот же случайный id, что зашит в payload HMAC-токена (`signToken(user, secret, sid)`, `verifyToken` возвращает `{ name, sid }`). Логин пишет строку (`createSession`, TTL `SESSION_TTL_MS` = 30 дней), каждый запрос проверяет её (`getSession`: отозвана/истекла → 401) и продлевает `last_seen/expires_at` не чаще раза в минуту (`touchSession`); токены без строки (выданы до таблицы) регистрируются лениво с UA `legacy`, а строка с `revoked_at` уже не воскрешается (`hasSessionRow`). Logout отзывает и токен (`session_revocations`), и строку; `POST /api/session/logout-all` гасит все, кроме текущей; `DELETE /api/session/:sid` — одну свою; админ: `GET /api/admin/users/:name/sessions`, `DELETE /api/admin/sessions/:sid`. `pruneSessions()` на старте удаляет истёкшие и отозванные старше недели. UI: пункт меню аккаунта «Сессии и устройства» (`SessionsDialog`, мост `window.session.sessions/logoutAll/revokeSession` — только web), в админке `<details>` «Сессии» у пользователя (`admin:userSessions`, `admin:revokeSession`).

**Cookie-сессия и CSRF (auth-roadmap п.5).** Логин, помимо `token` в теле, ставит `vc_session=<тот же HMAC-токен>; Path=/; HttpOnly; SameSite=Strict` (+`Secure`, если `x-forwarded-proto`/протокол https) и читаемую `vc_csrf` (случайная строка, в теле — `csrf`). PreHandler берёт токен в порядке Bearer → `vc_session` → preview-cookie; если авторизация пришла из cookie, любой не-GET/HEAD/OPTIONS запрос обязан нести заголовок `x-vc-csrf`, равный cookie `vc_csrf`, иначе 403 `{ error: 'csrf' }` — чужой сайт cookie отправит, заголовок поставить не сможет. WS-upgrade принимает `vc_session` из Cookie, если нет `?token=`. Logout гасит обе cookie (и preview). Web-клиент (`remote/session.ts`) держит Bearer только в памяти после свежего входа, `authHeaders()` добавляет Bearer при наличии и `x-vc-csrf` всегда при cookie-сессии; при старте `migrateLegacyToken` отправляет унаследованный localStorage-токен на `POST /api/session/cookie` и удаляет его из localStorage. `WsClient` получает маркер `'cookie'` вместо токена и подключается без query. Desktop и агенты продолжают ходить с Bearer — для них CSRF не требуется.

**Второй фактор TOTP (auth-roadmap п.6).** `users/totp.ts` — RFC 6238 (HMAC-SHA1, 30 с, 6 цифр, окно ±1 шаг), base32-секрет, `otpauthUrl`; тесты на векторах RFC. Колонка `users.totp_secret` (NULL — выключено; `UserRow.totpEnabled`). Логин с включённым фактором после верного пароля отвечает `{ requires2fa: true, ticket }` (тикет — в памяти процесса, 5 минут, 5 попыток, одноразовый), `POST /api/session/2fa { ticket, code }` выдаёт сессию тем же `issueSession`, что и обычный вход. Настройка: `POST /api/session/2fa/setup` → `{ secret, otpauth, enabled }` (секрет ждёт подтверждения 10 минут), `POST …/enable { code }` включает, `POST …/disable { code }` выключает, `GET /api/session/2fa` — статус. Клиент: `RendererSessionBridge.login` может вернуть `LoginChallenge`, `sessionStore.twoFactorTicket` переводит `LoginScreen` в режим кода (`onCode`/`onCancelTwoFactor`), `runtime.loginCode`; настройка — пункт меню аккаунта «Двухфакторная защита» → `TwoFactorDialog` (QR не рисуем: otpauth-ссылка и ключ для ручного ввода). WebAuthn/passkeys отложены.

**Журнал безопасности (auth-roadmap п.7).** Таблица `security_events (id, at, user_name, type, ip, user_agent, details)`; `db.logSecurityEvent` пишут: вход (`login`, из `issueSession`), неверный пароль/замок (`login_failed`/`login_locked` с деталями), неверный код 2FA, выход, «выйти везде» (с числом отозванных), включение/выключение 2FA, создание учётки администратором (`password_set`), блокировка/разблокировка админом. Хранятся последние ~50 000 записей (чистка вероятностная при вставке). `GET /api/admin/security?user=&limit=` (до 1000, по умолчанию 200) → `{ events: SecurityEvent[] }`; в админке у выбранного пользователя вкладка «Безопасность» (`admin:securityEvents`, `adminStore.loadAdminSecurity`), неудачи и блокировки подсвечены. Типы — `SecurityEventType` в `@shared/admin`.

**Инвайты и саморегистрация (auth-roadmap п.8).** Таблица `invites (token, role, created_by, created_at, expires_at, max_uses, uses, note)`; админ создаёт ссылку `POST /api/admin/invites { role, ttlHours (1–720, по умолчанию 72), maxUses (1–100), note }`, список `GET`, отзыв `DELETE /api/admin/invites/:token`; событие `invite_created` в журнале. Гость открывает `#/invite/<token>` — `App` до экрана логина рендерит `InviteRegister` (мосты `session.inviteInfo/register`): `GET /api/session/invite/:token` → роль/срок/заметка (404 для истёкшего/исчерпанного), `POST /api/session/register { token, name, password }` — логин `^[a-zA-Z0-9._-]{3,32}$`, `checkPasswordPolicy`, 409 на занятый логин, лимит 5 регистраций/час с IP; создаёт пользователя с ролью инвайта, `consumeInvite`, пишет `registered` в журнал и сразу выдаёт сессию (`issueSession`), клиент перезагружает страницу с `#/`. `pruneInvites()` чистит истёкшие/исчерпанные старше недели (вызов планировщика — п.18). В админке `<details>` «Инвайт-ссылки» под формой создания пользователя: форма (роль/срок/использований/заметка), список с URL, «Копировать», «Отозвать».

**Сброс, временный пароль и смена пароля (auth-roadmap пп.10–12).** Колонки `users.reset_code_hash/reset_code_expires/must_change_password`. Админ: `POST /api/admin/users/:name/reset-code` → `{ code (8 символов A–Z0–9), expiresAt (+24 ч) }`, в БД хранится scrypt-хеш кода, событие `reset_code_issued`; кнопка «Код сброса» в карточке пользователя показывает код один раз. Пользователь на экране входа («Есть код сброса от администратора?») отправляет `POST /api/session/reset { name, code, password }`: политика пароля, лимит 5/час с IP, `redeemResetCode` ставит пароль, снимает код/замок/флаг, все сессии отзываются, выдаётся новая (`password_reset`). Временный пароль: `POST /api/admin/users` с `mustChangePassword: true` (флажок включён по умолчанию) → `SessionUser.mustChangePassword` в ответах login/me; preHandler отвечает 403 `{ error: 'password_change_required' }` на любые не-GET запросы к `/api/*` (сессионные роуты публичны), клиент при этом флаге показывает `ChangePasswordDialog` без возможности закрыть (только сменить или выйти). Смена своего пароля — `POST /api/session/password { current, next }` (текущий обязателен, политика, новый ≠ текущему), остальные сессии отзываются, событие `password_changed`; пункт «Сменить пароль» в меню аккаунта. Аватар — поле `UserPersonalization.avatar` (эмодзи или 1–2 символа) на странице персонализации, показывается в кнопке аккаунта сайдбара.

**UX входа, «запомнить меня», новое устройство, лимиты, обслуживание (auth-roadmap пп.14–18).** `LoginScreen`: кнопка 👁 показать пароль, предупреждение о Caps Lock (`getModifierState`), галка «Запомнить меня» (по умолчанию включена) → `login { remember }`: `issueSession(…, remember)` даёт TTL 30 дней с `Max-Age` либо 12 часов (`SESSION_SHORT_TTL_MS`) и сессионные cookie; `touchSession` продлевает на собственный интервал сессии. Новое устройство: при входе, если среди живых сессий пользователя нет пары UA+IP, пишется `login_new_device`; `/api/session/me` возвращает `notices` (непросмотренные события после `users.notices_seen_at`), клиент (App) показывает тосты и вызывает `POST /api/session/notices/seen`. Роль `observer` — только чтение: `turns.start` отвечает `claude.error`. Лимит расхода: `users.llm_limit_usd` (`PATCH /api/admin/users/:name { llmLimitUsd }`, поле в карточке пользователя), `turns.start` сравнивает месячную стоимость из `usageSummary(начало месяца)` (max из costUsd и costFromPrices) и отказывает при превышении. `users.last_login` обновляется при каждом входе. Суточный `accountsSweep` (server.ts, сразу при старте): `pruneSessions`, `pruneInvites`, `blockInactiveUsers(days)` для не-админов без входов дольше `VC_INACTIVE_DAYS` (180 по умолчанию, 0 — выключить) → `blocked=1, lock_reason='inactive'` и событие `inactive_blocked`.

**Переход на cookie-сессию: одноразовый эффект для открытых вкладок.** Старый бандл берёт Bearer из localStorage на каждый запрос. Как только любая вкладка того же origin загрузит новый бандл, `migrateLegacyToken` переносит токен в cookie и удаляет его из localStorage — соседние вкладки со старым бандлом остаются без Authorization, их мутации идут по cookie без `x-vc-csrf` и получают 403 `{ error: 'csrf' }` до перезагрузки (наблюдалось в Release Center сразу после деплоя 0.1.171). Лечится обновлением вкладки; данных не теряет.

**Открытая регистрация с подтверждением email.** Включается администратором: `PUT /api/admin/signup { enabled, role }` (раздел «Открытая регистрация» над инвайтами в админке; хранится в `app_config` как `signup.enabled`/`signup.role`, роль новых по умолчанию developer). Публичный флоу: `GET /api/session/signup` → `{ enabled }` (клиент показывает ссылку «Зарегистрироваться» только при true); `POST /api/session/signup { name, email, password }` — логин `^[a-zA-Z0-9._-]{3,32}$`, email, `checkPasswordPolicy`, лимит 5/час с IP; заявка ложится в `email_verifications` (хеш токена, хеш пароля, 24 ч; повторная заявка на email/логин заменяет прежнюю), уходит письмо со ссылкой `<publicUrl>/#/verify/<token>`; занятый логин — 409, занятый email — тот же `{ ok: true }` без письма (не раскрываем чужие адреса). `POST /api/session/signup/resend { email }` перевыпускает токен ожидающей заявки. `POST /api/session/verify { token }` создаёт пользователя с ролью из настройки и `users.email` (уникальный индекс), пишет `signup_verified` и выдаёт сессию (`issueSession`); клиент `VerifyScreen` затем перезагружает страницу. Письма — `users/mailer.ts`: собственный SMTP-клиент без зависимостей (`smtp://user:pass@host:587` со STARTTLS или `smtps://…:465`, AUTH PLAIN/LOGIN, base64-тело, multipart text+html); без `VC_SMTP_URL` мейлер «консольный» — письмо целиком пишется в лог сервера (`mail (SMTP не настроен…)`), ответ заявки содержит `mailSent: false`, а экран «Проверьте почту» предупреждает об этом. Переменные окружения: `VC_SMTP_URL`, `VC_MAIL_FROM` (`ChatAI <no-reply@домен>`), `VC_PUBLIC_URL` (иначе ссылка строится из `x-forwarded-proto/host`). Для тестов `BuildOptions.mailer` подменяет отправку.

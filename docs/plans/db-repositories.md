# Слой данных по доменам — карта владения таблицами и план разреза

Живая реализация: `apps/server/src/db/database.ts` (ядро: соединение, схема, миграции,
раздача репозиториев), `apps/server/src/db/repos/<домен>.ts` (запросы одного домена),
`apps/server/src/db/ownership.ts` (манифест владения) и `ownership.test.ts` (гейт).

## Зачем

Цель проекта — разнести чат, канбан, make, авторизацию и т.д. на независимо релизящиеся
приложения с общей авторизацией и общими данными. Главное препятствие было не в UI (он уже
разложен по `packages/*-app`) и не в раннерах (уже отдельные процессы), а в слое данных: один
класс `VoiceChatDb` на 10,5 тыс. строк, 573 члена и 113 таблиц, синхронный `better-sqlite3`,
тысячи вызовов `db.<метод>()` по всему серверу без какого-либо понятия «чья это таблица».
Пока так — любая правка схемы одного приложения потенциально ломает все остальные, и релизить
приходится целиком.

Разрез идёт **от слоя доступа, а не от движка**: сначала явные владельцы таблиц и видимые
кросс-доменные обращения, потом асинхронные порты, и только потом (если понадобится) смена
движка на Postgres — уже как замена реализации одного репозитория, а не переписывание сервера.
Почему не наоборот — см. журнал `docs/kb/log/2026-09-07-*-db-repositories.md`.

## Карта владения (круг 1)

Правило: у каждой таблицы **ровно один** репозиторий-владелец, и только он пишет в неё. Чтение
чужих таблиц через `JOIN` допускается, но считается (`CROSS_READ_BUDGET`) и не должно расти.
Запись в чужую таблицу гейт не пропускает вовсе (с круга 2): нужно изменить чужие данные —
у владельца появляется метод, и его зовут через `this.repos.<домен>`.

| Репозиторий | Таблицы | Будущий сервис |
|---|---|---|
| `identity` | `users`, `sessions`, `session_revocations`, `security_events`, `invites`, `email_verifications`, `password_reset_tokens`, `login_device_emails`, `user_llm_access` | auth / аккаунт |
| `settings` | `settings`, `app_config`, `schema_migrations` | аккаунт (настройки), ядро |
| `llm` | `llm_engines`, `model_prices` | admin / LLM-шлюз |
| `chat` | `conversations`, `messages`, `messages_fts`, `fts_state`, `speakers`, `conversation_context_events`, `conversation_draft_requests`, `conversation_turn_queue`, `conversation_turn_control`, `conversation_workspaces` | чат |
| `machines` | `agents`, `machine_commands`, `machine_events`, `machine_storages`, `chat_storage_bindings`, `generated_cleanup_retry`, `login_enrollments`, `machine_project_shares`, `machine_project_share_audit`, `project_machines`, `user_project_machine_defaults`, `git_workspace_locks` | машины |
| `projects` | `projects`, `project_members`, `project_member_role_audit`, `project_invitations`, `project_types`, `project_type_review_audit`, `kanban_columns`, `board_views` | проекты (ядро канбана) |
| `tasks` | `tasks`, `task_*` (комментарии, ворклог, история, дизайны, заявки, улучшения, доработки, репозитории, результаты запуска, подготовка), `assistant_orchestrations`, `assistant_orchestration_items` | канбан |
| `ci` | `ci_*` (30 таблиц), `merge_runs`, `integration_test_runs`, `component_qa_runs` | конвейер задач |
| `qa` | `qa_*`, `acceptance_criteria`, `acceptance_criterion_versions` | ручное и автоматическое QA |
| `releases` | `project_releases`, `project_release_steps`, `project_release_events` | Release Center |
| `kb` | `kb_documents`, `kb_usage_queries`, `kb_usage_sections`, `kb_usage_views` | база знаний |

Make в БД таблиц не имеет: его состояние — файловые workspaces (`apps/server/src/make`),
поэтому он и есть самый чистый кандидат на первое отдельное приложение.

### Что получилось после разреза

| Репозиторий | Строк | Членов | Пишет в чужие таблицы (после круга 2) | Читает чужих таблиц |
|---|---|---|---|---|
| `tasks` | ~2 100 | 107 | — | 17 |
| `ci` | ~1 830 | 130 | — | 7 |
| `chat` | ~1 500 | 63 | — | 5 |
| `projects` | ~1 300 | 72 | — | 5 |
| `machines` | ~720 | 55 | — | 3 |
| `kb` | ~650 | 20 | — | 3 |
| `identity` | ~570 | 65 | — | 0 |
| `qa` | ~500 | 37 | — | 4 |
| `llm` | ~150 | 12 | — | 0 |
| `releases` | ~100 | 12 | — | 0 |
| `settings` | ~70 | 6 | — | 0 |

Ядро `database.ts` (~890 строк) — конструктор, `migrate()` (пишет в 13 таблиц разных доменов —
это ожидаемо для миграций и в гейт не входит), `runOnce`, `close`. Общие типы строк и чистые
помощники, нужные нескольким доменам, — `repos/support.ts`.

Точные цифры — в `ownership.ts` (гейт сверяет их с кодом); таблица выше — ориентир.

## Круг 1 — владение таблицами явное, вызовы адресные

| № | Пункт | Статус |
|---|---|---|
| 1 | `VoiceChatDb` разрезан на 11 доменных репозиториев в `db/repos/`; ядро — соединение, схема, миграции | ✅ |
| 2 | Каждая таблица схемы имеет ровно одного владельца — `ownership.ts` + тест | ✅ |
| 3 | Все ~4 800 обращений на сервере переведены с `db.<метод>()` на `db.<домен>.<метод>()` — кросс-доменные вызовы видны по месту вызова | ✅ |
| 4 | Репозитории не импортируют друг друга; соседи — только через `this.repos.<домен>` | ✅ |
| 5 | Кросс-доменные записи перечислены поимённо (`KNOWN_CROSS_WRITES`) и не могут расти молча — список закрыт кругом 2 | ✅ |
| 6 | Бюджет чужих чтений на репозиторий (`CROSS_READ_BUDGET`) — трещотка | ✅ |
| 7 | `better-sqlite3` импортируется только внутри `src/db` | ✅ |
| 8 | Моки БД в тестах — той же формы `{ домен: { метод } }`, что и реальный объект | ✅ |
| 9 | Полный гейт зелёный (`npm run gate`, код возврата 0), приложение проверено глазами в браузере: чат с историей, список проектов, админка пользователей с карточкой, машины — все 17 API-запросов 200 | ✅ |

Разрез сделан кодомодом на TypeScript compiler API (метод → домен по таблицам, в которые он
пишет; спорные — вручную), а не руками: 10,5 тыс. строк и 4 800 вызовов руками не переносятся
без потерь. Тела методов перенесены дословно — поведение не менялось, менялись только адреса.

## Круг 2 — закрыть долг кросс-доменных записей

Каждая строка `KNOWN_CROSS_WRITES` была местом, где один домен правит данные другого в обход
владельца. Пока это одна SQLite и одна транзакция — работало; при выносе домена в свой сервис
работать перестало бы. Закрыто по одному; SQL внутри новых методов владельцев — тот же, что
был в чужом месте, поэтому поведение не менялось, менялся адрес. Каскады по-прежнему идут в
одной транзакции инициатора (репозитории делят соединение), но теперь initiator знает только
«кого позвать», а не «какие таблицы править».

| № | Пункт | Статус |
|---|---|---|
| 1 | `identity.deleteUserData` → `chat.deleteConversationsOfUser`, `machines.deleteAgentsOfUser`, `settings.deleteUserSettings`, `tasks.unassignUser`, `projects.detachDeletedUser` | ✅ |
| 2 | `machines.deleteAgent` → `chat.clearConversationWorkspacesOfMachine` + `clearConversationExecTargetForAgent`, `ci.detachAgent`, `projects.detachAgent` | ✅ |
| 3 | `projects.createProject` не пишет `kb_documents` — заготовку статьи создаёт `kb.seedProjectOverview`; `projectKbSkeleton` переехал в `kb` | ✅ |
| 4 | `projects.removeMember` не трогает `tasks` — `tasks.unassignUserInProject` | ✅ |
| 5 | `tasks.createTask` не пишет `projects` — номер выдаёт `projects.nextTaskSeq` | ✅ |
| 6 | `ci.startMergeRun` → `tasks.placeTaskInSemanticColumn`; `recordIntegrationAutomationLinks` → `tasks.preparationReadiness` / `savePreparationReadiness` | ✅ |
| 7 | `KNOWN_CROSS_WRITES` убран из манифеста; гейт требует ровно ноль чужих записей | ✅ |

## Круг 3 — асинхронные порты

Интерфейс каждого репозитория объявляется `Promise`-возвращающим, реализация остаётся на
`better-sqlite3`. Транзакция — целиком внутри одного метода репозитория (unit of work), снаружи
транзакций нет. `await` расползается по серверу домен за доменом под зелёными тестами, а не одной
ночью. Начинать с `settings`, `llm`, `releases` (нет чужих чтений), заканчивать `tasks`.

| № | Пункт | Статус |
|---|---|---|
| 1 | Порт `SettingsPort` (async) + реализация на SQLite; потребители на `await` | ☐ |
| 2 | Те же шаги для `llm`, `releases`, `kb`, `identity` | ☐ |
| 3 | `chat`, `machines`, `projects`, `qa` | ☐ |
| 4 | `ci`, `tasks` — последними, у них больше всего связей | ☐ |
| 5 | Миграции разнесены по доменам: `repos/<домен>.migrations.ts`, ядро только упорядочивает | ☐ |

## Круг 4 — другой движок (при необходимости)

Только после круга 3 и только там, где появляется второй процесс или хост. Postgres в
`docker-compose` как один инстанс с **схемой на домен**, cross-схемные FK запрещены; для тестов —
`@electric-sql/pglite`. Замена — по одному репозиторию, начиная с того, чей домен первым уходит
в отдельный сервис. Допустим смешанный режим (часть доменов на Postgres, часть на SQLite).

## Что не делали намеренно

- Не меняли сигнатуры и тела методов: круг 1 — про адреса, не про поведение.
- Не разносили `migrate()` по доменам: порядок миграций между таблицами важен, переезд —
  отдельный шаг круга 3.
- Не вводили async: это круг 3, и он должен идти под гейтом владения, а не вместе с ним.

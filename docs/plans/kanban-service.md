# Канбан как отдельное приложение — карта связей и план выделения

Живая реализация сегодня: `apps/server/src/routes/{projects,ci,qa,releases,projectTypes,featurePreview}.ts`,
`apps/server/src/ci/*` (менеджер ранов, хуки модели, QA-стадии, исполнитель команд), `orchestration/`,
`releases/`, `merge/`, `projects/` (шины доски и уведомлений), `mcp/kanbanMcp.ts`, `ci/ciCommandsMcp.ts`
и ~1 000 строк сборки прямо в `server.ts` (подготовка задач, автопилот, запуск ранов из MCP).

## Зачем

Цель — та же, что у Make (`docs/plans/make-standalone.md`): менять канбан и релизить только его.
Отличие в масштабе: у Make не было таблиц, у канбана — пять доменов данных (`projects`, `tasks`,
`ci`, `qa`, `releases`, 60+ таблиц) и менеджеры с длинными фонами (раны CI, подготовка задач,
автопилот, релизы). Поэтому этап идёт после Postgres (`docs/plans/db-postgres.md`): сервис канбана
подключается к **той же сетевой базе** своим экземпляром `VoiceChatDb`/репозиториев, а через ядро
ходит только за тем, чего в базе нет.

## Инвентарь (2026-09-07)

| Часть | Строк | Что делает |
|---|---|---|
| `ci/runManager.ts` | 2 476 | очередь и слоты ранов, шаги, отмена, отчёты |
| `ci/modelHooks.ts` | 1 332 | ходы модели внутри рана: промпты, инструменты, починки |
| `routes/projects.ts` | 1 299 | проекты, доска, карточки, комментарии, циклы доработки |
| `mcp/kanbanMcp.ts` | 1 037 | инструменты канбан-ассистента (`mcp__kanban__*`) |
| `merge/runManager.ts`, `orchestration/runManager.ts`, `releases/releaseManager.ts` | 1 273 | мерж-раны, оркестрация планов, релизы |
| `ci/*` остальное, `routes/{ci,qa,releases,projectTypes,featurePreview}.ts`, `projects/*` | 2 800 | QA-стадии, исполнитель, роуты, шины |
| `server.ts` 1405–2402 | 998 | сборка: хуки модели, подготовка задач, автопилот, `kanbanRunLaunchers`, оркестрация |

Итого ≈ 11 200 строк модулей + 1 000 строк сборки. Обращения к базе: свои домены — `ci` 384,
`tasks` 156, `projects` 88, `releases` 57, `qa` 44 вызовов; **чужие домены** — `machines` 38
(17 методов: машины проекта, шаринг, хранилища), `chat` 10 (7: чат задачи, рабочая копия
разговора), `kb` 6, `identity` 5, `llm` 3, `settings` 1.

### Что канбану нужно от ядра (будущий порт `KanbanCore`)

| Ресурс | Сегодня | Как переедет |
|---|---|---|
| Реестр машин (`agentRegistry`): online, exec, fs, pty, http | прямой объект | RPC + поток вывода команд к ядру; либо агенты подключаются к канбану напрямую (решение круга 3) |
| Исполнитель LLM (`claude`/`codex` клиенты, `RemoteLlmClient`) | объекты ядра | тот же HTTP к раннерам — клиент переезжает как есть |
| Чат задачи (`db.chat.openOrCreateTaskChat`, сообщения, рабочая копия) | `db.chat.*` | RPC к ядру (`/internal/chat/*`), как `MakeCore` |
| База знаний (`kb` сервис, `kbUsage`, KB MCP) | объекты ядра | KB — файлы репозитория `docs/kb`; на первом шаге RPC к ядру |
| Вложения (`uploads`) | файлы в `dataDir` | тот же том или RPC |
| Make (`make.service`) | порт `MakeService` | `MakeService` по HTTP — уже есть в `remote` |
| Пользователи (`identity.getUser`, доступ к LLM) | `db.identity.*` | чтение той же базы (кросс-чтение допустимо), авторизация — `whoami` |
| Живые кадры (доска, уведомления, ленты ранов) в сокеты пользователей | `boardHub`, `notificationHub`, `publishToUser` | события ядру (`/internal/*/events`), как у Make |
| Реле UI ассистента (`widgetUiRelay`, `widgetContexts`), preview relay | объекты ядра | RPC к ядру |

### Что ядру нужно от канбана (будущий порт `KanbanService`)

`ciRunManager` (сессия: подписка на ленты ранов, `publish`), `orchestrationManager`, доска и её
подписки для WS-сессии, `preparationNotifications`, контекст задачи в ходе чата (`taskChatContext`,
`projectPromptBlock`), `kanbanRunLaunchers` для MCP канбана, автопилот — всё это сегодня зашито в
`server.ts` и `session.ts`.

## Круги

Каждый круг — свой коммит и зелёный `npm run gate`; данные и контракт `shared` не меняются.

### Круг 1 — сборка канбана вынесена из `server.ts` ☑ (2026-09-07)
1. ☑ `apps/server/src/kanban/module.ts`: `createKanbanModule(deps)` — весь блок 1405–2425 (хуки модели,
   подготовка задач, автопилот, `kanbanRunLaunchers`, оркестрация, релизы, мерж, роуты, реконсиляция при старте)
   с явным объектом зависимостей `KanbanDeps` (26 полей) вместо замыканий на локальные переменные `buildServer`;
   `server.ts` — 2 582 → 1 539 строк. Чистые функции подготовки — `kanban/preparation.ts` (реэкспорт из `server.ts`
   для тестов). В ядре остались git-панель, Storybook/компоненты проекта и watchdog машин — это не канбан.
2. ☑ Возвращаемый `KanbanModule`: `ciModelHooks`, `ciRunManager`, `orchestrationManager`, `releaseManager`,
   `managedEnvironments`, `mergeRunManager`, `featurePreviews`, `automatedQaRunner`, `launchTaskPreparation`,
   `launchQaPreparation`, `runLaunchers`. Таймеры гасятся хуками `onClose` на `app` — отдельного `close()` не понадобилось;
   `boardHub`/`notificationHub` создаёт ядро и передаёт внутрь (их слушает и WS-сессия).
3. ☑ Гейт `kanban/boundary.test.ts`: `server.ts` зовёт канбан только через `createKanbanModule`;
   `KanbanDeps` перечислен явно и не растёт незаметно (снимок ключей).

### Круг 2 — порты ☐
1. ☐ `KanbanCore` (что от ядра: чат задачи, реестр машин как узкий фасад, KB, вложения, пользователи,
   отправка кадров) — реализация `LocalKanbanCore` в `server.ts`; кластер перестаёт импортировать
   `db.chat.*`, `agents/registry`, `kb/*` напрямую (гейт по импортам).
2. ☐ `KanbanService` (что ядру: ленты ранов, доска, уведомления, контекст задачи для хода) —
   `session.ts`, `turns.ts`, `prompt/contextBlocks.ts` через порт.

### Круг 3 — пакет `apps/kanban` и отдельный процесс ☐
1. ☐ Физический переезд в `@voicechat/kanban`; standalone: своя `VoiceChatDb` на `VC_DB_URL`
   (только Postgres — SQLite-файл из двух процессов не открыть), `whoami` через ядро,
   `HttpKanbanCore`, события ядру, прокси путей `/api/projects/*`, `/api/ci/*`, `/api/qa/*`,
   `/api/task-preparation/*`, `/mcp/kanban`, `/mcp/ci-commands` в ядре.
2. ☐ Решение по машинам: поток вывода команд (`exec` с `onChunk`) через RPC к ядру или прямое
   подключение агентов к сервису канбана — фиксируется здесь по итогам круга 2.
3. ☐ Compose, Caddy, KB, прогон на копии прод-БД в Postgres.

## Риски
- Кластер связан с ходами чата в обе стороны (чат задачи создаёт ход, ход читает контекст задачи);
  граница проходит по `turns.ts` — самому нагруженному файлу ядра.
- Фоновые менеджеры держат состояние в памяти (слоты ранов, `starting`): два процесса канбана
  одновременно — отдельная задача, не этого плана.
- Отдельный процесс канбана возможен только на Postgres; до аудита параллелизма
  (`db-postgres.md`, «Долг после круга 2») в проде он не запускается.

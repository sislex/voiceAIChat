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

### Круг 2 — порты ☑ (2026-09-07)
1. ☑ `KanbanCore` (`kanban/core.ts`) — только **состояние процесса ядра**: `machines` (узкий фасад
   `KanbanMachines` из 16 методов реестра, замеренных по коду; `AgentRegistry` удовлетворяет ему
   структурно), `kb` (файловый индекс), `uploads` (`get` по id), `widgets` (снимок экрана виджета и
   мост UI для mcp__kanban__*), `ensureProjectMainCurrent` (git-копии). Локальная реализация —
   `kanbanBridge/localCore.ts` (`createLocalKanbanCore`), единственная точка доступа кластера к ядру.
   Решение: доменные данные чужих доменов (`db.chat/identity/machines/kb/llm/settings`) кластер читает
   сам через `VoiceChatDb` — отдельный сервис работает на той же базе (Postgres), RPC-дубликаты
   репозиториев не нужны. `kb/*`-функции (`kbToolBroker`, `buildKbAutoContext`, …), `users/auth`,
   `llm/remoteClient`, `manifests`, `mcp/previewMcp` остаются импортами-значениями (аллоулист гейта) —
   их судьба решается в круге 3 при выделении пакета.
2. ☑ `KanbanService` (`kanban/service.ts`) — что ядру: `runs` (лента кадров ранов + снимок для
   `ci.subscribe`), `board` (`changed` для соседей — Make; подписки доски/подготовки/QA-стадий/репозиториев/
   улучшений), `notifications`. `BoardHub`/`NotificationHub` теперь создаёт кластер; `registerKanbanMcp` и
   `registerCiCommandsMcp` — тоже в модуле (секрет MCP — зависимость). Ядро не трогает менеджеры:
   `server.ts` обращается только к `kanban.service.*` (проверяет гейт).
   Решение: `turns.ts`/`prompt/contextBlocks.ts` читают контекст задачи из общей БД (`db.tasks/projects/ci`)
   — порт для них не нужен; `featurePreviewsRef` (список превью для preview-MCP чата) остаётся ссылкой до
   круга 3, где станет `KanbanService.previews`.
3. ☑ Ядро перестало публиковать свои кадры через `CiRunManager.publish`: шина `UserFrameHub`
   (`frameHub.ts`) — журнал команд машины, watchdog, снимки браузерной проверки; сессия подписана и на неё,
   и на `KanbanService.runs`.
4. ☑ Гейт `kanban/boundary.test.ts`: снимок ключей `KanbanDeps` (20), аллоулист импортов-значений кластера
   из ядра, запрет типов состояния ядра (`agents/registry`, `mcp/widget*`, `frameHub`, `server`, `session`,
   `turns`) вне `kanban/core.ts`, структурная проверка `AgentRegistry` ⊇ `KanbanMachines`.

### Круг 3 — отдельный процесс канбана ☑ (2026-09-07)
1. ☑ **Решение по упаковке:** физического переезда 11 000 строк в пакет `apps/kanban` в этом этапе нет —
   кластер сшит с `VoiceChatDb` и слоем данных, которые живут в `apps/server`; переезд потребовал бы сначала
   выделить пакет базы. Цель пользователя (запуск на любом сервере) закрывает отдельный **процесс** того же
   пакета: точка входа `apps/server/src/kanban/standalone/index.ts`, образ `kanban-runtime`, сервис compose
   `kanban` (профиль `kanban`), у ядра `VC_KANBAN_MODE=remote` + `VC_KANBAN_URL` + `VC_KANBAN_MCP_PUBLIC_BASE`.
   По умолчанию `embedded` — прод не меняется.
2. ☑ `buildKanbanServer` (`kanban/standalone/server.ts`): тот же `loadConfig`, своя `VoiceChatDb` на `VC_DB_URL`
   (только Postgres), `HttpKanbanCore`, пересылка авторизации в `/internal/whoami` (копия рецепта Make,
   `kanban/standalone/auth.ts`; публичен только `/api/session/*`), `createRemoteMake` к Make или к ядру
   (ядро в embedded-Make отдаёт `MakeService` по `/internal/service`), события ядру пачками на
   `/internal/kanban/events`, `/internal/service` (snapshot, boardChanged, authorizeTunnel, tunnelClosed),
   `/internal/machines` (снимок для зеркала), `/v1/health`.
3. ☑ **Решение по машинам:** агенты остаются подключёнными к ядру. Синхронные чтения кластера
   (`isOnline` ×21 и т. п.) отвечает зеркало `MachinesMirror`, которое ядро обновляет пушем после каждого
   `AgentRegistry.onChange` (250 мс дебаунс; телеметрия тоже идёт через onChange). `exec`/`execStream` —
   потоковый NDJSON-эндпоинт ядра `/internal/kanban/exec-stream` через `node:http` (у undici таймаут тела
   5 мин, у шага CI — дольше); обрыв по `signal` отменяет команду у ядра. Тоннели превью: обратные вызовы
   `authorize`/`onClose` живут у канбана, ядро зовёт их RPC. Для этого фасад получил объединённые типы
   возврата (`closeTunnel`, `uploads.get`, `widgets.surface` могут быть `Promise`) — 5 мест вызова ждут `await`.
4. ☑ Сторона ядра: `kanbanBridge/internal.ts` (RPC-диспетчер `KanbanCore`, снимок машин),
   `kanbanBridge/remote.ts` (`KanbanService` на локальных лентах + RPC), `kanbanBridge/proxy.ts`
   (`KANBAN_PROXY_PREFIXES`; прокси Make обобщён в `registerServiceProxy`), `routes/internal.ts` (RPC, exec-stream,
   события). Транспорт RPC и whoami вынесены в `@voicechat/shared` (`internalRpc.ts`), Make реэкспортирует.
5. ☑ **Решение по Caddy:** пути канбана снаружи идут только через ядро (Caddy не трогаем): под
   `/api/projects/*` у ядра свои роуты (git-панель, KB-исследование), а права проекта проверяет preHandler
   ядра по пути запроса — прямой маршрут в канбан обошёл бы их. Стоимость — один лишний hop.
6. ☑ Тесты: `kanbanBridge/internal.test.ts`, `remote.test.ts`, `kanban/standalone/execStream.test.ts`,
   `machinesMirror.test.ts`, интеграционный `kanbanBridge/kanbanRemote.integration.test.ts` (ядро remote +
   канбан standalone на общей БД: прокси и whoami, роут ядра под общим префиксом, событие доски из процесса
   канбана до WS-сессии ядра, MCP через ядро, внутренние пути без токена).
7. ☑ Прогон на копии прод-БД (4,9 ГБ → Postgres за 122 с, 113 таблиц, расхождений 0): ядро `remote` на 8799 +
   канбан на 8789. API через ядро — проекты, доска, статусы, релизы, настройки CI, типы проектов, квота: 200;
   `git/workspaces` остался у ядра. Браузер: доска, релизы, карточка задачи (designs, QA-раны, rework-cycles,
   вложения) — все запросы 200, консоль и логи чистые. Найден и закрыт пропуск: `/api/task-preparation/*` не
   было в прокси (404) — добавлен, полноту списка теперь держит `kanbanBridge/proxy.test.ts` по исходникам
   кластера (буквальные пути и `REST.*`).

**Долг круга 3:** `featurePreviewsRef` в remote пуст (preview-MCP чата не видит превью канбана) →
`KanbanService.previews`; `kb/*`-функции и `users/auth` остаются импортами кластера из ядра до выделения
пакета базы; Release Center пересобирает всё — перекат одного `kanban` вручную (`docker compose up -d --build kanban`).

## Риски
- Кластер связан с ходами чата в обе стороны (чат задачи создаёт ход, ход читает контекст задачи);
  граница проходит по `turns.ts` — самому нагруженному файлу ядра.
- Фоновые менеджеры держат состояние в памяти (слоты ранов, `starting`): два процесса канбана
  одновременно — отдельная задача, не этого плана.
- Отдельный процесс канбана возможен только на Postgres; до аудита параллелизма
  (`db-postgres.md`, «Долг после круга 2») в проде он не запускается.

# Make как отдельное приложение — карта связей и план выделения

Живая реализация сегодня: `apps/server/src/routes/make.ts` (REST + превью + публикация),
`apps/server/src/make/*` (мастерские, снимки, витрина, импорт, библиотека, шина событий),
`apps/server/src/mcp/makeMcp.ts` (инструменты `mcp__make__*` для ассистента), UI —
`packages/ui/src/components/Make*.tsx` поверх мостов `window.api['make:*']` и
`window.make.onChanged/onPresence`.

## Зачем

Цель — менять Make и релизить **только Make**, не пересобирая чат, канбан и авторизацию.
Слой данных к этому уже готов (`docs/plans/db-repositories.md`): у таблиц есть владельцы,
сервер ходит в данные через асинхронные порты. Make — лучший первый кандидат на выделение:

- **у него нет таблиц.** Состояние Make — файлы в `<dataDir>/make/<conversationId>`
  (мастерская, снимки, заметки, комментарии, гранты доступа, ссылки на задачи, PNG сториз);
- **связь с ядром узкая и уже перечислима**: 10 методов БД трёх доменов (см. карту ниже),
  файловый мост машины только на чтение, живая доска, WS-кадры двух типов;
- **у него отдельный вход для модели** — MCP-эндпоинт `/mcp/make`, который исполнитель LLM
  зовёт по HTTP; куда указывает URL, ему безразлично.

Что **не** является целью этого плана: перенос UI Make в отдельный бандл (Make-панель
остаётся в `packages/ui` и приезжает вместе с web-клиентом ядра — контракт мостов не
меняется) и API-ключи для ассистента (отдельный план, когда чат сам станет сервисом).

## Инвентарь (2026-09-07)

Серверный код Make — 4 417 строк без тестов:

| Файл | Строк | Что делает |
|---|---|---|
| `make/workspace.ts` | 1 349 | мастерские: файлы, снимки, заметки, гранты, комментарии, связи с задачами, квоты, sweep, `promptContext`, `adminStats` |
| `routes/make.ts` | 1 020 | ~30 REST-путей `/api/make/**`, превью `/api/preview/make/:id/*`, `/api/preview/make-shared/:token/*`, публикация `/p/<token>/`, `/s/<slug>/` |
| `mcp/makeMcp.ts` | 275 | MCP-инструменты `make_*`, `MakeTaskScopeBroker` (токены доступа CI-рана к дизайнам задачи), `buildTaskMakeSources` |
| `make/stories.ts`, `transpile.ts`, `zip*.ts`, `importUrl.ts`, `library.ts`, `hub.ts`, `rateLimit.ts`, `metrics.ts` | 773 | витрина/тесты, транспиляция TSX, импорт zip/URL, библиотека компонентов, шина `make.changed`/`make.presence`, ограничители, метрики |

Контракт (`packages/shared`): REST-пути `make*` в `protocol.ts`, мосты `make:*` в `ipc.ts`,
WS-кадры `make.changed`, `make.presence` (сервер → клиент). UI: 12 компонентов `Make*`,
монтируется `App.tsx`. E2E: `e2e/make.e2e.test.ts` (Playwright, TC-14).

## Карта связей «Make ↔ ядро»

### Make читает у ядра (через `db.*`, 10 методов)

| Домен | Метод | Зачем Make |
|---|---|---|
| `chat` | `getConversation`, `conversationOwner` | чей разговор, Make ли это (`assistantKind === 'make'`), проект разговора |
| `chat` | `makeConversationProject`, `isMakeProjectViewer` | доступ участника проекта к чужому Make-разговору |
| `chat` | `listConversations(owner, { includeCompleted })` | квота «все Make-проекты владельца» (`setProjectsOfOwner`) |
| `tasks` | `makeTaskLinks`, `linkTaskDesign`, `unlinkTaskDesign`, `makeLinkableTasks` | связь «дизайн ↔ карточка канбана» (таблица `task_designs` принадлежит `tasks`) |
| `tasks` | `getCiTask` | проверка scope-токена CI-рана (`authorizeTaskSource`) |
| `projects` | `getProject` | название проекта в панели «Компоненты проекта» |
| `identity` | `getUser` | имя автора комментария |

Плюс не-БД зависимости: `machineFs.list/read/isOnline` (репозиторий проекта на машине, только
чтение), `boardChanged(projectId)` (живая доска после связывания с задачей), `mcpSecret`
(секрет процесса для `/mcp/make`).

### Ядро читает у Make

| Кто | Что | Зачем |
|---|---|---|
| `turns.ts` | `makeContext(conversationId)` → `workspaces.promptContext` | дизайн-токены и открытые комментарии в промпт хода |
| `turns.ts` | `hub.turnSnapshot(turn)` | `meta.makeSnapshotId` — «Откатить правки» в чате |
| `turns.ts`, `ci/modelHooks.ts`, `server.ts` (подготовка задачи) | `buildTaskMakeSources` + `MakeTaskScopeBroker.issue` | URL `/mcp/make?scope=…` для рана CI, который читает дизайны задачи |
| `routes/projects.ts` | `makeWorkspaces.list(conversationId)` | проверить, что пути `makeSources` цикла доработки существуют |
| `routes/admin.ts` | `makeWorkspaces.adminStats` | расход диска Make по пользователям |
| `server.ts` | `makeSweep` таймер | чистка снимков и PNG старше 30 дней |
| `session.ts`/`ws.ts` | `hub.subscribe(userId, sink)` | доставка `make.changed`/`make.presence` в сокеты пользователя |
| `users/auth.ts`, `routes/invitations.ts`, `routes/imageStudio.ts` | `SlidingWindowLimiter` | общая утилита — **не** связь с Make, переезжает в ядро |
| `routes/projectComponents.ts` | `parseStoryFile` | разбор сториз репозитория — общая утилита |
| `routes/admin.ts` | `formatMakeMetrics` | форматирование метрик |

Обратные зависимости — по сути четыре: контекст промпта, снимок хода, scope-токены рана и
проверка путей. Всё остальное — общие утилиты, которые просто лежат в `make/` по
историческим причинам.

## Целевая форма

```
браузер ──https──▶ Caddy ──┬─ /api/make/*, /api/preview/make*/*, /p/*, /s/*, /mcp/make ─▶ make:8788
                           └─ всё остальное ────────────────────────────────────────────▶ voicechat:8787
исполнитель LLM ──▶ make:8788/mcp/make (VC_MAKE_MCP_PUBLIC_BASE)
make ──▶ voicechat:8787/internal/*  (Bearer VC_INTERNAL_TOKEN): whoami, разговоры, задачи, WS-push
voicechat ──▶ make:8788/internal/*  (тот же токен): promptContext, turnSnapshot, list, adminStats
```

- **Один origin.** Path-routing в Caddy, поэтому cookie сессии `vc_session`/`vc_csrf`
  и same-origin превью в iframe работают без изменений; фронт не знает, что серверов два.
- **Одна авторизация.** Make не читает `sessions` (таблица `identity`) и не знает
  `sessionSecret`: cookie/Bearer запроса пересылается в ядро `GET /internal/whoami`, ответ
  `{ userId, role, sid }` кэшируется 30 с по значению токена. Отзыв сессии в ядре доезжает
  до Make за ≤ 30 с — приемлемо для редактора файлов, не приемлемо было бы для платежей.
- **Одни данные.** Файлы Make остаются на том же томе `/data` (`VC_MAKE_DIR=/data/make`),
  сервис Make монтирует тот же volume — миграции данных нет. Ядро в `make/` больше не пишет.
- **Порт `MakeCore`** — узкий интерфейс на 10 методов из карты выше, две реализации:
  `LocalMakeCore` (в процессе ядра, через `db.*`) и `HttpMakeCore` (в отдельном процессе,
  через `/internal/*`). Аналогично `MakeService` для ядра: `LocalMakeService` (объекты в
  процессе) и `HttpMakeService`.
- **Scope-токены рана** становятся stateless: HMAC(`VC_INTERNAL_TOKEN`) над содержимым +
  TTL, вместо `Map` в памяти одного процесса — иначе токен, выданный ядром, не проверить
  в Make.
- **Живые кадры** `make.changed`/`make.presence`: Make шлёт их в ядро
  `POST /internal/ws/push { userId, message }`, ядро раздаёт своими сокетами. Контракт WS не
  меняется; собственный SSE у Make — отложенный пункт.
- **Режим встраивания сохраняется**: `VC_MAKE_MODE=embedded` (по умолчанию — dev,
  desktop, тесты) монтирует Make в процесс ядра теми же `Local*` реализациями;
  `VC_MAKE_MODE=remote` + `VC_MAKE_URL` — отдельный сервис. Прод переключается без
  пересборки образа ядра.

## Круги

Каждый круг — свой коммит, гейт `npm run gate` зелёный по коду возврата, схема данных не
меняется ни в одном.

### Круг 1 — граница внутри монолита ☑ (2026-09-07)

1. ☑ Общие утилиты уехали из `make/`: `SlidingWindowLimiter` → `util/rateLimit.ts`, `parseStoryFile` →
   `util/storyParse.ts`, SSRF-гард `assertPublicHost` → `util/publicHost.ts` (раньше Make импортировал его
   из `routes/previewProxy.ts`); `formatMakeMetrics` остался у Make, admin получает строку через `service.metrics()`.
2. ☑ Порт `MakeCore` (`apps/server/src/make/core.ts`): `conversation`, `conversationOwner`,
   `conversationProject`, `isProjectViewer`, `makeConversationIdsOf(owner)`, `taskLinks`,
   `linkTaskDesign`, `unlinkTaskDesign`, `linkableTasks`, `ciTaskDesigns`, `project`, `userName`,
   `boardChanged`, `machineFs`. `LocalMakeCore(db, agentRegistry, boardHub)`.
   `routes/make.ts` и `mcp/makeMcp.ts` принимают `core: MakeCore` вместо `db: VoiceChatDb`.
   Сборка — `make/module.ts` (`createMakeModule`), в `server.ts` Make создаётся одной конструкцией.
3. ☑ Порт `MakeService` (`apps/server/src/make/service.ts`) для ядра: `promptContext`,
   `turnSnapshot`, `listFiles`, `adminStats`, `issueTaskScope`, `sweep`. `turns.ts`,
   `ci/modelHooks.ts`, `routes/projects.ts`, `routes/admin.ts`, `server.ts` — через него.
4. ☑ Scope-токены — HMAC с TTL (`make/taskScope.ts`), брокер в памяти удалён.
5. ☑ Гейт `make/boundary.test.ts`: `make/**`, `routes/make.ts`, `mcp/makeMcp.ts` не импортируют
   `db/`, `users/`, `agents/`, `turns` — только `make/core.ts`, `@voicechat/shared`, свои файлы;
   ядро (кроме `server.ts` и `make/*`) не импортирует `make/workspace.ts`/`hub.ts` напрямую.
6. ☑ `makeMcp.test.ts` — на фейковом `core` (без БД); `make.projectSync.test.ts` — через `LocalMakeCore`
   (ему нужны настоящие проекты и машины).

### Круг 2 — пакет `apps/make` и внутренний API ☑ (2026-09-07)

1. ☑ `apps/make` (`@voicechat/make`): код `make/*`, `routes/make.ts`, `mcp/makeMcp.ts` переехал физически
   (`src/*.ts`, плоско); `src/standalone/server.ts` — `buildMakeServer({ config })`: пересылка авторизации,
   `createMakeModule` с `HttpMakeCore`, `/internal/service`, `/v1/health`; `standalone/index.ts` — listen + sweep.
   Ядро импортирует `@voicechat/make`; `SlidingWindowLimiter` и `parseStoryFile` — в `@voicechat/shared`.
2. ☑ В ядре `/internal/*` под `Bearer VC_INTERNAL_TOKEN` (`routes/internal.ts`; вместо REST на каждый метод —
   RPC `{ method, args }` над портом: `/internal/make/core`, `/internal/make/events`, `/internal/whoami`). Было задумано: (только из сети compose, Caddy
   наружу не проксирует): `GET /internal/whoami` (пересланные cookie/Bearer → `{ userId, role, sid }`),
   `GET /internal/make/conversations/:id`, `…/project`, `…/viewer/:userId`, `GET /internal/make/users/:id/make-conversations`,
   `GET|POST|DELETE /internal/make/task-links…`, `GET /internal/make/projects/:id`,
   `GET /internal/make/ci-task/:projectId/:taskId`, `POST /internal/board-changed`,
   `POST /internal/ws/push`, `GET /internal/machine-fs/:agentId/{list,read,online}`.
3. ☑ `HttpMakeCore` (`apps/make/src/standalone/httpCore.ts`), `createRemoteMake` в ядре (`makeBridge/remote.ts`);
   выбор по `VC_MAKE_MODE`; `authenticate` вынесен из preHandler `users/auth.ts` и возвращается из `registerAuth`.
4. ☑ Авторизация в `apps/make`: preHandler на `/api/*` — кэш `whoami` 30 с (только чтения, ключ — токен +
   класс пути); `/p/*`, `/s/*`, `/mcp/make` — как раньше (по ссылке / по секрету).
5. ☑ Контрактный тест `makeBridge/core.contract.test.ts` (local vs http поверх `app.inject()`) плюс
   интеграция `makeBridge/remote.integration.test.ts`: ядро в `remote` и процесс Make на двух портах —
   Bearer и cookie+CSRF через `whoami`, 404 роутов Make у ядра, MCP у Make, внутренние пути без токена — 401.

### Круг 3 — образ, compose, Caddy ☐

1. ☐ `Dockerfile`: стадия `make-runtime` (без whisper/web-сборки), `docker-compose.yml`:
   сервис `make` (`PORT=8788`, `VC_INTERNAL_TOKEN`, `VC_CORE_URL=http://voicechat:8787`,
   `VC_MAKE_DIR=/data/make`, тот же том данных, healthcheck `/v1/health`), у `voicechat` —
   `VC_MAKE_MODE=remote`, `VC_MAKE_URL=http://make:8788`, исполнителям — `VC_MAKE_MCP_PUBLIC_BASE`.
2. ☐ `Caddyfile`: `handle /api/make/* /api/preview/make/* /api/preview/make-shared/* /p/* /s/* /mcp/make` →
   `reverse_proxy make:8788`, остальное → `voicechat:8787` (оба виртуальных хоста).
3. ☐ Локальная проверка на копии прод-БД в двух режимах (`embedded` и `remote` через
   `docker compose up`), e2e `make.e2e.test.ts` в обоих.
4. ☐ KB: `deploy.md` (сервис, переменные, что проксируется куда), `server-internals.md`
   (порты `MakeCore`/`MakeService`, `/internal/*`), `architecture.md`, `ui.md` §Make (сервер
   другой, контракт тот же), `apps/make/AGENTS.md`, журнал.

### Круг 4 — независимый релиз ☐

1. ☐ Release Center умеет собирать/перекатывать один сервис (`docker compose up -d --build make`)
   — сейчас поток релиза пересобирает всё; здесь нужен отдельный «профиль» релиза.
2. ☐ Версия Make в `/v1/health` и в админке рядом с версией ядра.
3. ☐ Отложено: собственный SSE `/api/make/events` вместо push через ядро; UI-бандл Make
   отдельным Vite-входом; API-ключи ассистента.

## Риски и решения

- **Двойной hop на каждый REST-запрос Make** (whoami + собственно данные). Кэш whoami по
  токену на 30 с снимает первый; lookup'ы разговора/проекта — редкие (открытие панели, связь
  с задачей), горячий путь (файлы, превью, снимки) в ядро не ходит вовсе.
- **`/internal/*` наружу.** Только сеть compose + Bearer; Caddy эти пути не знает; в
  `isPublic` их нет — при попадании снаружи 401 от общего preHandler ядра.
- **Отзыв сессии.** Окно ≤ 30 с; при `logout` ядро может дополнительно звать
  `POST make/internal/session-revoked` — добавим, если понадобится.
- **Порядок доставки `make.changed`.** Сейчас `hub.changed` синхронный внутри процесса;
  через HTTP кадр приедет позже ответа REST. Панель уже обрабатывает `rev` монотонно
  (перезагружает дерево, если `rev` новее) — проверить тестом в круге 2.
- **Desktop (Electron).** Работает в `embedded` — ничего не меняется.

---
title: Backend изнутри: сборка, маршруты, сессии и сервисы
updated: 2026-10-07
checked: cb339cad
areas:
  - apps/server/src
  - packages/knowledge/src
---

# Backend изнутри: сборка, маршруты, сессии и сервисы

Module details: `voice:README.md`

Module details: `make:README.md`
Module details: `web-reader:README.md`

Backend — Fastify 5 на TypeScript ESM. Он не выпускает JS-артефакт: production и development запускают `tsx src/index.ts`, поэтому относительные импорты в исходниках имеют расширение `.js`, несмотря на физические `.ts`.

`httpDiagnostics.ts` assigns and returns a validated `x-request-id`, records
bounded counters by Fastify route template and emits structured slow/5xx events
with that correlation ID. Admin-only status and Prometheus routes are registered
after authentication in `server.ts`. Service proxies replace any raw forwarded
request ID with the validated Core value.

## Запуск и dependency injection

### Knowledge module lifecycle

`packages/knowledge` (`@voicechat/knowledge`) owns Markdown indexing, search,
scoped visibility, source snapshot lifecycle, auto-context and the KB MCP
definitions (`search`, `document`, `topics`). It has no imports from Core and
does not open files, databases, Git processes or model connections itself.
Core's `kb/` entry points retain source-compatible wrappers around the package;
REST routes, MCP HTTP transport, operational tools and research orchestration
remain in Core. The source wrappers use relative workspace imports so the
existing `tsx` launch does not depend on a generated JavaScript build.

The explicit host ports are:

| Port | Core implementation | Responsibility |
| --- | --- | --- |
| `KbFiles` | `kb/files.ts`: `kbFiles` | Markdown listing, configuration/document reads and existence checks |
| `KbGit` | `kb/sources.ts`: `createKbGit` | Credential lookup, sparse checkout, bounded fetch and docs-path validation |
| `KbScopedStore` | `kb/scoped.ts`: `createKbScopedStore` | Stored document generation/rows and authorized project repository lookup |
| `KbSemanticReranker` | `kb/reranker.ts`: `LlmKbReranker` | Model execution; package search retains its lexical fallback |
| `KbView` / `KbAccess<Viewer>` | `kb/access.ts`, `kb/rpc.ts` | Host identity, current membership and write permissions; request filters only narrow visibility |
| `KbDocumentStore` | `kb/rpc.ts` | Persistent document lookup, save and delete through `db.kb` |
| `KbRpcPorts.usage` | `kb/rpc.ts` | Authorized conversation/project/run/task usage reports |
| `KbUsageTracker` | `kb/usage.ts` | MCP delivery telemetry and Core event publication |

`createInProcessKbRpc` implements every method in Shared's B01
`KB_SERVICE_RPC` registry. `createLocalKbRpc` binds concrete database/access
adapters and `server.ts` exposes it as the `kbRpc` Fastify decorator. The host
supplies the authenticated user ID separately from the decoded request; live
identity and membership checks protect writes and scoped reads. The contract
test in `kb/rpc.test.ts` runs the registry against the package with real
in-memory SQL storage, including all usage targets and denied access.
This extraction adds no remote listener or deployment requirement.

`server.ts` builds `ModuleKnowledgeBaseService` from `config.kbRoot`,
`config.dataDir`, optional `config.kbModules` (`VC_KB_MODULES`) and
`config.kbRefreshMs` (`VC_KB_REFRESH_MS`, default 600000). The source-file fallback
is `kb-modules.json` under the data directory. `ScopedKnowledgeBase` wraps the
file modules and retains the existing database visibility checks. It forwards
module status/refresh and resolves the current authorized project's repository
for auto-context preference.

The concrete Git adapter in `kb/sources.ts` uses depth-one fetch, non-cone
sparse checkout and the existing Git credential helper or GitHub integration
token. `BuildOptions.kbCredentials` injects credential lookup for deployments
and tests; `BuildOptions.kbService` still replaces the complete file source.
Per-module refresh promises serialize updates, and complete in-memory snapshots
are swapped only after successful indexing. Failures preserve the previous
snapshot and expose only constant failure reasons. The timer is unreferenced;
Fastify's `onClose` clears it and waits for bounded in-flight operations.

`kb/routes.ts` serves `/api/kb/modules` and admin-only
`POST /api/kb/modules/:id/refresh`. Module filters flow through REST, MCP and
the scoped engine without changing `kb/access.ts`. File IDs are namespaced by
module and relative Markdown path; legacy Core IDs remain read aliases.
See [repository module configuration](features/project-knowledge-base.md#repository-modules).

### HTTP response compression

`server.ts` registers `httpCompression.ts` before Core routes. The
`@fastify/compress` response hook negotiates Brotli (`br`) or gzip using
`Accept-Encoding` for buffered JSON (including `application/*+json`) and text
responses under `/api` and `/internal`, strictly above 1024 bytes. Existing
route hooks still run; `compress: false` remains an explicit route opt-out.
Request decompression is disabled.

Compression skips WebSocket upgrades, Range requests and partial responses,
already encoded responses, media and archive MIME types, SSE, and all Node/Web
stream payloads. Exec-stream, tunnel, preview and recorder paths and logs with
a `follow` query parameter are also excluded even if their payload is buffered.
Only compressed responses lose `Content-Length`; identity responses retain
their normal headers. Streams are never buffered to determine their size.
`httpCompression.test.ts` checks encoding negotiation, decompression round-trips,
the byte threshold, exclusions and header preservation without listening on a port.

`index.ts` загружает `ServerConfig`, создаёт каталоги/SQLite, CLI-клиенты, STT/TTS engines и вызывает `buildServer()`, затем `listen()`. `server.ts` не слушает порт и подходит для тестов.

`BuildOptions` позволяет внедрить `db`, `claude`, `codex`, `sttEngine`, `ttsEngine`, `createWsHandlers`, `sessionSecret` и конфигурацию. По умолчанию `server.ts` сам решает, чем будут `claude`/`codex`: локальным `spawn`-клиентом или `RemoteLlmClient` поверх HTTP. Тем же конфигом он поднимает `RunnerFsClient`, если заданы `VC_LLM_RUNNER_CLAUDE_URL` и/или `VC_LLM_RUNNER_CODEX_URL`: это отдельный HTTP-клиент для профильных файловых API исполнителя. Новый внешний процесс/ресурс должен получить такую точку инъекции; иначе unit/integration-тест случайно запустит реальный CLI или затронет диск.

Порядок регистрации: auth/public guard, REST, admin/projects/agents/KB, gateway/MCP, websocket plugin и статические файлы. `/api/*` по умолчанию требует bearer token; исключения перечислены централизованно в `isPublic`. Нельзя делать новый публичный route побочным эффектом порядка plugins.

## In-memory maintenance gate

Each `buildServer()` owns a `Maintenance` instance. `POST /internal/maintenance`
accepts `{readOnly: boolean, reason: string}` (reason at most 1024 characters).
It uses the internal route's existing `admin.rpc` service grant in managed mode;
legacy mode requires `VC_INTERNAL_TOKEN`. User credentials alone cannot toggle
it. Disabling clears the reason. Nothing is persisted, so restart starts writable.

The global `onRequest` hook returns HTTP 503 `{error: "read_only", reason}` for
non-GET/HEAD/OPTIONS requests to `/api` and `/api/*`, before route handlers,
authentication or proxy forwarding. Reads and `/api/health` stay available;
health adds top-level `readOnly` and `reason`. Internal maintenance remains
reachable for rollback.

`attachWs` checks the same live state on existing and new chat connections,
including queued and binary audio frames. Write frames receive JSON
`{status: 503, error: "read_only", reason}` (an established WebSocket cannot send
an HTTP status). The connection and outgoing updates stay open. An explicit
allowlist preserves chat handshake and board/CI/session-tail read subscriptions;
unknown commands fail closed. The gate stops new client commands, not jobs
already executing, agent callbacks, or writes through internal module RPC.
Operators must quiesce those writers before the final migration snapshot.

## HTTP-поверхность

### Chat message service data

Conversation setting `loadServiceData` defaults to false and is persisted in
canonical chat settings. `serviceData.ts` applies the shared `stripServiceData`
helper at REST and event boundaries: conversation and kanban-assistant history,
draft creation/replay, CC/Codex resume, admin message inspection, message writes,
`chat.message`, and both metadata fields of `claude.done` (completion, cancellation,
and shutdown recovery). Enabling the setting returns full metadata. Live active
turn activity, database readers, context snapshots, and prompt construction retain
their full data regardless of the setting.

`GET /api/conversations/:id/messages/:messageId/service-data` returns the stored
`activity` and `request` for one published message. It applies the same owner and
scope/project checks as the conversation GET; disabled loading returns 409,
inaccessible conversations and missing messages return 404. The repository reads
only that message's metadata rather than loading the complete conversation.
Metadata PATCH merges top-level fields under a database row lock, preserving
stored activity/request when a client updates only `taskLaunches`. An echoed
projection's `serviceData` marker and reduced request never replace stored diagnostics.

Группы маршрутов:

| Группа | Назначение |
|---|---|
| health/session | Health, login, me, logout. |
| conversations/messages | CRUD, поиск, настройка проекта/status, редактирование сообщений, desktop migration. |
| settings/system | Пользовательские настройки, capabilities CPU/RAM. |
| STT/TTS | Статус, каталог, скачивание/удаление моделей и голосов. |
| uploads/files | Вложения и ограниченное чтение файлов, созданных CLI; при вынесенном исполнителе чтение картинок идёт через его `/v1/files/read`. |
| LLM tooling | MCP list, login status, Claude Code/Codex sessions и resume; `/api/auth/status`, `/api/cc/*`, `/api/cx/*` проксируются в файловые/auth API исполнителя. |
| agents | CRUD машин, token/policy/update/install bundles, exec и файловые операции. |
| admin | Пользователи, роли, блокировка, deny-list моделей, read-only просмотр машин/истории, user/global usage, LLM engines/health и model prices. Личные usage/access остаются вне admin domain. |
| projects | Проекты, участники, машины, default machine, канбан columns/tasks. |
| KB | Status, topics, lexical/semantic search, context и чтение документа. |
| preview | Same-origin прокси внешнего HTTP/HTTPS-сайта для iframe. |

### Серверный снимок контекста разговора

Защищённый `GET /api/conversations/:id/context-snapshot` в `apps/server/src/routes/rest.ts` формирует preview сохранённого контекста следующего хода. Effective LLM разрешается атомарно по цепочке: явные provider/model разговора → собственная `ci_llm_config` привязанного проекта → пользовательские настройки. Проектная конфигурация читается только при отсутствии override provider разговора; если выбранный уровень не задаёт модель, fallback берётся из пользовательской модели соответствующего provider.

Одна вычисленная пара попадает и в `summary`, и в элемент `llm` группы `conversation`. Для элемента сервер ставит `source` соответственно «Разговор», «Проект» или «Настройки пользователя», а `explanation` различает явное переопределение и наследование с конкретного уровня. Контрактные сценарии приоритета и наследования закреплены в `apps/server/src/routes/rest.test.ts`.

## WebSocket `/ws`

`attachWs` installs message and close listeners before awaiting asynchronous
`onOpen`. A single initialization barrier keeps commands queued until session
subscriptions and queue recovery finish. Authentication-buffered frames enter
that same queue first through `initialFrames`; replaying them after `attachWs`
would reorder them behind frames received during setup. Failed initialization
closes the socket without dispatching queued commands. A disconnect during setup
runs cleanup once setup settles, avoiding subscriptions left behind by an early
close. Regression tests cover ordering, initialization failure and early close.

`ws.ts` отвечает только за framing и routing: JSON управляющие сообщения, binary PCM, lifecycle сокета. `createSession()` создаёт per-connection handlers и владеет STT/TTS session, подписками tail, PTY relay и cleanup. Общая `UserFrameHub` подписывает каждую браузерную сессию и фильтрует публикации по аутентифицированному `userId`.

После успешного `db.chat.addMessage`, атомарного создания draft-разговора или обновления meta REST публикует `chat.message` через процесс-глобальный `UserFrameHub`. Кадр содержит `conversationId` и полный сохранённый `Message`, адресуется по аутентифицированному `userId` и поэтому приходит всем активным соединениям владельца, включая источник, но не другому аккаунту. Публикации при ошибке записи нет; повтор с тем же `messageId` может повторить кадр, а клиент обязан слить его по `Message.id`. Эта публикация не зависит от старта модели или первого токена: серверные проверки двух одновременных сессий находятся в `apps/server/src/session.test.ts`.

`TurnManager` также публикует весь lifecycle хода и авторитетные снимки очереди всем сессиям владельца через подписку с `ownerUserId`. В `createSession.onOpen` подписка на ходы устанавливается до отправки `claude.active`, затем сессия подписывается на `UserFrameHub` до первого ожидания БД и вызывает `resumeQueues(userId)`. Поэтому reconnect получает накопленный active-turn, восстановленные из SQLite очереди и последующие `start/token/log/usage/done/error`; история сообщений остаётся авторитетным REST-снимком `conversations:get`, который клиент сливает с уже увиденными realtime-кадрами.

При подключении сервер отправляет активные LLM turns. Обрыв сокета закрывает микрофон, TTS, observer-tail и PTY подписки, но не модельный turn. Все callback-и должны быть сняты в одном cleanup, иначе reconnect удвоит события. В интеграционных тестах `ws.close()` только начинает closing handshake: перед `app.close()` нужно дождаться события `close`, поскольку именно оно запускает session cleanup. Локальные Fastify, WebSocket и SQLite ресурсы регистрируются в `afterEach`, чтобы assertion или timeout не оставляли worker с живым listener.

STT session аккумулирует PCM, конвертирует в WAV и вызывает engine. TTS session сериализует запросы, возвращает аудио/ошибки и поддерживает cancel. Resource capabilities проверяются сервером до запуска тяжёлого процесса.

## Процесс-глобальные ходы

`turns.ts` хранит по одному активному ходу на conversation id. `start()` выбирает Claude/Codex client, строит запрос с cwd/profile/MCP и подписывается на token/activity/usage. Partial хранится в памяти и транслируется всем заинтересованным соединениям.

По завершении сервер сохраняет AI message и метаданные в SQLite, обновляет conversation и отправляет `done`. Каждый возвращаемый `Conversation` содержит серверный агрегат стоимости сохранённых AI-сообщений: `costUsd` и `costStatus` (`known`, `partial`, `unknown`). Источник расчёта — `conversationCosts` в `apps/server/src/db/database.ts`: он связывает фактический `messages.engine` и `meta.model` с `model_prices`, используя `conversations.llm_model` только как fallback модели. Обычный вход равен `max(inputTokens - cacheReadTokens, 0)`, чтение и создание кэша и output тарифицируются отдельно. AI-ход считается известным только при числовых input/output (и, если присутствуют, cache) usage и найденном тарифе для provider/model; все известны — `known`, известна лишь часть — `partial`, нет ни одного известного или AI-ходов ещё нет — `unknown`. Для `partial`/`unknown` `costUsd` равен `null`, чтобы известная часть или отсутствие usage не выглядели полной нулевой суммой.

**Итог кэшируется в самой беседе** (`conversations.cost_usd`, `cost_status`, `cost_prices_stamp`, `cost_dirty`): полный агрегат сканирует все AI-сообщения беседы и разбирает JSON каждого, и на списке сайдбара это было 95% его времени (17.5 мс на 22 беседы, 353 мс на 158). Протухание ловят **триггеры** на `messages` (INSERT/UPDATE/DELETE → `cost_dirty = 1`), а не вызовы по коду: сообщения пишет десяток мест (ход, правка, откат, импорт legacy), и любое забытое давало бы устаревшую цену в списке — ошибку, которую никто не заметит. Смену прайса ловит `cost_prices_stamp` (`MAX(updated_at)` и число строк `model_prices` — второе нужно, чтобы заметить удаление цены). Триггеры снимаются в начале миграций и создаются в конце: пересборка `conversations` (DROP + RENAME) падает, пока жив триггер с телом, ссылающимся на эту таблицу. После кэша список стоит 0.6 мс на окно недели и 7 мс на все 158 бесед.

Список и поиск считают агрегаты одним batch-запросом для всех возвращаемых разговоров; одиночное чтение применяет тот же расчёт. Невалидный исторический JSON `messages.meta` изолируется через `json_valid`, а ошибка агрегации оставляет разговоры доступными со статусом `unknown`. Агрегат вычисляется из сохранённых сообщений при каждом чтении, поэтому восстанавливается после повторного открытия БД.

По cancel/error менеджер ходов снимает handle и очищает map. Пользовательский cancel после уже полученной дельты сохраняет partial как AI message с `meta.interrupted=true` и отправляет `done` с этим partial; поздний callback модели игнорируется. Тест не должен ждать пустой `done`, если мок успел отдать токен: такое ожидание держало Vitest до глобального 10-минутного timeout. Проверка identity текущего turn не позволяет позднему callback старого процесса удалить новый ход того же разговора.

Очередь разговора хранится в SQLite и исполняется сервером по одному элементу в FIFO-порядке. Завершение, ручная остановка и ошибка активного LLM-хода освобождают слот и вызывают следующий ожидающий элемент. При ошибке исходная реплика сохраняется в очереди со статусом `failed`, но пауза не включается: автоматическая выборка `takeQueuedTurn` рассматривает только `queued`, поэтому ошибочный элемент остаётся видимым для пользователя, не запускается повторно и не блокирует последующие сообщения. Идемпотентность по `messageId` и авторитетные снимки очереди защищают от дублей при повторной отправке и realtime-подтверждении. Источники — `apps/server/src/turns.ts` и методы очереди в `apps/server/src/db/database.ts`.

Пользовательские CLI-профили изолированы в `dataDir/cli-users/<base64url(логин)>/...`; `cliProfiles.ts` (переехал в `apps/llm-runner/src/cli/`) создаёт HOME/config и environment. Это не контейнерный root profile. Login status читается отдельно для каждого профиля.

## SQLite и репозитории данных

`VoiceChatDb` — синхронный адаптер `better-sqlite3`: ядро (`db/database.ts`) при создании выполняет идемпотентную DDL и миграции старых колонок и раздаёт доменные репозитории `db.chat`, `db.tasks`, `db.ci`, `db.machines`, `db.identity` и т.д. (`db/repos/<домен>.ts`, по одному владельцу на таблицу — `db/ownership.ts`). Маршруты и сервисы зовут методы адресно и асинхронно (`await db.projects.getProject(...)` — поля `db.<домен>` это `AsyncPort<Repo>`), а зависимости-интерфейсы в тестах описываются той же формой `{ projects: { getProject: async () => … } }`. Сообщения одного WS-сокета обрабатываются строго по очереди (`ws.ts`): обработчики асинхронны, а порядок `audio.start → чанки → audio.stop` — часть контракта. WAL разрешает читателям не блокировать обычную запись; foreign keys обеспечивают cascade для conversation/project children. Подробнее — [data-auth.md](data-auth.md#схема).

Таблицы: `users`, `settings`, `conversations`, `messages`, `speakers`, `agents`, `projects`, `project_members`, `project_machines`, `kanban_columns`, `tasks`. JSON-поля (`skills`, technologies, policy, message meta, settings) кодируются/декодируются на границе DB.

Составные операции проектов и reorder/move задач выполняются транзакциями. Позиции имеют REAL и могут вставляться между соседями; при исчерпании промежутков порядок нормализуется. `BoardHub` хранит только listeners и после мутации заставляет подписчиков перечитать board — сама доска остаётся в SQLite.

При первой новой БД сидируется `admin`; пароль берётся из `VC_ADMIN_PASSWORD`, пустой допустим только как явно выбранная конфигурация. Пароли хешируются `scrypt`, machine tokens — SHA-256; сырой token возвращается только при создании/регенерации.

## Uploads и файлы

`UploadStore` выдаёт вложению непрозрачный id и хранит его местоположение. Если запрос `POST /api/uploads` содержит разговор с `chat_storage_bindings`, сервер через `resolveManagedChatStorage` повторно проверяет владельца и online-состояние машины, зарегистрированный storage и marker, а затем пишет файл через `AgentRegistry.fsWrite` в `<chatRoot>/attachments`. Явный `agentId`, не совпадающий с binding, отклоняется. Для разговора без binding сохраняются совместимые режимы `<root>/.voicechat_uploads` выбранной машины и `VC_DATA_DIR/uploads` без машины; недоступный managed storage диагностируется без legacy-fallback. В prompt передаётся фактический абсолютный путь, а не клиентское имя; ограничения размера и нормализация пути применяются до записи. Реализация resolver и построения каталогов находится в `apps/server/src/uploads.ts`.

Перед ходом `TurnManager` читает удалённый файл через `fs.read`, регистрирует его байты в короткоживущем контексте `remote:image` именно для выбранного `agentId` и передаёт исполнителю как `LlmAttachment` с `preserveServerPath=true`. Контракт поля находится в `packages/shared/src/llm.ts`: runner не заменяет авторитетный путь машины временным Linux-путём в prompt, поэтому модель передаёт Windows- или POSIX-путь remote-инструментам без изменений. Для визуального анализа самим Claude/Codex CLI `apps/llm-runner/src/run/rawRun.ts` создаёт отдельную временную копию и добавляет в prompt явное соответствие «путь машины → копия runner». Каталог копии живёт до завершения, ошибки или отмены рана и затем удаляется; постоянный исходник на машине UploadStore при этом не удаляет.

Файл не кладётся в SQLite: `MessageAttachment` из `packages/shared/src/types.ts` хранит только `uploadId`, абсолютный `path`, имя, MIME-тип, размер, машину и необязательную подпись. `messages.attachments` содержит JSON такого массива; миграция добавляет колонку, а чтение отбрасывает битые или неполные элементы, чтобы старая история не ломала ленту. `POST /api/uploads` возвращает те же метаданные (включая фактический путь), после чего UI сохраняет их на пользовательской реплике через `messages:add`.

Раздел «Файлы чата» не имеет отдельного реестра и восстанавливает список из истории: `collectChatFiles` в `packages/shared/src/images.ts` берёт сохранённые вложения и корректные результаты `parseImages` из текста сообщений (служебные `image`-блоки и локальные markdown-картинки). Один физический файл определяется парой `agentId` и пути; дубли объединяются, но у элемента остаются все `messageIds`. Поэтому одинаковое имя на разных машинах не сливается, а доступность и открытие всегда проверяются на машине-источнике.

`serverFiles.ts` остаётся локальной границей безопасности для режима без вынесенного исполнителя: он разрешает чтение только внутри allowlisted roots пользовательского CLI-профиля/генерируемых данных, запрещает traversal/symlink escape, директории и файлы больше 32 MiB. Если `buildServer()` собрал `RunnerFsClient`, `routes/rest.ts` и `imageRelocate.ts` сначала идут в `/v1/files/read` исполнителя и только при отсутствии remote-режима читают локальный диск.

Для `remote:image` чтение с машины ограничено теми же 32 MiB в `apps/agent/src/fileOps.ts`. Бинарные данные `fs.read` передаются base64 в одном WebSocket-сообщении; сервер явно разрешает кадр до 48 MiB (32 MiB превращаются примерно в 42,7 MiB base64 плюс JSON), а ожидание файлового ответа агента ограничено 30 секундами. MCP-маршрут не буферизует входное HTTP-тело Fastify: его читает `StreamableHTTPServerTransport`. При поиске изображения только `ENOENT` разрешает перейти к следующему кандидату пути; таймаут, отключение машины, `fs.error` другого типа и `fs.result` без `dataBase64` возвращаются как отдельные ошибки и не маскируются сообщением «файл не найден». MIME JPEG/PNG/GIF/WebP определяется по первым 12 декодированным байтам, поэтому мост не создаёт второй полный `Buffer` крупного изображения; исходный base64 остаётся необходимым содержимым типизированного MCP `image`-блока и в текст ответа не попадает.

Изображения, созданные моделью на исполнителе, `imageRelocate.ts` переносит для managed-разговора в `<chatRoot>/.generated`; `TurnManager` перед записью заново разрешает binding и storage. Результат объявляется image-блоком с абсолютным путём машины и `agentId` binding. Ошибка managed-проверки или записи превращается в диагностику без копирования в `.generated_images`; прежнее размещение сохраняется только для разговора без binding. Источником байтов служит абстракция `readServerFile(userId, path)`, которая читает диск сервера либо профиль пользователя на исполнителе.

Локальная ретушь реализована отдельно в `imageRetouch.ts`. Sharp декодирует оригинал, валидирует rectangle/lasso и извлекает минимальный bounding crop; LLM получает вложениями только PNG crop, локальную чёрно-белую маску и необязательные референсы. Ответ обязан быть поддерживаемым растром точного размера crop; затем сервер проверяет средний перепад на внутренней границе, копирует RGBA из ответа только для белых пикселей маски и отдельным проходом сравнивает каждый пиксель вне полной маски с декодированным оригиналом. Поэтому служебный красный canvas UI в обработку не попадает. Любая ошибка генерации, формата, размера, стыка или outside-проверки прекращает запрос до `db.addMessage`. Для managed-разговора успешный PNG сохраняется через `saveRetouchedImage` в `<chatRoot>/.generated` на машине binding; сообщение получает абсолютный путь, правильный `agentId` и `MessageAttachment.retouch`. Совместимое размещение в `.generated_images` машины источника или профиля сервера применяется только без managed binding.

Явная публикация временного managed-результата выполняется `POST /api/artifacts/publish`. Маршрут принимает только непосредственный файл из `<chatRoot>/.generated` на машине binding и дополнительно требует, чтобы тот же путь с `agentId` уже встречался во вложениях или image-блоках текущего авторизованного разговора. Байты копируются в `<chatRoot>/artifacts`: занятое имя по умолчанию получает числовой суффикс, а замена разрешена лишь при `overwrite: true`. Результат сохраняется отдельным AI-сообщением и вложением; контракт находится в `packages/shared/src/imageRetouch.ts`, маршрут — в `apps/server/src/server.ts`.

Временные managed-файлы очищает `GeneratedCleanupService`: пользовательский `Settings.generatedFilesTtlDays` принимает целое значение 1–3650 и по умолчанию равен безопасным 30 дням. Один проход использует снимок TTL, перечисляет только непосредственные элементы `<chatRoot>/.generated`, удаляет лишь обычные файлы с `mtime < now - TTL` через специализированную нерекурсивную операцию агента и пропускает каталоги, симлинки, небезопасные имена, свежие файлы, ссылки актуальных сообщений и файлы под lease ретуши/публикации. `attachments`, `artifacts`, `.generated_images` и sibling-пути в обход не попадают. Ошибки binding, offline-машины и файловой системы сохраняются в `generated_cleanup_retry`; `ENOENT` считается достигнутым конечным состоянием. Итог каждого запуска — структурированные счётчики `checked`, `deleted`, `skipped`, `deferred` с `runId`.

Штатная модельная картинка хранится в AI-сообщении компактным fenced-блоком ```image с абсолютным путём, `agentId` и подписью; `MessageImage` получает её байты только при рендеринге. При наличии сохранённого provider-session следующий ход идёт через resume и в prompt попадает лишь новая реплика. После сброса/отсутствия session `TurnManager` пересобирает prompt из всех `messages.text` через `buildConversationPrompt`. При этом функция вырезает из AI-реплик корректные служебные ```image-блоки и локальные markdown-картинки через `parseImages`: это метаданные для UI, а не контекст следующего хода. Inline data-URL (`data:image/...;base64,...`) или иной base64 в тексте AI-сообщения не преобразуется и будет повторно отправлен модели. `parseImages` вырезает только локальные markdown-картинки и корректные ```image-блоки; внешние URL и data-URL остаются в markdown.

## LLM и MCP

`ClaudeCli` и `CodexCli` реализуют общий `LlmClient` (`@voicechat/shared`, `llm.ts`): spawn, поток событий, cancel. Сами классы лежат в `apps/llm-runner/src/cli/`; сервер либо импортирует их из `@voicechat/llm-runner/cli` и спавнит локально, либо использует третью реализацию того же интерфейса — `llm/remoteClient.ts` (`RemoteLlmClient`), который шлёт ход по HTTP в контейнер-исполнитель (`POST /v1/run`, NDJSON, отмена — `DELETE /v1/run/:id`). В Docker этот transport смотрит на внутренние сервисы `runner-work` и `runner-personal`; серверный образ собственных `claude`/`codex` бинарников больше не содержит. Для соседних профильных задач у сервера есть отдельный клиент `llm/runnerFsClient.ts`: он проксирует `/api/auth/status`, `/api/cc/*`, `/api/cx/*`, `/api/files/read` и live-tail CC/Codex в `/v1/auth/status`, `/v1/fs/*` и `/v1/files/read`, переподключая SSE с `Last-Event-ID`. Разбор потока для удалённого транспорта живёт в `llm/sinks.ts`, выбор реализаций идёт по `VC_LLM_RUNNER_URL`/`VC_LLM_RUNNER_CLAUDE_URL`/`VC_LLM_RUNNER_CODEX_URL` в `config.ts`; подробности — `docs/kb/llm.md`. MCP-конфигурация Claude может включать `remoteBashMcp`, который адресует команду выбранной машине через registry.

`/mcp/remote-bash` реализован SDK MCP и предоставляет bash в рамках выбранного agent id. Он не обходит policy/version/online checks registry. База MCP-URL для исполнителя берётся из `VC_MCP_PUBLIC_BASE`, а без env остаётся loopback `http://127.0.0.1:<PORT>` — так dev и Vitest не требуют отдельной адресации. Входящий `/v1/messages` — отдельный Anthropic-compatible gateway для Claude Code: backend либо upstream HTTP, либо локальный Codex; LAN-only проверка защищает незапароленный endpoint.

Observer-модули как код живут и на сервере, и в исполнителе, но источником истины для профилей CLI в remote-режиме является исполнитель: именно он читает JSONL-сессии из `~/.claude/projects` и `~/.codex/sessions`, строит список/транскрипт и tail через watcher/SSE, а сервер только проксирует результат. Resume по-прежнему создаёт/связывает разговор, а не запускает второй backend storage.

## STT, TTS и ресурсы

`system/resources.ts` читает cgroup v1/v2 лимиты CPU/RAM с fallback на host. `capabilities.ts` сравнивает их с default или `VC_MIN_MEM_STT/TTS`. Недоступность отражается в API и блокирует запуск.

Сервер не запускает Whisper и не имеет доступа к STT-моделям. `RemoteSttClient` проксирует PCM и lifecycle в защищённый WS `stt-runner /v1/transcribe`. Недоступность runner меняет только `capabilities.stt`, не TTS или текстовый чат.

Сервер использует только `TtsClient` (`RemoteTtsClient` в runtime, `FakeTtsClient` в тестах). `ttsSession` сохраняет браузерную FIFO-очередь и прежний кадр `tts.audio`, связывает активную фразу с `runId` и отменяет её при barge-in или закрытии WebSocket. Если URL или токен runner не настроены, capabilities помечает только TTS недоступным; STT и текстовый чат не блокируются.

## Конфигурация

Приоритет путей: env → найденный артефакт монорепо (кроме Vitest) → каталог данных/default executable. Основные переменные: `PORT`, `HOST`, `VC_DATA_DIR`, `VC_MODELS_DIR`, `VC_WHISPER_CLI`, `VC_PIPER_BIN`, `VC_PIPER_ARGS`, `VC_PIPER_VOICES_DIR`, `VC_WEB_DIR`, `VC_AGENT_APP`, `VC_DESKTOP_APP`, `VC_KB_ROOT`, `VC_KB_RERANK_PROVIDER`, `VC_MCP_PUBLIC_BASE`, `VC_ADMIN_PASSWORD`, `VC_MIN_MEM_STT`, `VC_MIN_MEM_TTS`, `VC_CLAUDE_GATEWAY_BACKEND`, `VC_CLAUDE_UPSTREAM_URL`, `VC_CLAUDE_UPSTREAM_API_KEY`, `VC_CLAUDE_UPSTREAM_AUTH`, `VC_CLAUDE_MODEL_MAP`, `VC_LLM_RUNNER_URL`, `VC_LLM_RUNNER_CLAUDE_URL`, `VC_LLM_RUNNER_CODEX_URL`, `VC_LLM_RUNNER_TOKEN`, `VC_LLM_RUNNER_TIMEOUT_MS`.

Под Vitest autodiscovery отключён, чтобы тест удаления модели/голоса не затронул реальные repo assets.

## Проверка

HTTP-тесты используют `app.inject()`, WS-тесты — временно слушающий Fastify и `ws` client, DB — `:memory:`. Spawn/fetch/fs/resources передаются как зависимости. Реальные Claude, Codex, Whisper и Piper в тестах не запускаются.

Гейт: `npm run -w @voicechat/server typecheck && npm run -w @voicechat/server test`.

**Валидация моков по JSON Schema (roadmap-4 п.31).** Файл коллекции `mock/**.json` может содержать `$schema`; `applyCollectionRequest` (`@shared/makeMock`) перед POST/PUT/PATCH прогоняет тело через `validateJsonSchema` (`@shared/jsonSchemaLite` — подмножество: `type`, `required`, `properties`, `enum`, `minLength/maxLength`, `minimum/maximum`, `pattern`, `format: email`, `items`, `additionalProperties: false`), для PATCH `required` игнорируется. Ошибки — ответ 422 `{ error: 'validation', issues: [{ path, message }] }`, файл не меняется. Подсказка модели (`MAKE_ASSISTANT_HINT`) описывает это поле.

**Auth-мок (roadmap-4 п.32).** Файл мока с полем `$auth` обрабатывает `applyAuthMock` (`@shared/makeMock`): `{ users: [{ username|login|email, password, … }], cookie? }` — POST сравнивает учётные данные, отвечает 200 с `user` (без пароля, слитым в объектное `$body`) и заголовком `Set-Cookie: vc_mock_session=<login>; Path=/; SameSite=Lax`, иначе 401 (не POST — 405); `{ require: true }` — без cookie 401, с ней в объектное `$body` подставляется `user: { username }`; `{ logout: true }` — 204 с `Max-Age=0`. `resolveMock` получил параметр `cookieHeader`, все три маршрута моков (GET превью, не-GET превью, публикация) передают `req.headers.cookie`; `sendMock` пробрасывает `set-cookie` как любой заголовок ответа. Это учебная имитация входа для прототипов, не защита данных.


## Канбан: только сервис `sislexa-kanban`, в ядре — порты и мост (2026-09-30)

Проекты, доска, подготовка задач, раны CI, QA-стадии, релизы, мерж-раны, автопилот, оркестрация, превью,
очистка временных ресурсов и MCP канбана/CI-команд живут только в репозитории `sislexa-kanban`. Встроенного
режима в ядре больше нет: каталоги `ci`, `merge`, `releases`, `orchestration`, `projects`, `preview`,
`cleanup`, `kanban/module.ts`, `kanban/standalone` и маршруты кластера удалены. Раньше это была вторая
копия, и она расходилась с сервисом: прод жил со старым менеджером релизов, пока исправление лежало в ядре.

В ядре остались:

- **`KanbanCore`** (`kanban/core.ts`) — что канбан берёт у *процесса* ядра: `machines` (узкий фасад
  `KanbanMachines`; `AgentRegistry` удовлетворяет ему структурно), `kb`, `uploads`, `widgets`,
  `ensureProjectMainCurrent`. Локальная реализация — `kanbanBridge/localCore.ts`, отдаётся канбану RPC
  `/internal/kanban/core` и потоковым `/internal/kanban/exec-stream`; контракт протокола — `kanban/internal.ts`.
- **`KanbanService`** (`kanban/service.ts`) — что ядро берёт у канбана: ленты ранов, доски, уведомлений
  и список живых превью. `kanbanBridge/remote.ts` воспроизводит события, которые канбан шлёт пачками на
  `/internal/kanban/events`; `kanbanBridge/offline.ts` — заглушка, когда канбан не подключён.
- **Прокси** `kanbanBridge/proxy.ts` (`KANBAN_PROXY_PREFIXES`, `KANBAN_MCP_PATH`, `CI_COMMANDS_MCP_PATH`):
  пути канбана идут только через ядро, preHandler ядра уже проверил права проекта. Свои маршруты ядра под
  этими префиксами — git-панель (`routes/projectGit.ts`), компоненты/Storybook (`routes/projectComponents.ts`),
  кадры браузерной проверки (`routes/browserShots.ts`) — конкретнее wildcard прокси и остаются у ядра.
- Слой БД целиком (миграции общей базы Postgres — у ядра) и общие контракты `@voicechat/shared`.

Переключатель — `VC_KANBAN_MODE`: `remote` (нужны `VC_KANBAN_URL`, `VC_INTERNAL_TOKEN`, `VC_MCP_SECRET` и
`VC_DB_URL`) или любое другое значение — канбан не подключён, ядро работает без доски, MCP канбана ходу
модели не выдаётся. Тесты ядра создают проекты и задачи прямо в базе (`db.projects.createProject`), а не
маршрутами канбана. Утилиты, которые ядру нужны самому, перенесены: `util/shell.ts` (`shellQuote`,
`buildShellCommand`), `db/repos/{kbHit,testStages,qaStateLogs}.ts`, `prompt/projectContext.ts`.

Гейт `kanban/boundary.test.ts` держит: каталогов и файлов кластера в ядре нет, в `kanban/` только порты,
ни один файл ядра не импортирует модули кластера, `server.ts` получает канбан только `createRemoteKanban`
или `createOfflineKanban`, и `AgentRegistry` структурно удовлетворяет `KanbanMachines`.

## Web Reader: самостоятельное приложение (2026-09-10)

`apps/web-reader` владеет прокси `/api/preview*`, переписыванием HTML/CSS/JS,
контейнером cookie и MCP `/mcp/preview`. `createReaderModule` собирает эти части;
ядро подключает его через публичный `@voicechat/web-reader` только в embedded.

`ReaderCore`, HTTP-клиент, RPC whitelist и подписанные токены вынесены в
`packages/web-reader-contracts`. `context` возвращает доступные машину, тестовых пользователей,
feature-preview окружения и проектную политику. `canUseMachine`, `machineOnline`
и `machineHttp` обращаются к реестру ядра; сам `machineHttp` повторно проверяет
доступ, поэтому прямой RPC не обходит разрешения. Контекст чужого разговора —
`null`. `projectResource` доставляет ресурсы `app.internal`, сохраняя отдельную
авторизацию вложенной страницы. `previewAction` обращается к WS relay ядра;
ключи Chromium, кадры CI и старые методы порта также остаются у владельца данных.
Локальная реализация — `apps/server/src/readerBridge/localCore.ts`.

Standalone `apps/web-reader/src/standalone/index.ts` слушает 8795. Ему нужны
`VC_CORE_URL`, `VC_INTERNAL_TOKEN`, `VC_MCP_SECRET` и адрес Playwright API
`VC_PLAYWRIGHT_READER_URL` (по умолчанию embedded API ядра). `VC_DB_URL` и общий том
ядра не нужны. Авторизация каждого API-запроса пересылается в `/internal/whoami`
с cookie/Bearer/CSRF без кэша прав. Ядро с `VC_READER_MODE=remote` и `VC_READER_URL`
проксирует `/api/preview*`, `/mcp/preview` и `/web-recorder*`; конкретные маршруты
Make сохраняют приоритет. `VC_READER_MCP_PUBLIC_BASE` переопределяет адрес MCP для
LLM; helper `reader/mcpBase.ts` общий для ядра и канбана.

Токены `createPreviewTurnTokens(mcpSecret)` живут сутки, подписаны HMAC и работают
между процессами без регистрации в памяти. WS `PreviewActionRelay` создаёт ядро;
перенос библиотеки контрактов не переносит владение его подключениями.

Web Reader требует API ядра >=1.1.0; старое ядро без `context`/`machineHttp`
отвергается при проверке манифеста. Тесты `readerBridge/readerRemote.integration.test.ts` и
`playwrightReaderBridge/remote.integration.test.ts` проверяют HTTP-границы без общей
БД. `e2e/webReaderProject.e2e.test.ts` проверяет вход и deep link собственного
проекта в embedded и отдельном процессе Reader.

## Машины: модуль `machines/module.ts` и порт `MachinesService` (2026-09-07)

Реестр онлайн-подключений (`agents/registry.ts`), WebSocket компаньон-агентов `/agent`, REST машин и
установщиков (`routes/agents.ts`), политика команд, каталог ChatAI по умолчанию, журнал команд, watchdog и
перенос хранилищ собираются одной функцией `createMachinesModule(deps)` (`apps/server/src/machines/module.ts`);
наружу модуль отдаёт `{ machines, commandGate }`. Потребители — сессия, ходы, `mcp/remoteBashMcp`,
`mcp/consoleMcp`, git-панель, storybook-сессии, превью, админка, канбан (через `KanbanMachines`), Make (через
`MakeCore.machineFs`) — типизированы портом **`MachinesService`** (`machines/service.ts`): публичная
поверхность реестра без `register`/`unregister`; `AgentRegistry` удовлетворяет ему структурно. Синхронные
чтения (`isOnline`, `nameOf`, `versionOf`, `telemetryOf`, `ptyLive`, …) остаются синхронными — в режиме
отдельного процесса машин их будет отдавать зеркало. Полный лог долгой команды из чата модуль пишет в
artifacts привязанного хранилища через обратный вызов ядра `chatArtifacts` (хранилища разговора — знание
ядра). Гейт `machines/boundary.test.ts`: `server.ts` не собирает машины сам, `AgentRegistry` импортируют
только модуль машин и его части. План выделения в отдельный процесс — `docs/plans/machines-service.md`.

**Режим `VC_MACHINES_MODE=remote` (2026-09-07).** Реестр живёт в отдельном процессе машин
(`machines/standalone/index.ts`, `buildMachinesServer`, порт 8793, compose-профиль `machines`), а ядро
получает порт как `HttpMachines` (`machinesBridge/httpMachines.ts`): синхронные чтения — из зеркала, которое
процесс машин наполняет по постоянному WebSocket событий `/internal/events` (снимки машин и PTY-сессий,
события PTY, кадры владельцам, `agentReady`, журнал команд, запросы авторизации тоннелей); вызовы — RPC
`/internal/rpc` и потоковый exec `/internal/exec-stream` (общий формат `internal/execStream.ts`). Ошибки
файловых операций возвращаются с кодом и восстанавливаются как `AgentFsError`; буфер PTY (`ptyBufferText`) —
полный, по RPC у процесса машин (тип у порта допускает `Promise`, консольный MCP ждёт `await`). При обрыве шины все машины
считаются offline до переподключения. Ядро переправляет в процесс машин REST машин и установщики
(`MACHINES_PROXY_PREFIXES`, `machinesBridge/proxy.ts`) и **WebSocket компаньон-агентов `/agent`** — кадр в
кадр, с исходным IP в `x-forwarded-for` (Caddy остаётся без изменений). Авторизация REST у процесса машин —
пересылкой в `/internal/whoami` ядра (`internal/forwardedAuth.ts`, общая с канбаном). Канбан и Make в этом
режиме ничего не замечают: под фасадами `KanbanMachines`/`MakeCore.machineFs` стоит тот же порт. Контракт —
`machines/internal.ts`; интеграционный тест — `machinesBridge/machinesRemote.integration.test.ts`.
Внутренний API машин (`machines/internalApi.ts`) ядро поднимает и во встроенном режиме при заданном
`VC_INTERNAL_TOKEN` — так соседи (админка) берут машины у того процесса, где живёт реестр, одним клиентом.

**Админка отдельным процессом (`VC_ADMIN_MODE=remote`, 2026-09-07).** `admin/standalone/index.ts`
(`buildAdminServer`, порт 8794, compose-профиль `admin`): `routes/admin.ts` на общей базе, авторизация —
пересылкой в ядро, машины — `HttpMachines` к `VC_MACHINES_URL` или к ядру, Make — по RPC, деплой и живое
уведомление об отзыве сессии — RPC к ядру `/internal/admin/rpc` (`admin/internal.ts`). Ядро проксирует
`/api/admin/*` (типы проектов `/api/admin/project-types*` остаются у канбана — его роуты конкретнее);
проверку роли `users:manage` делает preHandler ядра до прокси. Тест —
`admin/standalone/adminRemote.integration.test.ts`.

## Студия картинок ↔ ядро: отдельное приложение (2026-09-09)

Галереи, корзина, метаданные, API генерации/правки и публикации `/g/*` живут в
`apps/image-studio` (`@voicechat/image-studio`). `createImageStudioModule` собирает embedded,
`src/standalone/server.ts` — отдельный Fastify. Каталог `<dataDir>/image-studio` и формат файлов
прежние. UI `ImageStudioPane`, маршрут `#/images`, мосты и поллинг остаются в `packages/ui`.

Порт `ImageStudioCore` (`apps/image-studio/src/core.ts`) даёт студии сведения о разговоре
(`id`, `title`, `assistantKind` с проверкой владельца), переименование, генерацию и чтение
результата LLM. `imageStudioBridge/localCore.ts` ядра реализует его над DB/LLM и ограниченным
чтением профиля пользователя; `standalone/httpCore.ts` — через HTTP. Пакет студии не импортирует
сервер, Make, DB или исполнителей: границу проверяют тесты с обеих сторон. Настройки модели,
LLM и ретушь обычного чата остаются у ядра.

Обратный порт `ImageStudioService` — `promptContext` и `captureImages`: контекст галереи для хода
и сохранение картинок из fenced-блоков ответа. В remote ядро вызывает
`/internal/image-studio/service` и не создаёт `ImageStudioStore`. Файлы исполнителя передаются
в base64 через `readGenerated`, поэтому общий диск с профилями CLI не нужен. В compose прежний
том сохранён для доступа к существующим галереям; для другой машины достаточно перенести
каталог галерей и обеспечить HTTP-связь с ядром.

Контракт — `packages/shared/src/imageStudioInternal.ts`: короткие методы идут в
`/internal/image-studio/core`, генерация — отдельным долгим запросом
`/internal/image-studio/generate`. Отмена разрывает HTTP и останавливает LLM; `preClose` отменяет
раны и закрывает приём новых генераций, включая запросы с ещё незавершённой проверкой доступа.
Кнопка отмены возвращает 410, при остановке процесса прокси также может вернуть 503.
Бюджет генерации — 10 минут, API допускает 20 МБ JSON, внутренний запрос — четыре референса
по 12 МБ в base64. Слот генерации и лимитер пароля локальны: один экземпляр на каталог.
Авторизацию каждого приватного запроса ядро проверяет через `/internal/whoami`, включая CSRF.

Дефолт dev/desktop — `VC_IMAGE_STUDIO_MODE=embedded`; в compose — `remote`, URL
`http://image-studio:8796`, общий `VC_INTERNAL_TOKEN`. Caddy и прокси ядра сохраняют публичные
пути `/api/image-studio/*` и `/g/*`. Интеграция
`apps/server/src/imageStudioBridge/remote.integration.test.ts` проверяет embedded и remote
на реальных HTTP-портах с разными каталогами данных ядра и студии.

### Image Studio selections, version graph, and MCP (2026-09-12)

**Gallery API extensions (CHAT-455).** `POST /api/image-studio/:id/tasks`
returns a task snapshot with HTTP 202. The process owns task execution and the
existing REST active-run slot; queued work starts when that slot is released.
`GET .../tasks` restores state after a client returns, and
`DELETE .../tasks/:taskId` explicitly cancels queued/running work. Saving is the
commit boundary and cannot be cancelled through the task endpoint. Tasks expose
queued/running/saving/completed/cancelled/failed states, actual errors, and
result metadata. There are at most 50 unfinished tasks per conversation and a
bounded recent completed history. Process shutdown cancels pending/running
work; process-restart recovery is not provided. Supported generation settings
are translated into prompt instructions before invoking the existing core
generator, including the HTTP core adapter.

Queue admission in `apps/image-studio/src/routes.ts` checks the current
unfinished-task count only after asynchronous source-file validation, then
inserts the task without another await. Concurrent edit submissions therefore
reserve capacity against the latest state and cannot collectively exceed the
50-task per-conversation limit; shutdown is rechecked at the same boundary.
The task endpoint rejects non-object parameter values (including null and
arrays), unknown keys, non-string style/negative/size values, and non-boolean
`noText` values with HTTP 400 before creating a task. Valid booleans are not
coerced: `false` remains in saved metadata and adds no no-text instruction,
while `true` adds the instruction. Regression coverage in
`apps/image-studio/src/routes.test.ts` synchronizes 51 source checks and
asserts exactly 50 admissions, and separately checks malformed values plus both
boolean meanings.

`POST .../archive` validates explicit selected paths and issues a one-use,
60-second download ticket. `GET /g/archive/:ticket` rechecks gallery ownership
and streams a stored UTF-8 ZIP using per-file buffers and a central directory;
the panel does not assemble the archive. Closing the response destroys its
stream, and errors during streaming abort the response instead of writing a
successful ZIP footer.

`POST .../tags` preserves existing metadata while saving normalized unique
tags (up to 30, each at most 80 characters). Optional `tags` and `parameters`
fields remain compatible with old sidecars. `POST .../file` with `source`
records `operation: transform`, so canvas results use the existing version
graph rather than a separate revision system.

Publication settings persist an ordered list of paths/captions and a text
watermark (up to 120 characters and four corner positions). Public HTML escapes
captions, exposes only selected files, and public file requests enforce that
selection too. Sharp rasterizes a separate watermarked PNG for public delivery;
the original private bytes remain unchanged. ETags are computed from the
delivered bytes. `POST .../preview` creates an owner-checked five-minute capability
for draft settings, sharing the public HTML/image renderer without persisting a
publication or incrementing views. Republishing preserves daily view counters
and previous settings unless new settings are supplied.


Localized image operations live in `apps/image-studio/src/selection.ts`. Sharp
validates the source raster with a 64-megapixel ceiling, converts rectangle,
lasso, or monochrome mask selections into a bounded crop, and composites model
output through that mask. The final compositor copies every pixel outside the
selection from the decoded source. Extraction emits a transparent PNG; placement
resizes the extracted object when requested and alpha-composites it on a base
image. Foreground discovery and the magic wand analyze a copy capped at 1000 px
on its longest side, then map their result back to natural image coordinates.

The file sidecars form a version graph through `source`, `operation`,
`restoredFrom`, and optional selection bounds. Restore is non-destructive: the
historical bytes are copied into a new node whose parent is the currently viewed
node. Renaming a file rewrites references from descendants and restored nodes.
The same store methods back the UI routes and MCP tools, so assistant changes and
manual changes appear in one history.

`POST /mcp/image-studio` is a stateless Streamable HTTP MCP endpoint scoped by
the signed `k`, `user`, and `conv` query values. It verifies that the user owns
an `images` conversation before exposing `image_list`, `image_open`,
`image_find_objects`, `image_generate`, `image_edit`, `image_retouch`,
`image_extract`, `image_place`, `image_restore`, `image_rename`, and
`image_delete`. `image_open` returns actual image content to the model. Plan
mode appends `ro=1`: list, open, and object discovery stay available while every
mutating handler refuses the call. Model-backed generation and retouch share a
per-conversation active slot.

The core generator names the exact `/studio/...` paths of the source crop,
mask, and references in its prompt. These names match attachment `serverPath`
values, allowing the shared LLM-runner attachment preparer to replace them with
temporary readable files for both embedded and HTTP CLI execution.

## Make ↔ ядро: порты `MakeCore` и `MakeService` (2026-09-07)

### Project mode в Core (2026-10-07)

`LocalMakeCore` получает список доступных проектов из `db.projects`, сохраняя роль
текущего участника. Структуру и дизайн рабочей копии он читает только через
read-only `machineFs`: обход исключает каталоги сборки и VCS, ограничен 2000
элементами, 256 КиБ на файл и 4 МиБ суммарно. Инвентарь включает package roots,
stories, style files, CSS custom properties из `:root` и `data-theme`, простые
JSON/TypeScript token maps и экспортированные компоненты.

Git-операции project mode используют тот же `GitWorkspaceService`, что REST
`/api/projects/:id/git/*`. Поэтому членство, доступ к машине, право записи,
занятость workspace и запрет push в protected branches проверяются в одном месте.
Те же методы проходят через schema-validated `/internal/make/core` RPC.

Серверная часть Make уже выделена в workspace `apps/make` (`@voicechat/make`) и умеет
запускаться отдельно (`src/standalone/index.ts`). В compose это сервис `make:8788`, а ядро
использует `VC_MAKE_MODE=remote`; для dev/desktop сохраняется `embedded`. Границу пакетов
проверяют `apps/make/src/boundary.test.ts` и `apps/server/src/makeBridge/boundary.test.ts`.
UI Make остаётся в `packages/ui` и собирается общим web-клиентом; авторизация, разговоры,
членство и пользовательские WS-соединения принадлежат ядру.

- **`apps/make/src/core.ts` — `MakeCore`, «что Make нужно от ядра»**: разговор и его владелец, проект
  Make-разговора и членство (`isProjectViewer`), Make-разговоры владельца (квота), связи
  «дизайн ↔ карточка» (`taskLinks`, `linkTaskDesign`, `unlinkTaskDesign`, `linkableTasks`,
  `taskDesigns`), `project`, `userExists`, `boardChanged`, файловый мост машины только на чтение
  (`machineFs`). Реализации — `apps/server/src/makeBridge/localCore.ts` над DB/машинами/канбаном
  и `apps/make/src/standalone/httpCore.ts` через HTTP к ядру. `apps/make/src/routes.ts` и
  `apps/make/src/mcp.ts` принимают `core`, а не `db`,
  и **не импортируют** `db/`, `users/`, `agents/`, `turns` — гейт это проверяет по тексту импортов.
- **`apps/make/src/service.ts` — `MakeService`, «что ядру нужно от Make»**: `promptContext` (блок промпта
  Make-чата), `turnSnapshot` (id снимка «До правок» для `meta.makeSnapshotId`), `listFiles`
  (проверка путей `makeSources` цикла доработки в `routes/projects.ts`), `taskSources`
  (Make-источники рана CI и подготовки задачи), `adminStats`/`metrics` (админка), `sweep`,
  `subscribe` (кадры `make.changed`/`make.presence` для WS-сессии). `turns.ts`,
  `ci/modelHooks.ts`, `routes/projects.ts`, `routes/admin.ts` получают `make?: Pick<MakeService, …>`
  и ничего больше о Make не знают. Вне композиции процессов и адаптеров `makeBridge/`
  ядро импортирует из `@voicechat/make` только типы; исключения перечислены в гейте границы.
- **`apps/make/src/module.ts` — `createMakeModule({ dataDir, core, mcpSecret, mcpBaseUrl })`** собирает
  мастерские, шину, библиотеку, роуты и MCP и отдаёт `service`; его создаёт ядро в embedded
  или `buildMakeServer` в отдельном сервисе.
- **Scope-токены рана (`apps/make/src/taskScope.ts`)** — HMAC-SHA256 над JSON `{ userId, projectId, taskId,
  sources, expiresAt }` секретом MCP (`?k=`), TTL 30 мин, вместо прежнего `MakeTaskScopeBroker` в
  памяти процесса: токен выдаёт ядро (`MakeService.taskSources`), проверяет MCP Make
  (`verifyTaskScope`); в remote это разные процессы. Содержимое — заявка: MCP сверяет его с
  актуальными `taskDesigns`, проектом разговора и членством (`authorizeTaskSource`).
- **Make — отдельный пакет `apps/make` (`@voicechat/make`), круг 2 (2026-09-07).** Код мастерских,
  роутов и MCP физически живёт там; ядро импортирует только типы портов и `createMakeModule`
  (гейт `makeBridge/boundary.test.ts`), пакет Make не импортирует ядро, `better-sqlite3` и
  исполнителей (гейт `apps/make/src/boundary.test.ts`). Два режима у ядра (`config.makeMode`):
  `embedded` (по умолчанию — dev, desktop, тесты: `createMakeModule` в процессе ядра) и `remote`
  (`VC_MAKE_MODE=remote`, `VC_MAKE_URL`, `VC_INTERNAL_TOKEN`, `VC_MCP_SECRET`): Make — отдельный
  процесс `apps/make/src/standalone` (`buildMakeServer`), ядро получает `MakeService` из
  `makeBridge/remote.ts` — RPC к `/internal/service` Make за `promptContext`/`listFiles`/`adminStats`/
  `metrics`/`sweep`, `taskSources` считает само (нужны секрет и `makeMcpBaseUrl`), `turnSnapshot` и
  `subscribe` — локальная `MakeHub`, которую наполняют события от Make. Внутренний API ядра
  (`routes/internal.ts`, регистрируется только при `VC_INTERNAL_TOKEN`, не под `/api/`):
  `POST /internal/make/core` — RPC порта `MakeCore` над `LocalMakeCore` (белый список методов —
  `CORE_RPC_METHODS` в `apps/make/src/internal.ts`), `POST /internal/make/events` — события шины
  Make (`changed`/`presence`/`turnSnapshot` → `hub.apply`), `POST /internal/whoami` —
  аутентификация пересланного запроса тем же кодом, что preHandler `/api/*` (`authenticate` из
  `registerAuth`: Bearer → cookie → preview-cookie, CSRF для мутаций по cookie,
  `password_change_required`). Процесс Make авторизации не имеет: `standalone/auth.ts` пересылает
  `cookie`/`authorization`/`x-vc-csrf` вместе с методом и путём в `whoami`, чтения кэширует 30 с по
  токену и классу пути (`/api/preview/` отдельно), мутации — каждый раз; ядро недоступно → 503
  `core_unavailable`. MCP `/mcp/make` в `remote` слушает Make, поэтому исполнителю отдаётся
  `VC_MAKE_MCP_PUBLIC_BASE` (без него — `VC_MAKE_URL`), а секрет `?k=` общий. Контракт `MakeCore`
  (local vs http) и интеграция «ядро + Make на двух портах» — `makeBridge/core.contract.test.ts`,
  `makeBridge/remote.integration.test.ts`.
- **Попутно найдено:** квота Make на пользователя считалась по пустому списку — `listConversations`
  без `scope` отдаёт только `chat`, а Make-разговоры живут в scope `make`; `LocalMakeCore.
  makeConversationIdsOf` теперь запрашивает `scope: 'make'`.
- Общие утилиты, исторически лежавшие в `make/`, переехали: `SlidingWindowLimiter` и `parseStoryFile`
  — в `@voicechat/shared` (чистые; вход, приглашения, студия картинок, компоненты репозитория),
  SSRF-гард `assertPublicHost`/`isPublicAddress` — `util/publicHost.ts` ядра (`routes/previewProxy.ts`
  оборачивает его в `PreviewProxyError(403)`) и намеренная копия `apps/make/src/publicHost.ts`.

## Account profile query path

`GET /api/me/profile` runs its independent reads concurrently. Conversation
count uses `ChatRepo.conversationCount(userId)` and session activity uses
`IdentityRepo.sessionActivityForUser(userId)`, so opening one account does not
build global maps for every user. The response includes machine counts only;
the existing `/api/agents` route remains the source for versions and telemetry
when the Machines tab opens.

## Slow and failed API diagnostics

Core logs an `api_request_problem` JSON event for completed `/api` and `/internal`
requests returning 5xx or taking at least two seconds. Events contain method,
registered route template, status and duration only; query strings, actual path
parameters, headers, credentials and bodies are excluded. Inspect container logs
when an intermittent dependency timeout cannot be reproduced; health endpoints
alone do not prove admin user-list or signup callback availability.

For slow page startup, measure the complete browser request set. The Users page
requests `/api/admin/users/usage-summary` for the current month alongside its user
list and shell initialization. Individual user-list probes missed its database
queue delay; the response timing logs and a PostgreSQL activity sample identified
the expensive summary. Public Core/Identity health continued responding quickly
during that queue, so this was not an event-loop or general network stall.

## Persistent environment links

Core owns environment service links in `apps/server/src/agents/linkManager.ts`.
The `environments` repository owns `environment_links`: a composite environment
foreign key cascades deletion, a service tuple is idempotent, and listener ports
are unique per client machine. Startup schema installation adds the table to
existing SQLite databases and the generated PostgreSQL schema under its migration
lock. Link identity and listener port survive restarts; runtime state is
`open` or `down`.

Tunnel frames of one tunnel are handled strictly in arrival order (`TunnelSession.queue`):
authorization is asynchronous and cached for data frames, and without the queue an HTTP request
sent right after `tunnel.open` overtook `tunnel.connect`, so the target agent dropped it and the
transfer hung (environments-v3 U03: the production snapshot download timed out).

Core also applies relay backpressure. Agents pause their TCP reads only while their own WebSocket
send is pending, so a producer on a fast link (the production snapshot server next to Core) outran
a consumer on a slow link and Core queued the whole stream: the production Core ran out of its
524 MB heap during the U03 snapshot transfer. After relaying `tunnel.data`, Core checks the
consumer socket `bufferedAmount`; at 8 MiB it sends `tunnel.pause` to the producer for that
connection and polls every 25 ms, sending `tunnel.resume` once the backlog is at most 2 MiB.
Agent-initiated `tunnel.pause`/`tunnel.resume` are still relayed, but a relayed resume is held
while Core's own pause is active, and Core does not resume a producer the consuming agent paused.

The machines module starts and stops LinkManager in both embedded and standalone
modes. Startup and machine connection changes reconcile persisted links; either
endpoint reconnecting reopens its tunnel. The listener uses
`host: 'docker-host'` and the saved port, without an idle TTL. Both connected
agents must report version 0.21.0 or newer; incompatible versions produce
`Agent 0.21.0 or newer is required`. Installing agents and commissioning Docker
network connectivity remain operator work.

Links persist `transport` (`vpn` or `tunnel`) and `address`. Both SQLite
column migrations and the generated PostgreSQL upgrade plan backfill existing
links as `tunnel`, `host.docker.internal:<listenerPort>`. VPN selection uses
the project's creator as network owner, requires both machines to belong to that
owner, fresh telemetry matching the owner's tailnet and verified device bindings,
and an applied environment grant covering both machines and the service port.
The returned VPN address is the server's bound VPN IPv4 plus the published
`servicePort`; no tunnel is opened. IPv6-only, stale, missing or mismatched
observations and unavailable grants fall back to the stage-3 tunnel.

Agent connection/telemetry changes and persisted VPN service changes trigger
reconciliation in embedded and standalone modes. Reconciliation switches both
ways, closes obsolete tunnels, and keeps delayed tunnel-close callbacks from
marking a VPN link down. Removed environments fail authorization for either
transport. Applying/removing Tailscale grants belongs to VpnService; joining nodes,
publishing the service on its VPN address and commissioning real connectivity
remain operator work.

Each tunnel frame is authorized locally against the persisted link and its
environment state (`provisioning` or `ready`). Missing, removed, or inactive
environments fail closed. Deleting a link closes both endpoints. The machines
RPC and HttpMachines expose `ensureLink(input)`,
`deleteLink(projectId, environmentId, id)`, and
`listLinks(projectId, environmentId)`; the Kanban Core dispatcher exposes the
same methods with the `machines.` prefix. These are trusted internal worker
ports, not user-facing APIs; no Kanban authorization callback or connected
RPC event client is required to keep a link alive.

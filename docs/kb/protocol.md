---
title: Контракт клиент↔сервер (REST, WS, мосты)
updated: 2026-08-27
checked: d76cb141
areas:
  - packages/shared/src/protocol.ts
  - packages/shared/src/ipc.ts
  - packages/shared/src/agentProtocol.ts
  - packages/shared/src/llm.ts
  - apps/server/src/ws.ts
  - apps/server/src/routes
  - packages/ui/src/remote
---

# Контракт клиент↔сервер (REST, WS, мосты)

## Reader ports и неизменённые backend-контракты

Выделение Reader не меняет `/api/preview`, `preview.action`/`preview.result`, `voicechat.web-recorder.v1`, conversation schema или browser-runner protocol. Web Reader принимает relay через `PreviewRelayPort`, адресует результат `conversationId` + `requestId` и инвалидирует доставку при смене активного разговора/dispose. Playwright Reader работает через `BrowserSessionPort` и показывает только capabilities, которые вернул adapter.

Источники истины — читай их, а не пересказ:
`packages/shared/src/protocol.ts` (REST-пути + WS-сообщения),
`packages/shared/src/ipc.ts` (формы мостов `window.*`),
`packages/shared/src/agentProtocol.ts` (сервер↔машина).
Протокол сервер↔исполнитель LLM живёт отдельно — `packages/shared/src/llm.ts`,
описание в [features/llm-runners.md](features/llm-runners.md).

## Правило добавления чего угодно в контракт

1. `packages/shared` — тип/поле/путь. WS-сообщение добавляется **и** в union
   (`ClientMessage`/`ServerMessage`), **и** в список `CLIENT_MESSAGE_TYPES` /
   `SERVER_MESSAGE_TYPES` (иначе падает тест контракта `protocol.test.ts`).
2. Сервер — обработчик (`routes/*.ts` для REST, `session.ts` для WS).
3. Мост — `packages/ui/src/remote/index.ts` (web) и, если фича нужна в desktop,
   `apps/desktop/src/preload/index.ts` + `main/ipc/handlers.ts`.
4. Стор/компонент в `packages/ui`.

Новый REST-путь **всегда** добавляется в объект `REST` — клиенты не пишут строки
URL руками. Параметризованные пути — функции: `REST.conversation(id)`.

Для форм сообщений и загрузок есть намеренное дублирование: REST-версия `AddMessageArgs` и `UploadInfo` описана в `packages/shared/src/protocol.ts`, а bridge-версия в `packages/shared/src/ipc.ts` добавляет `conversationId` к сообщению и задаёт `IpcInvokeMap`. Поэтому новое поле вложения или загрузки меняется синхронно в обоих файлах, затем прокидывается серверным route и `packages/ui/src/remote/httpApi.ts`; иначе web и desktop разойдутся по типам или телу запроса.

## REST

Все пути под `/api/*` требуют `Authorization: Bearer <токен сессии>` — это
глобальный `preHandler` в `apps/server/src/users/auth.ts`. Публичные исключения
(там же, функция `isPublic`): `/api/health`, `/api/session/*`, скачивание
агента/десктопа (`agentApp`, `agentScript`, `agentInstallAndroid`, `agentInstallWindows`, `desktopApp`)
и `/api/agents/version`. Админские роуты дополнительно закрыты `requireAdmin`.

Группы: сессия, разговоры и сообщения (+ поиск),
идемпотентный импорт legacy-данных desktop (`POST /api/migrations/desktop`), вложения (`/api/uploads`),
настройки, возможности системы, STT-модели, TTS-голоса и каталог, MCP-серверы,
статус входа CLI, машины (+ политика, токен, файловые операции, exec),
наблюдатели сессий Claude (`/api/cc/*`) и Codex (`/api/cx/*`), база знаний
(`/api/kb/*` + телеметрия обращений `/api/conversations/:id/kb-usage`,
`/api/projects/:id/kb-usage`, `/api/ci/runs/:runId/kb-usage`,
`/api/projects/:id/tasks/:taskId/kb-usage`), отчёт по расходу модели в CI-ране
(`/api/ci/runs/:runId/report`, `/api/projects/:id/tasks/:taskId/report`), админка
пользователей и реестр LLM-исполнителей (`/api/admin/llm-engines`,
`/api/admin/llm-engines/:id`, `/api/admin/llm-engines/:id/health`), помощник промптов (`POST /api/prompt/suggest` — одноразовый LLM-вызов,
переформулировки черновика; канал `prompt:suggest`). `GET REST.usage` (`/api/usage`) выдаёт отчёт расхода только владельцу Bearer-сессии: `unit`, `from`, `to`, `conversationId`; мост — `usage:report`. Полный список — константа `REST`.

Владелец данных — логин пользователя (`uid(req)` = `req.user.name`); запросы к
разговорам и машинам фильтруются по нему.

`POST /api/images/retouch` (`REST.imageRetouch`, bridge `images:retouch`) принимает `ImageRetouchRequest`: `conversationId`, сохранённое вложение-источник, rectangle/lasso в координатах оригинала, промпт и необязательные вложения-референсы. Формы REST, web и desktop общие (`packages/shared/src/imageRetouch.ts` и `ipc.ts`); desktop renderer использует тот же `installRemoteBridges`. Сервер принимает только файлы текущего разговора либо только что загруженные через `UploadStore`. Успех возвращает `ImageRetouchResult` и атомарно публикует AI-сообщение с image-блоком; проверочная или модельная ошибка возвращает `422` с конкретным `error`, не создавая сообщения.

Первое сохранение обычного локального черновика идёт через
`POST /api/conversations/draft` (`REST.conversationDraft`, bridge
`conversations:createDraft`). Запрос несёт ключ идемпотентности, заголовок,
необязательный проект и первую реплику; сервер в одной транзакции создаёт разговор,
применяет проектные настройки и сохраняет сообщение. Повтор с тем же ключом у того
же пользователя возвращает ранее созданные разговор и сообщения. Формы контракта
находятся в `packages/shared/src/ipc.ts`, маршрут — в
`apps/server/src/routes/rest.ts`.

`REST.preview(url)` строит `GET /api/preview?url=…` для same-origin iframe-превью
внешнего HTTP/HTTPS-сайта. Ручка также проходит общий Bearer-гейт; некорректная
схема возвращает `400`, недопустимый адрес — `403`, а недоступный ресурс и
превышенные лимиты — JSON с `error: 'preview_unavailable'` и понятным `message`.
Это транспортный маршрут, а не bridge `window.*`: `WebPreview` использует его как
`src` iframe. Ограничения загрузки и преобразование тела описаны в
[server-internals.md](server-internals.md).

Playwright Reader (изолированный Chromium) добавляет REST-оркестрацию под общим
Bearer-гейтом: `POST /api/browser/:id/start` (идемпотентно поднимает сессию
разговора → `BrowserSessionMetadata`), `POST /api/browser/:id/command` (навигация/
ввод/вкладки/resize; screenshot запрещён — для него отдельный роут),
`POST /api/browser/:id/screenshot` (кадр как data-URL), `DELETE /api/browser/:id`
(остановка). Все проверяют владение разговором и тип `playwright-reader`; без
сконфигурированного browser-runner отвечают `501`, ошибки раннера пробрасываются
статусами 404/409/503/502. Мост `window.browser` (`RendererBrowserBridge`) и
серверная связка — [features/playwright-reader.md](features/playwright-reader.md).

`GET /api/search` (`REST.messagesSearch`) — полнотекстовый поиск по сообщениям:
`q` (ввод пользователя, экранируется на сервере), `projectId` (`none` или пусто —
только беседы без проекта; параметра нет — по всем), `conversationId`, `limit`
(1–50, по умолчанию 20), `cursor` из прошлого ответа. Ответ —
`MessageSearchResult` (`hits` со сниппетами `<mark>…</mark>`, `nextCursor`,
`match` — то, что реально ушло в FTS5). Мост — канал `messages:search`; он же
**отменяет предыдущий незавершённый запрос** (AbortController в `httpApi`), потому
что при наборе с клавиатуры прошлая заявка уже никому не нужна. Детали индекса —
`data-auth.md`.

## WebSocket `/ws`

Один сокет на клиента. **JSON-кадры** — сообщения `{t, ...}`; **бинарные кадры** —
только аудио с микрофона (Int16 PCM). Синтезированный WAV сервер шлёт как
`tts.audio` с base64. Разбор и маршрутизация — `apps/server/src/ws.ts` (тонкий:
кадр → `WsHandlers`), логика — `session.ts`.

Клиент→сервер: `audio.start/stop`, `claude.send/cancel`, `tts.speak/cancel`,
`tts.downloadVoice`, `stt.download`, `cc.tail.start/stop`, `cx.tail.start/stop`,
`pty.start/input/resize/kill`, `preview.result`.

Сервер→клиент: `stt.partial/final/error`, `claude.token/done/error/log/active`,
`tts.audio/error`, прогресс скачивания голоса и модели, `cc.tail`, `cx.tail`,
`agents` (живой список машин), `pty.output/exit/error`, `kb.usage`, `preview.action`.

`preview.action`/`preview.result` — управление панелью веб-превью из хода модели
(инструменты `mcp__browser__*`): сервер рассылает действие кадром `preview.action`
всем сокетам пользователя, клиент с активным чатом исполняет его и отвечает
`preview.result`; мост — `RendererPreviewBridge` (`window.preview`, только web,
в desktop отсутствует). Подписки нет — рассылка по `userId`, как у `kb.usage`.
Relay хранит у pending-запроса `userId`, `conversationId` и `requestId` и игнорирует
ответ другого пользователя, разговора или неизвестного запроса. UI дополнительно
выдаёт каждой смонтированной панели случайный `registrationId`; выполнять действие
может только панель текущего Reader-маршрута, чей id записан активным для вкладки в
`localStorage` (фокус вкладки обновляет claim). Ответ несёт conversation/registration
контекст, поэтому одинаково подключённые вкладки не подменяют активный Web Reader.

Самодиагностика из `packages/ui/src/webReaderDiagnostics.ts` выполняет один
последовательный сценарий на same-origin `/api/preview/diagnostics`. Страница
проходит через существующий `/api/preview`, rewrite и DOM bridge без внешнего
сетевого запроса и детерминированно предоставляет цели для read/find/styles,
input/change, submit, click и навигации; открытие повторно сбрасывает URL, а read,
поставленный одновременно с навигацией, проверяет очередь и correlation. Все
действия помечены `diagnostic: true`: iframe временно подавляет их запись в recorder.
Перед сценарием проверяется подготовка preview cookie/auth, а ошибки относятся к
слоям route/active-chat, host, cookie/auth, proxy/network, page-loading, dom-bridge,
action или timeout. Детали действий и UI запуска — [ui.md](ui.md).

Детали протокола действий, лимиты и relay — [ui.md](ui.md#действия-модели-в-превью-mcp__browser__)
и [llm.md](llm.md).

`kb.usage` — обращение к базе знаний (авто-инъекция контекста сервером или вызов
`mcp__kb__*` моделью). **Подписки нет**: кадр рассылается по `userId`, как
`claude.usage`, а лишние чаты отсекает стор. Первый кадр обращения приходит со
статусом `pending` («запрашивает…»), терминальный — вторым, с тем же `query.id`;
гонку «REST-снапшот против инкремента» закрывает монотонный `query.seq` внутри
разговора (клиент игнорирует `seq ≤ lastSeq`, upsert по id). Снапшоты —
`GET /api/conversations/:id/kb-usage` и `GET /api/projects/:id/kb-usage`
(изоляция: чужой чат/проект → 404). Детали — `features/kb-usage.md`.

Обращение из работы модели в CI-ране приходит тем же кадром и в тот же чат
(связанный чат задачи, `ci_runs.conversation_id`), но несёт `ciRunId`/`ciStepId`
— панель помечает его источником «CI-ран» и ведёт в ленту рана. Срезы вне чата
— `GET /api/ci/runs/:runId/kb-usage` (один ран, `KbRunUsageReport`) и
`GET /api/projects/:id/tasks/:taskId/kb-usage` (все раны задачи,
`KbTaskUsageReport`); у обоих гейт — членство в проекте, чужому 404. Ран без
связанного чата кадров не шлёт и в телеметрию не пишет — база знаний при этом
работает.

Расход модели в ране (стоимость, токены, число запросов, время работы модели и
шаги CI с длительностями) кадрами не ходит вовсе: он копится в БД по ходам CLI, а
читается снапшотами `GET /api/ci/runs/:runId/report` (`CiRunReport`) и
`GET /api/projects/:id/tasks/:taskId/report` (`CiTaskReport` — все раны задачи с
итогом). Гейт тот же, что у `kb-usage`: членство в проекте, чужому 404, а не
пустой отчёт. Мост — `window.ci.getRunReport` / `getTaskReport`. Детали —
`features/ci-runner.md`.

`claude.send` несёт `verbose?: boolean` — режим консоли, при котором сервер шлёт
поток `claude.log` с активностью агента. Управление ожидающими ходами использует
`claude.queue.edit/delete/now/reorder`; `reorder` передаёт полный список id, а сервер
атомарно применяет его только при точном совпадении текущего набора и всегда
возвращает авторитетный `claude.queue`. При cancel-and-merge событие дополнительно
несёт `removedMessageIds` и новую опубликованную реплику, чтобы все вкладки
атомарно удалили заменённые сообщения. `claude.done` несёт готовое `message`,
сохранённое сервером: **клиент не сохраняет сообщение сам**.

`claude.active` (снапшот при подключении WS) отдаёт по каждому активному ходу
накопленный `partial` и `activity` — после обновления страницы стрим и счётчик
действий продолжаются с накопленного места. При остановке сервера (деплой,
SIGTERM) `flushInterrupted` сохраняет частичный текст активных ходов в БД с
пометкой `meta.interrupted` — набранная часть ответа переживает рестарт.

Настройки выполнения принадлежат разговору: `Conversation.execTarget` (id машины,
`null` — сервер, `'none'` — команды запрещены), `workdir` и `skillNames`, плюс
переопределение исполнителя/движка/модели `llmEngineId`/`llmProvider`/`llmModel` (`null` — из общих
настроек; модель codex `''` — дефолт из конфига codex) и режима прав
`permissionMode` (`plan`/`acceptEdits`/`bypassPermissions`, `null` — из общих
настроек; страница настроек разговора показывает фактический режим с учётом
серверного форса `plan` для роли user без своей машины — см. `turns.ts`). Фактический
режим также виден бейджем в шапке и быстрым переключателем «План/Разработка» у
композера; «Разработка» означает безопасный `acceptEdits`. Переход из плана в
`bypassPermissions` требует подтверждения. Ответ сохраняет фактический режим в
`Message.meta.request.permissionMode`; UI показывает этот снимок в подписи и для
последнего планового ответа предлагает «Выполнить план» — повтор исходного запроса
после переключения разговора в `acceptEdits`. Для роли user без машины эта кнопка
скрыта, а серверный форс нельзя обойти. Кнопка в шапке открывает отдельную страницу
настроек разговора; рядом с названием чата шапка показывает машину разговора. Мост
`conversations:setExecTarget` сохраняет поля одним `PATCH /api/conversations/:id`.
При отправке `claude.send.execTarget` получает цель активного разговора.

Статус жизненного цикла разговора хранится в `Conversation.status` и меняется
через мост `conversations:setStatus` → `POST /api/conversations/:id/status`.
Допустимые значения задаёт общий список `CONVERSATION_STATUSES`: `planned`,
`developing`, `planning_done`, `development_done`, `done`. После успешного хода UI
автоматически ставит `planning_done` для фактического режима `plan` и
`development_done` для режима разработки; ошибка или отмена статус не меняют.
Мост и ручка остались, но точки входа для ручной смены в UI больше нет: селектор
из карточки чата убран (там теперь режим чата, см.
[ui.md](ui.md#компоненты-и-поверхности)), и `conversations:setStatus` зовёт только
автозавершение хода.

`Message.execTarget` — неизменяемый снимок фактической цели конкретного вопроса
или ответа. UI показывает его текстовой подписью и не даёт редактировать.
`Conversation.lastExecTarget` вычисляется по последнему сообщению для read-only
подписи в сайдбаре; списка выбора там нет. Поле
WS опционально: `undefined` означает взять цель разговора, а для legacy-данных —
`settings.execTarget`.

WS дозванивается только при наличии токена сессии (`WsClient` получает геттер
токена; после логина — `ws.reconnect()`).

## Мосты `window.*`

`installRemoteBridges(serverHttp)` в `packages/ui/src/remote/index.ts` ставит
`api, audio, stt, claude, tts, cc, codex, agents, session, fs, pty`. `''` в
аргументе = same-origin (web раздаётся тем же сервером), иначе `VITE_SERVER_URL`.
`http→ws` конвертируется автоматически, включая `https→wss`.

Форма каждого моста описана типами `Renderer*Bridge` в `@shared/ipc` — desktop
реализует те же интерфейсы через IPC. Если добавил метод в мост, но не в тип —
второй бэкенд молча отстанет; поэтому начинай с типа.

Админский реестр LLM-исполнителей ходит тем же `window.api`: каналы
`admin:llmEngines`, `admin:createLlmEngine`, `admin:updateLlmEngine`,
`admin:deleteLlmEngine`, `admin:checkLlmEngineHealth` объявлены в
`packages/shared/src/ipc.ts`, web-мост проксирует их в `REST.adminLlmEngines*`.
Health-check — обычный REST-запрос, а не отдельный WS-канал.

## Сервер↔машина (`/agent`)

Отдельный WS с собственным протоколом (`agentProtocol.ts`): `AgentToServer` и
`ServerToAgent`. Детали (регистрация, политика, версии, PTY) — `machines.md`.

## Начальный каталог PTY

Сообщение `pty.start` на участках client→server и server→agent содержит необязательное поле `cwd`. Сервер проверяет владение машиной и передаёт поле реестру; агент запускает native PTY или pipe-fallback в указанной папке, а при отсутствии поля использует свой корень.

**Проекты и канбан** (REST `projects:*`/`columns:*`/`tasks:*`, WS `board.subscribe`/`board.update`, мост `window.board`) — отдельная подсистема, см. [projects.md](projects.md).


**CI-раннер** (REST `ci:*`, лента рана и консоль) описан в [features/ci-runner.md](features/ci-runner.md). Живые краткие состояния приходят в существующем `board.update`. Пауза рана в ожидании пользователя — WS `ci.interaction` + REST `ciRunInteraction`; сообщение, которое сервер сам дописал в чат (резюме рана), приходит WS-кадром `chat.message` (`{conversationId, message}`, мост `window.ci.onChatMessage`) — открытый чат дописывает его, не перезагружая историю; контекст задачи для шапки связанного чата — `conversations:taskContext` (`GET /api/conversations/:id/task-context`; в ответе есть `conversationId` запрошенного чата — клиент рисует виджет только в нём, см. [ui.md](ui.md)), а метки всех чатов задач для списка бесед (ключ, тип, сводка последнего рана) — `conversations:taskChats` (`GET /api/conversations/task-chats`, статический путь объявлен рядом с параметрическим `/api/conversations/:id`). Feature Run удалён полностью — каналов `features:*`/`agentTasks:*` больше нет.
## AI-помощник формулировки

`POST /api/prompt/suggest` принимает `{ prompt, modifiers }`, где `modifiers` — упорядоченный массив `ModifierPrompt`; UI передаёт только активные элементы. Ответ — `{ variants: Suggestion[] }`. Маршрут требует Bearer-токен, не создаёт разговор и не сохраняет ход. Движок и модель берутся из per-user настроек `aiAssistProvider`/`aiAssistModel`; вызов CLI идёт с `executionDisabled: true` и без session id. Web-мост предоставляет тот же контракт как `window.api['prompt:suggest']`.

## Operations frontend contract

Выделение `@voicechat/operations-app` не меняет REST/WS/SSE, agent или runner protocol. Пакет определяет transport-agnostic client-интерфейсы, но host adapters в этом срезе ещё не реализованы. Публичные hash routes остаются `#/machines`, `#/claude-code`, `#/codex`, `#/kb`, `#/kb/:documentId`, `#/ci`; parser/builder находятся в Operations package, а `packages/ui/src/App.tsx` уже использует parser вместо собственного whitelist для этих URL.

## Administration frontend contract

`@voicechat/admin-app` не меняет REST, WebSocket или runner protocol. Публичный `AdminClient` покрывает существующие admin users/role/block/access, read-only machines/history/messages, user/global usage, LLM engines/health и model prices. Host adapter использует прежние `RendererApi` bridges; единственное добавленное имя bridge — `admin:updateUserRole`, которое вызывает уже существующий `PATCH /api/admin/users/:name`. Маршруты Administration строятся и разбираются пакетом для `#/users`, пользователя и вкладок access/machines/usage/history, а также engines/prices.


## Make (2026-08-26)

REST: `REST.makeState/makeFile/makeRename/makeSnapshots/makeRestore/makeReset/makePreview/makeExport`
(`protocol.ts`), мост `window.api['make:*']` (`ipc.ts`, `httpApi.ts`), WS `make.changed
{conversationId, rev, paths}` (`SERVER_MESSAGE_TYPES`), мост `window.make.onChanged`
(`RendererMakeBridge`, `remote/index.ts`). `LlmRunBody.makeMcpUrl` — MCP-эндпоинт `/mcp/make`.
`AssistantKind` дополнен `'make'`; `conversations:create` принимает его.
Вторая итерация: `REST.makePublish` (POST/DELETE `/api/make/:id/publish`), `REST.makeCheck`
(`GET …/check` → `MakeCheckIssue[]`), `REST.makeTemplate` (POST `…/template {template}`), мосты
`make:publish/unpublish/check/template`; `MakeProjectState.published: MakePublication|null`.
Публичная раздача — `GET /p/<token>/*` (`MAKE_PUBLIC_PREFIX`, вне `/api`, без auth и без инспектора).
Тот же контент по человекочитаемому адресу `GET /s/<slug>/*` (`MAKE_SLUG_PREFIX`, п.25): slug задаётся в `POST /api/make/:id/publish` (`{ snapshotId, slug, password }`; `slug`/`password` — `undefined` не трогать, `null` снять, строка установить; slug — `isValidMakeSlug`, занятый другим проектом → 409 `exists`). Публикация с паролем отдаёт на HTML-запросы форму (401), на остальное — 401 text; `POST /p/<token>/__auth__` и `/s/<slug>/__auth__` с urlencoded `password` ставят cookie `vc_pub_<token>` (sha256 от токена и хэша пароля — смена пароля разлогинивает всех) и редиректят на `?next`. Открытие `index.html` увеличивает `views` в `.publish.json`. Форма пароля ограничена `SlidingWindowLimiter` (10 попыток за 10 минут на `ip:token`, roadmap-2 п.3): сверх лимита `__auth__` отвечает 429 той же формой с текстом «подождите N с» и `Retry-After`; лимитер подменяется через `MakeRoutesDeps.passwordLimiter`. `MakePublication` содержит `slug`, `slugUrl`, `passwordProtected`, `views` и `history` (roadmap-2 п.11: записи `{ at, snapshotId, snapshotLabel }` добавляются, когда меняется, что отдаётся — снимок или «живая»; смена slug/пароля историю не пополняет; хранится до 30 последних); хэш пароля наружу не отдаётся.

**Мок-API проекта (п.29).** Если запрошенного файла нет, превью (`/api/preview/make/:id/*`) и публикация (`/p/…`, `/s/…`) ищут `mock/<путь>.<METHOD>.json` → `mock/<путь>.json` → `mock/<путь>/index[.<METHOD>].json` (`mockCandidates` в `@shared/makeMock`) и отдают JSON с `x-vc-mock: 1`. Файл — либо тело как есть, либо конверт `{ "$status", "$headers", "$delay" (≤ 5000 мс), "$body" }` (`unwrapMockEnvelope`). Не-GET методы (`POST/PUT/PATCH/DELETE`) на этих путях отдают только моки; на публикации `__auth__` обрабатывается тем же маршрутом (`publicMutation`). На публикации со закреплённым снимком моки берутся из снимка. Битый JSON мока → 500 с текстом ошибки. Прямой запрос файла `mock/…` мокам не подлежит (отдаётся как обычный файл).

**Квота и очистка (п.30).** `MAKE_LIMITS.maxProjectBytes` (64 МБ) считается по файлам + `.snapshots` + `.shots`; превышение при записи — `MakeError('quota')` → 413 с подсказкой открыть «Место». `GET /api/make/:id/usage` → `MakeUsage` (байты/счётчики по составляющим, `unusedAssets` — бинарники, имя которых не встречается ни в одном текстовом файле ≤ 512 КБ). `POST /api/make/:id/cleanup` `{ keepSnapshots?, shots?, unusedAssets? }` → `MakeCleanupResult { freedBytes, removed, usage, state }`; снимок, закреплённый в публикации, не удаляется; после очистки рассылается `make.changed`. Мосты `make:usage` / `make:cleanup`.

**Комментарии к элементам превью (п.32).** `GET/POST /api/make/:id/comments`, `PATCH/DELETE /api/make/:id/comments/:commentId` → `{ comments: MakeComment[] }` (`id, selector, elementLabel, text, author = uid, createdAt, resolved`); хранятся в `.comments.json` проекта (переживает `reset`, как `.publish.json`), лимит 500. Любая мутация комментариев рассылает `make.changed` с `paths: ['.comments.json']` (`MAKE_COMMENTS_SYNC_PATH`) и текущим `rev` — панель в других вкладках перечитывает список, не перезагружая превью (roadmap-2 п.7). Мосты `make:comments` / `make:commentAdd` / `make:commentUpdate` / `make:commentRemove`. Инспектор превью понимает два новых сообщения родителя: `vc-make.pins { items: [{ selector, n, text, resolved }] }` — рисует нумерованные метки поверх элементов (fixed-слой, пересчёт на scroll/resize) и `vc-make.highlight { selector }` — прокрутка к элементу и красная обводка на 1,6 с.

**Rate-limit импорта (п.39).** `POST /api/make/:id/import` и `/import-url` ограничены на пользователя скользящим окном (`apps/server/src/make/rateLimit.ts`, `SlidingWindowLimiter`): 10 ZIP-импортов и 20 импортов по URL за 10 минут; сверх — 429 `{ error }` с заголовком `Retry-After` (секунды). Лимитеры подменяются через `MakeRoutesDeps.importLimiter/importUrlLimiter`; счётчик в памяти процесса — перезапуск сервера его сбрасывает.

**Read-only ссылка внутри ChatAI (п.33).** `POST/DELETE /api/make/:id/share` (владелец) → `MakeProjectState.shared: { token, createdAt, url: '#/make-shared/<token>' }`; хранится в `.share.json` + индекс `.published/share-<token>.json`, переживает `reset`. Чтение любым вошедшим пользователем: `GET /api/make/shared/:token` → `MakeSharedState { token, owner, title, files, snapshots, rev }`, `GET …/file?path=`, `GET …/stories`; превью — `GET /api/preview/make-shared/:token/*` (cookie превью; `previewSession` в `users/auth.ts` теперь принимает префикс `/api/preview/make` — и `/make/`, и `/make-shared/`), включая `__stories__`/`__gallery__` и моки. Записи по токену нет ни одной. Мосты `make:share/unshare/shared/sharedFile/sharedStories`.

**PWA в экспорте (п.35).** `GET /api/preview/make/:id/export.zip?vite=1&pwa=1` (оба флага независимы): `exportZip({ vite, pwa })` добавляет `manifest.webmanifest`, `sw.js` (index — network-first, остальное — cache-first) и `icon.svg` (первая буква названия на `theme-color`) — для Vite в `public/` с абсолютными ссылками, для статики рядом с `index.html` с относительными. Ссылки (`<link rel=manifest>`, `theme-color`, `apple-mobile-web-app-capable`, регистрация SW не на `file:`) инъектируются только в копию `index.html` в архиве — файлы проекта не меняются. Название и цвет — `detectPwaMeta` (`<title>`, `meta theme-color`, иначе `--accent` из CSS). Чистые функции — `@shared/makePwa`.

**Метрики Make в админке (п.38).** `GET /api/admin/make/stats` (только admin) → `AdminMakeStats`: число проектов, байты по составляющим (файлы/снимки/PNG стори), публикации, read-only ссылки, просмотры, квота, `byUser[]` (владелец через `db.conversationOwner`) и `top[]` — 10 самых тяжёлых проектов. Считается обходом `<dataDir>/make/*` в `MakeWorkspaces.adminStats(ownerOf)`; `registerAdminRoutes` получает замыкание пятым аргументом. Мост `admin:makeStats`; `AdminClient.makeStats?` необязателен — `adminStore` грузит метрики вместе со списком пользователей и при ошибке кладёт `null`, не роняя дашборд. UI — секция «Make-проекты» в `UsersAdmin` (только для admin, когда пользователь не выбран).

**Импорт репозитория GitHub (п.27).** `POST /api/make/:id/import-url` распознаёт ссылки `github.com/<owner>/<repo>[/tree/<branch>[/<subdir>]]` (`parseGithubUrl` в `@shared/makeGit`) и вместо HTML-импорта скачивает ZIP ветки с `codeload.github.com` (`githubArchiveUrls`: указанная ветка, иначе `main`, при 404 — `master`; лимит 12 МБ), снимает общий корень архива (`stripCommonRoot`) и, если в ссылке подкаталог, оставляет только его (`importFromGithub` в `make/importUrl.ts`). Приватные репозитории и push в git не поддерживаются — нужны учётные данные пользователя.
`REST.makeUpload` (POST `/api/make/:id/upload {path, dataBase64}`, bodyLimit 4 МБ) → мост `make:upload` —
бинарники из панели; на сервере `MakeWorkspaces.writeBuffer` (общие лимиты с `write`).
`REST.makeSearch` (`GET …/search?q=` → `{matches: MakeSearchMatch[]}`), `REST.makeStories` (`GET …/stories` →
`{files: MakeStoryFile[]}`), `REST.makeStoriesPage` (`/api/preview/make/:id/__stories__`, cookie) — мосты
`make:search`, `make:stories`. Ещё: `REST.makeSnapshotDiff` (GET `…/snapshots/:sid/diff` → `MakeSnapshotDiff`),
`REST.makeSnapshotFile` (GET `…/snapshots/:sid/file?path=` → `MakeFileContent`), `REST.makeRestoreFile` (POST `…/snapshots/:sid/restore-file {path}`), `REST.makeImport` (POST `…/import
{dataBase64, mode}`, bodyLimit 12 МБ), `REST.makeImportUrl` (POST `…/import-url {url, mode}`), `export.zip?vite=1`;
мосты `make:snapshotDiff/restoreFile/import/importUrl`. Сообщение iframe → панель: `vc-make.console`. Константы `MAKE_TRANSPILED_EXTENSIONS`, `MAKE_STORIES_PAGE`, `MAKE_REACT_IMPORT_MAP`.

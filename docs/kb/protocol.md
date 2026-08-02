---
title: Контракт клиент↔сервер (REST, WS, мосты)
updated: 2026-08-01
checked: 12c087a
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
переформулировки черновика; канал `prompt:suggest`). Полный список — константа `REST`.

Владелец данных — логин пользователя (`uid(req)` = `req.user.name`); запросы к
разговорам и машинам фильтруются по нему.

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
`pty.start/input/resize/kill`.

Сервер→клиент: `stt.partial/final/error`, `claude.token/done/error/log/active`,
`tts.audio/error`, прогресс скачивания голоса и модели, `cc.tail`, `cx.tail`,
`agents` (живой список машин), `pty.output/exit/error`, `kb.usage`.

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
поток `claude.log` с активностью агента. `claude.done` несёт готовое `message`,
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

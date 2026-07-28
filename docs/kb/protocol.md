---
title: Контракт клиент↔сервер (REST, WS, мосты)
updated: 2026-07-28
checked: 6e1cbfb
areas:
  - packages/shared/src/protocol.ts
  - packages/shared/src/ipc.ts
  - packages/shared/src/agentProtocol.ts
  - apps/server/src/ws.ts
  - apps/server/src/routes
  - packages/ui/src/remote
---

# Контракт клиент↔сервер (REST, WS, мосты)

Источники истины — читай их, а не пересказ:
`packages/shared/src/protocol.ts` (REST-пути + WS-сообщения),
`packages/shared/src/ipc.ts` (формы мостов `window.*`),
`packages/shared/src/agentProtocol.ts` (сервер↔машина).

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
наблюдатели сессий Claude (`/api/cc/*`) и Codex (`/api/cx/*`), админка
пользователей, помощник промптов (`POST /api/prompt/suggest` — одноразовый LLM-вызов,
переформулировки черновика; канал `prompt:suggest`). Полный список — константа `REST`.

Владелец данных — логин пользователя (`uid(req)` = `req.user.name`); запросы к
разговорам и машинам фильтруются по нему.

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
`agents` (живой список машин), `pty.output/exit/error`.

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
переопределение движка/модели `llmProvider`/`llmModel` (`null` — из общих
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

## Сервер↔машина (`/agent`)

Отдельный WS с собственным протоколом (`agentProtocol.ts`): `AgentToServer` и
`ServerToAgent`. Детали (регистрация, политика, версии, PTY) — `machines.md`.

## Начальный каталог PTY

Сообщение `pty.start` на участках client→server и server→agent содержит необязательное поле `cwd`. Сервер проверяет владение машиной и передаёт поле реестру; агент запускает native PTY или pipe-fallback в указанной папке, а при отсутствии поля использует свой корень.

**Проекты и канбан** (REST `projects:*`/`columns:*`/`tasks:*`, WS `board.subscribe`/`board.update`, мост `window.board`) — отдельная подсистема, см. [projects.md](projects.md).


**Feature Run** (REST `features:*`, Agent Tasks и deployments) описан в [features/feature-workflow.md](features/feature-workflow.md). Живые краткие состояния приходят в существующем `board.update`.

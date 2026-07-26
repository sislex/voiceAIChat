---
title: Контракт клиент↔сервер (REST, WS, мосты)
updated: 2026-07-26
checked: c9170a7
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

Группы: сессия, разговоры и сообщения (+ поиск), вложения (`/api/uploads`),
настройки, возможности системы, STT-модели, TTS-голоса и каталог, MCP-серверы,
статус входа CLI, машины (+ политика, токен, файловые операции, exec),
наблюдатели сессий Claude (`/api/cc/*`) и Codex (`/api/cx/*`), админка
пользователей. Полный список — константа `REST`.

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

Настройки выполнения принадлежат разговору: `Conversation.execTarget` (id машины,
`null` — сервер, `'none'` — команды запрещены), `workdir` и `skillNames`, плюс
переопределение движка/модели `llmProvider`/`llmModel` (`null` — из общих
настроек; модель codex `''` — дефолт из конфига codex). Кнопка
в шапке открывает отдельную страницу настроек разговора; рядом с названием чата
шапка показывает машину разговора. Мост
`conversations:setExecTarget` сохраняет поля одним `PATCH /api/conversations/:id`.
При отправке `claude.send.execTarget` получает цель активного разговора.

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

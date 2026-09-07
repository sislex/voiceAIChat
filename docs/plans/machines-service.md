# Машины и админка отдельными сервисами (этап 3 плана «части приложения на любом сервере»)

Статус: круг 1 ☑, круг 2 ☐, круг 3 ☐ (2026-09-07). Ветка `feat/machines-service` поверх
`feat/kanban-service` (#113) и `feat/db-postgres` (#112).

## Зачем

Цель пользователя: все части приложения, кроме чата, базы и CLI моделей, должны запускаться на любом
сервере или локально — «указать в настройках, где лежат база и чат, и как авторизоваться». После Make
(`make-standalone.md`) и канбана (`kanban-service.md`) остаются машины (компаньон-агенты, их WebSocket,
exec/fs/PTY/тоннели, установщики, политика команд) и админка. Рецепт тот же: явный модуль с портами,
локальная реализация в ядре, HTTP-реализация для отдельного процесса, прокси путей в ядре, compose-профиль,
по умолчанию `embedded` — прод не меняется.

## Инвентарь (2026-09-07)

**Что такое «машины» в коде:** `agents/registry.ts` (934 строки: онлайн-подключения, exec/execStream,
fs*, gitAccess, http-мост, PTY-релей, тоннели, телеметрия, версии), `agents/wsAgent.ts` (WS `/agent`),
`routes/agents.ts` (766: список, токены, политика, шары, хранилища, установка/обновление агента),
установщики (`unixInstall`, `windowsInstall`, `androidInstall`, `agentScript`), `defaultStorage.ts`
(каталог ChatAI по умолчанию), `watchdog.ts` (тревога «машина пропала»), `commandGate.ts` (политика команд),
`storageMigration/` (перенос хранилищ), журнал команд (`onCommand` в `server.ts`). Итого ≈ 3 000 строк.

**Потребители реестра** (число вызовов по файлам): `server.ts` 81 (сессия: PTY ×9, проводник fs ×23,
`agentsFeed`, git-панель, storybook-сессии, превью, хранилища чата), `routes/agents.ts` 48 (сам модуль),
`kanban/*` 25 (через фасад `KanbanMachines`), `components/storybookSessions.ts` 12 (PTY + http),
`routes/admin.ts` 10 (`versionOf`, `telemetryOf`, `disconnect`, `onlineIds`), `mcp/consoleMcp.ts` 9
(PTY-буфер), `mcp/remoteBashMcp.ts` 8, `turns.ts` 7, `storageMigration` 4, `kb/kbMcp.ts` 3, `uploads.ts`,
`projectSync.ts`, `agents/watchdog.ts`. Всего у потребителей ~35 методов; синхронных чтений много
(`isOnline`, `nameOf`, `versionOf`, `telemetryOf`, `imageHostOf`, `onlineIds`, `ptyLive`, `ptyBufferText`,
`ptyContextOf`).

**Особенности транспорта.** PTY — двунаправленный поток (`ptyStart(..., emit)` + `ptyInput`); тоннели
(`createTunnel`) открывают порт на **машине-источнике** (локальном агенте пользователя), а не на сервере —
от места запуска реестра не зависят; `http(agentId, request)` — запрос/ответ через WS агента (превью
dev-сервера); события `onChange`/`onCommand`/`onAgentReady` — обратные вызовы.

**Админка:** `routes/admin.ts` (641: пользователи, роли, сессии, версии агентов, расход Make, деплой через
`deployTrigger`, письма), `/api/admin/*` ещё в `routes/agents.ts` (1) и `routes/projectTypes.ts` (2, канбан).
Зависимости: `db`, реестр (5 методов), `deployTrigger` (сокет деплоя на хосте ядра), `make.adminStats/metrics`,
`mailer`, `sessionHub`.

## Круги

### Круг 1 — модуль машин и порт `MachinesService` ☑ (2026-09-07)
1. ☑ `machines/service.ts` — порт `MachinesService`: поверхность реестра, которой пользуются потребители
   (без `register`/`unregister` — они внутренние для WS агента). `AgentRegistry` удовлетворяет структурно
   (проверка типом в гейте).
2. ☑ `machines/module.ts` — `createMachinesModule(deps)`: реестр, WS `/agent`, роуты машин и установщиков,
   политика команд, каталог ChatAI по умолчанию, журнал команд (лог в хранилище чата — через обратный
   вызов ядра), watchdog, перенос хранилищ. Возвращает `{ machines: MachinesService, commandGate }`.
3. ☑ Потребители (`consoleMcp`, `remoteBashMcp`, `admin`, `storageMigration`, `kanbanBridge/localCore`, `routes/projectComponents`)
   типизируются `MachinesService`; гейт `machines/boundary.test.ts`: `server.ts` не собирает машины сам,
   `agents/registry` импортируют только модуль машин и его файлы, `AgentRegistry ⊇ MachinesService` типом.
   Решение: журнал команд пишет полный лог в artifacts чата через обратный вызов ядра `chatArtifacts` —
   знание о хранилищах разговора остаётся у ядра; `closeTunnel` у потребителей ждёт `await` (в remote — сеть).

### Круг 2 — отдельный процесс машин ☐
1. ☐ Контракт `machines/internal.ts`: RPC (`/internal/machines/rpc`), потоковый exec (общий с канбаном),
   **шина событий** — один WebSocket «ядро → процесс машин» (`/internal/machines/events`): изменения реестра
   (снимок машин: онлайн, имя, версия, платформа, политика, телеметрия, imageHost), журнал команд, `agentReady`,
   события PTY по `ptyId`. Синхронные чтения у ядра — из зеркала; PTY-состояние (`ptyLive`, `ptyBufferText`,
   `ptyContextOf`) — тоже зеркало по событиям PTY.
2. ☐ `HttpMachines` (`machines/standalone/httpMachines.ts` для потребителей в ядре — обратное направление
   к канбану: провайдер снаружи), standalone-процесс `machines/standalone/` (реестр + WS агентов + роуты машин
   + пересылка авторизации + `/v1/health`), у ядра `VC_MACHINES_MODE=remote`, `VC_MACHINES_URL`, прокси
   `/api/agents/*`, установщики, WS `/agent` — Caddy направляет в процесс машин (WebSocket через прокси
   ядра не тащим).
3. ☐ Канбан и Make в remote берут машины у ядра через свои порты — состав не меняется (ядро отдаёт
   `HttpMachines` под теми же фасадами).

### Круг 3 — админка отдельным процессом ☐
1. ☐ `admin/standalone/`: `routes/admin.ts` + пересылка авторизации; порты — машины (`HttpMachines`), Make
   (`createRemoteMake`), `deployTrigger` и `sessionHub` — RPC к ядру (`/internal/admin/*`), `mailer` локально.
   Ядро проксирует `/api/admin/*`. Compose-профиль `admin`.
2. ☐ Прогон на копии прод-БД (ядро + машины + канбан + админка отдельными процессами), browser-smoke, PR.

## Риски

- PTY через шину событий добавляет задержку эха; лимит — один WS на пару процессов, при обрыве сессии PTY
  закрываются (как при рестарте ядра сегодня).
- `AgentFsError` и другие классы ошибок реестра у потребителей (`instanceof`) — в remote ошибки приходят
  текстом; нужен единый код ошибки в RPC.
- Установщики агентов отдают адрес сервера для подключения (`/agent`): в remote это адрес процесса машин
  за Caddy.

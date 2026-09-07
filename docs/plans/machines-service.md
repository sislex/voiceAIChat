# Машины и админка отдельными сервисами (этап 3 плана «части приложения на любом сервере»)

Статус: круг 1 ☑, круг 2 ☑, круг 3 ☐ (2026-09-07). Ветка `feat/machines-service` поверх
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

### Круг 2 — отдельный процесс машин ☑ (2026-09-07)
1. ☑ Контракт `machines/internal.ts`: RPC `/internal/rpc` (`MACHINES_RPC_METHODS`: файлы, git, http,
   PTY-команды, тоннели, `waitForOnline`, `snapshot`), потоковый exec `/internal/exec-stream` (общий формат
   `internal/execStream.ts` — тот же, что у канбана), шина событий `/internal/events` — постоянный WebSocket
   «ядро → процесс машин»: снимки машин (`MachineState`: онлайн, имя, версия, платформа, политика, телеметрия,
   imageHost) и PTY-сессий (`PtyState`), события PTY по `ptyId`, кадры владельцам (`frame`), `agentReady`,
   журнал команд, запросы авторизации тоннелей (ответ — по той же шине). В реестре появились `onPtyChange` и
   `ptySnapshot()`.
2. ☑ Ядро: `machinesBridge/httpMachines.ts` — `HttpMachines implements MachinesService` (зеркало для
   синхронных чтений, буфер PTY на стороне ядра с момента подписки, RPC с восстановлением `AgentFsError` по
   коду, переподключение шины; при обрыве шины все машины считаются offline до переподключения),
   `machinesBridge/proxy.ts` — прокси REST (`MACHINES_PROXY_PREFIXES`, полноту держит `proxy.test.ts`) и
   **WebSocket-прокси `/agent`** в процесс машин (Caddy не знает, включён ли профиль; пинги процесса машин
   до агента не проходят — прокси пингует сам). Конфиг `VC_MACHINES_MODE=remote`, `VC_MACHINES_URL`; гейт
   команд в remote ядро строит само (`createDbCommandGate`, только данные базы).
3. ☑ Процесс машин `machines/standalone/` (`buildMachinesServer`): тот же `createMachinesModule`, пересылка
   авторизации в ядро (`internal/forwardedAuth.ts`, общая с канбаном; публичные пути — `isPublic` ядра), шина
   событий, RPC, exec-stream, `/v1/health`; точка входа `index.ts` (порт 8793). Compose: сервис `machines`
   (профиль `machines`, образ `machines-runtime`), у ядра `VC_MACHINES_MODE` по умолчанию `embedded`.
4. ☑ Хранилище разговора на машине вынесено в `chatStorage.ts` (`createManagedChatStorage`) — общий helper
   ядра и модуля машин; модуль сам пишет лог долгой команды в artifacts чата.
5. ☑ Тесты: `machinesBridge/httpMachines.test.ts` (зеркало, PTY, кадры, тоннели, коды ошибок),
   `machinesBridge/machinesRemote.integration.test.ts` (ядро remote + процесс машин + фейковый агент через
   WebSocket-прокси ядра: список машин через прокси, команда REST → агент → журнал → кадр `machine.command`
   в WS-сессии ядра, PTY из сессии ядра туда и обратно), `internal/execStream.test.ts`.
   Решения: канбан и Make в remote получают машины у ядра под теми же портами (`HttpMachines` структурно —
   `MachinesService`); `ptyBufferText` у ядра — вывод с момента подписки (полный буфер — у процесса машин).

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

---
title: kanban-service-round3
date: 2026-09-07
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Канбан как отдельное приложение — круг 3: отдельный процесс канбана

## Что сделано

- `kanban/standalone/` — отдельный процесс канбана: `buildKanbanServer` (тот же `loadConfig` и
  `createKanbanModule`, своя `VoiceChatDb` на `VC_DB_URL`), `HttpKanbanCore` (зеркало машин, потоковый exec
  через ядро, RPC для KB/вложений/виджета/git-копий), пересылка авторизации в `/internal/whoami`, отправка
  событий кластера ядру пачками, `/internal/service`, `/internal/machines`, `/v1/health`, точка входа `index.ts`.
- Сторона ядра `kanbanBridge/`: `internal.ts` (RPC-диспетчер `KanbanCore`, снимок машин), `remote.ts`
  (`KanbanService` на локальных лентах), `proxy.ts` (`KANBAN_PROXY_PREFIXES`); `routes/internal.ts` — RPC,
  NDJSON exec-stream, приём событий, `MakeService` по RPC при встроенном Make. Конфиг: `VC_KANBAN_MODE`,
  `VC_KANBAN_URL`, `VC_KANBAN_MCP_PUBLIC_BASE`, `VC_CORE_URL`.
- Транспорт RPC и whoami — в `@voicechat/shared` (`internalRpc.ts`), Make реэкспортирует; прокси Make обобщён
  в `registerServiceProxy`.
- Фасад `KanbanMachines`/`KanbanUploads`/`KanbanWidgets`: `closeTunnel`, `uploads.get`, `widgets.surface`
  могут возвращать `Promise` — пять мест вызова получили `await`.
- Compose: сервис `kanban` (профиль `kanban`, образ `kanban-runtime`, порт 8789), у ядра `VC_KANBAN_MODE`
  по умолчанию `embedded`. Caddy без изменений — пути канбана идут только через прокси ядра.
- Тесты: диспетчер, удалённый сервис, exec-клиент, зеркало, интеграционный «ядро remote + канбан standalone».

## Что выяснили (факты, которых не было в KB)

- Под `/api/projects/*` у ядра свои роуты (git-панель `routes/projectGit.ts`, `kb/routes.ts`), а права проекта
  проверяет preHandler ядра по пути — поэтому Caddy не должен направлять пути канбана мимо ядра; wildcard-прокси
  Fastify уступает конкретным роутам ядра, и они остаются на месте.
- Кластер зовёт у реестра синхронно 21 `isOnline` и ещё пять методов — по сети это не сделать, нужно зеркало;
  телеметрия проходит через `AgentRegistry.onChange`, так что один пуш по `onChange` покрывает и её.
- У undici таймаут тела ответа 5 минут по умолчанию — для потока вывода шага CI клиент на `node:http`.
- Отдельному канбану нужен `MakeService.taskSources`: при встроенном Make ядро отдаёт `MakeService` по тому же
  RPC-пути `/internal/service`, что и процесс Make.
- Список префиксов прокси нельзя собирать «на глаз»: `/api/task-preparation/*` регистрируется через `REST.*`
  в `kanban/module.ts` и выпал из первого списка (404 на прод-копии) — теперь его полноту проверяет
  `kanbanBridge/proxy.test.ts`, разбирая исходники кластера и `protocol.ts`.
- compose подставляет переменные всех сервисов независимо от профилей: `${VAR:?…}` у сервиса профиля
  ломает `docker compose up` без него (поймано на `VC_PG_PASSWORD` из этапа 1, исправлено там же).
- Хвостовые `undefined` в аргументах RPC JSON превращает в `null` — клиент их отрезает, иначе у ядра не
  срабатывают значения по умолчанию (`view?: KbView`).

## Куда занесено

- docs/kb/server-internals.md — «Режим VC_KANBAN_MODE=remote»
- docs/kb/deploy.md — «Канбан отдельным сервисом», docs/docker.md — таблица переменных
- apps/server/AGENTS.md — `kanban/standalone/`, `kanbanBridge/`
- docs/plans/kanban-service.md — круг 3 ☑ с решениями по упаковке, машинам и Caddy

## Открытые вопросы / что осталось

- Долг: `featurePreviewsRef` пуст в remote → `KanbanService.previews`; пакет базы данных как предпосылка
  физического переезда кластера в `apps/kanban`; перекат одного `kanban` в Release Center.

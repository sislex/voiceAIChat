---
title: machines-service-round1
date: 2026-09-07
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Машины и админка отдельными сервисами — круг 1: модуль машин и порт `MachinesService`

## Что сделано

- План `docs/plans/machines-service.md`: инвентарь (≈3 000 строк кода машин; потребители реестра — `server.ts` 81
  вызов, `routes/agents.ts` 48, канбан 25, storybook-сессии 12, админка 10, MCP консоли 9 и т. д., ~35 методов,
  много синхронных чтений), особенности транспорта (PTY двунаправленный, тоннели открывают порт на машине-источнике,
  `http` через WS агента), три круга.
- `machines/service.ts` — порт `MachinesService` (публичная поверхность реестра без `register`/`unregister`).
- `machines/module.ts` — `createMachinesModule(deps)`: реестр, WS `/agent`, `registerAgentRoutes`, политика команд,
  перенос хранилищ, журнал команд (лог в artifacts чата — через обратный вызов ядра `chatArtifacts`), каталог ChatAI
  по умолчанию, watchdog. `server.ts` держит только `machinesModule.machines`/`commandGate`.
- Потребители типизированы портом: `mcp/consoleMcp`, `mcp/remoteBashMcp`, `routes/admin`, `storageMigration/routes`,
  `kanbanBridge/localCore`, `routes/agents.updateAgentOnMachine`; `close` тоннеля в `routes/projectComponents` ждёт `await`.
- Гейт `machines/boundary.test.ts`: маркеры сборки только в модуле, запрет импорта `AgentRegistry` вне модуля и его
  частей, структурная проверка `AgentRegistry ⊇ MachinesService`.

## Что выяснили (факты, которых не было в KB)

- Тоннели превью (`createTunnel`) открывают порт на локальном агенте пользователя (машина-источник), а не на
  сервере, — от места запуска реестра не зависят; ядру нужен только номер порта.
- Журнал команд машины в `server.ts` смешивал две ответственности: запись в БД/тост (машины) и сохранение лога в
  artifacts привязанного хранилища разговора (чат). Разрезано обратным вызовом.
- Первичная телеметрия агента (`onAgentReady`) — момент создания каталога ChatAI по умолчанию: это часть модуля машин.

## Куда занесено

- docs/kb/server-internals.md — «Машины: модуль machines/module.ts и порт MachinesService»
- apps/server/AGENTS.md — раскладка `machines/`
- docs/plans/machines-service.md — круг 1 ☑

## Открытые вопросы / что осталось

- Круг 2: отдельный процесс машин — контракт `machines/internal.ts`, шина событий одним WebSocket (снимок машин,
  журнал команд, agentReady, события PTY), `HttpMachines` с зеркалом, standalone, прокси `/api/agents/*`, Caddy для `/agent`.
- Круг 3: админка отдельным процессом; прогон на копии прод-БД; PR.

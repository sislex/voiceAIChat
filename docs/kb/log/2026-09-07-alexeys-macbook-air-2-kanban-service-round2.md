---
title: kanban-service-round2
date: 2026-09-07
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Канбан как отдельное приложение — круг 2: порты `KanbanCore` и `KanbanService`

## Что сделано

- `kanban/core.ts` — порт `KanbanCore`: только состояние процесса ядра — `machines` (узкий фасад
  `KanbanMachines`, 16 методов реестра по замеру использования), `kb`, `uploads.get`, `widgets`,
  `ensureProjectMainCurrent`. Локальная реализация `kanbanBridge/localCore.ts`.
- `kanban/service.ts` — порт `KanbanService`: `runs` (лента кадров ранов + снимок), `board` (`changed` для
  Make и подписки), `notifications`. `BoardHub`/`NotificationHub`, `registerKanbanMcp`, `registerCiCommandsMcp`
  переехали в модуль; `server.ts` знает только `kanban.service.*`.
- `frameHub.ts` — `UserFrameHub`: кадры самого ядра (`machine.command`, watchdog, снимки проверки) больше не
  идут через `CiRunManager.publish`; сессия подписана на обе шины (`SessionDeps.frames`, `SessionDeps.ci`).
- Файлы кластера (`routes/projects|releases|featurePreview|qa`, `projects/materialize`, `mcp/kanbanMcp`)
  типизированы фасадами `KanbanMachines`/`KanbanUploads`/`KanbanWidgets` вместо `AgentRegistry`/`UploadStore`/
  `WidgetUiRelay`.
- Гейт `kanban/boundary.test.ts`: снимок `KanbanDeps` (20 ключей), аллоулист импортов-значений из ядра,
  запрет типов состояния ядра вне порта, структурная проверка `AgentRegistry ⊇ KanbanMachines`.

## Что выяснили (факты, которых не было в KB)

- Кластер зовёт у реестра машин 16 методов; PTY, `onChange`, `fsList` и тоннели чата ему не нужны.
  `gitAccess` (5 вызовов в `routes/projects.ts`) первый замер пропустил — его нашёл typecheck.
- Импорты-значения кластера из ядра всего десять модулей: `db/database` (константы), пять файлов `kb/*`
  (функции над сервисом KB и БД), `users/auth`, `llm/remoteClient`, `manifests`, `mcp/previewMcp`.
- Ядро пользовалось лентой канбана как общей трубой кадров (`publishToUser = ciRunManager.publish`,
  watchdog, `logBrowserCheckShot`): для выделения сервиса нужна своя шина ядра.
- `turns.ts`/`prompt/contextBlocks.ts` берут контекст задачи только из БД (`db.tasks/projects/ci`) — при
  общей базе порт им не нужен.

## Куда занесено

- docs/kb/server-internals.md — раздел «Канбан-кластер: kanban/module.ts, порты KanbanCore и KanbanService»
- apps/server/AGENTS.md — раскладка `kanban/`, `kanbanBridge/`, `frameHub.ts`
- docs/plans/kanban-service.md — круг 2 ☑ с принятыми решениями

## Открытые вопросы / что осталось

- Круг 3: пакет `apps/kanban`, HTTP-реализация `KanbanCore` (`/internal/*` ядра, стриминг `execStream`),
  SSE-ленты `KanbanService` в ядро, прокси путей канбана, compose/Caddy, прогон на копии прод-БД.
- Судьба `kb/*`-функций и `users/auth` при выделении пакета; `featurePreviewsRef` → `KanbanService.previews`.

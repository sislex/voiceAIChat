---
title: remove-embedded-kanban
date: 2026-09-30
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Удаление встроенного канбана из Core

## Изменение

- Удалён встроенный режим канбана: `ci`, `merge`, `releases`, `orchestration`, `projects`, `preview`,
  `cleanup`, `kanban/module.ts`, `kanban/preparation.ts`, `kanban/standalone`, `manifests.ts`,
  `mcp/kanbanMcp.ts` и маршруты кластера в `routes/`. Их код живёт в `sislexa-kanban`.
- `VC_KANBAN_MODE`: `remote` или `off`; без канбана — `kanbanBridge/offline.ts`.
- Нужные ядру утилиты перенесены в `util/shell.ts`, `db/repos/*`, `prompt/projectContext.ts`.
- Гейт `kanban/boundary.test.ts` запрещает возвращать код кластера в ядро.

## Тесты

- Тесты ядра, которые создавали фикстуры маршрутами канбана, пишут прямо в базу.
- Удалены тесты, проверявшие только канбан: они должны жить в `sislexa-kanban`
  (`cleanup/*`, `autopilotPipeline`, `taskPreparation`, `mcp/kanbanMcp`, `manifests`,
  `kanbanRemote.integration`, e2e `projects` и `gitPane`, релизные случаи `database.projects`,
  `kb-usage` проекта, предложения улучшений, шаринг и материализация машин проекта).

## Тема базы знаний

- `docs/kb/server-internals.md` — раздел «Канбан: только сервис `sislexa-kanban`».

## Осталось

- Перенести в `sislexa-kanban` тесты, которых там нет: `cleanup/*`, `releases/targets`, проверку
  полноты `KANBAN_PROXY_PREFIXES` по исходникам кластера.

---
title: project-machines-mcp
date: 2026-08-07
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# project-machines-mcp

CHAT-133: доступ модели ко всем машинам проекта через remote MCP.

## Что сделано

- `remoteBashMcp.ts`: query `project=<id>` + резолвер машин проекта (5-й аргумент
  `registerRemoteBashMcp`, в `server.ts` — `db.listProjectMachines`); инструмент
  `machines` и необязательный параметр `machine` у bash/read/grep/edit — операция
  адресуется другой машине проекта, её `cwd` — `project_machines.path`.
- `turns.ts` (чат с проектом) и `ci/modelHooks.ts` (`remoteOf`, ходы CI-рана)
  дописывают `project=` и передают имена других машин в `remote.projectMachines`
  (`packages/shared/src/llm.ts`); `claudeCli`/`codexCli` называют их в системном
  хинте, у claude `mcp__remote__machines` попадает в allow-list автоодобрения.
- Без других машин проекта (или вне проекта) поведение прежнее: ни инструмента,
  ни параметра. Гейты `ro=1` и чтения файлов — до резолва машины.

## Что выяснили (факты, которых не было в KB)

- Ветка фазы плана в `modelHooks.ts` намеренно пересобирает `remote` без
  `ciMcpUrl` (команды CI-справочника в плане выключены) — при расширении
  `remote` новые поля надо переносить туда явно.

## Куда занесено

- docs/kb/llm.md («Проброс Bash…» → абзац «Машины проекта»)
- docs/kb/machines.md («Выбор машины для чата»)

## Открытые вопросы / что осталось

- «Исследовать проект» (`kb/research.ts`) и шаг kb_update ходят по-прежнему только
  на свою машину — расширение там не требовалось по задаче.

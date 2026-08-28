---
title: machines-roadmap-4
date: 2026-08-28
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# machines-roadmap-4 — журнал команд машины

## Что сделано

- `machine_commands` + `registry.onCommand`/`ExecMeta`; REST `GET /api/agents/:id/commands` (+CSV); мост `agents:commands`.
- `MachineCommandLog` на странице машин: фильтр, источник, раскрытие вывода, экспорт, переход в чат.
- MCP-URL хода получает `&conv=<conversationId>` — записи из чата знают свой разговор.

## Куда занесено

- docs/kb/machines.md — новый раздел «Журнал команд машины».

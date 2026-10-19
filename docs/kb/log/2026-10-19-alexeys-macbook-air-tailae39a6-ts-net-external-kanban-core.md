---
title: external-kanban-core
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# external-kanban-core

## Что сделано

- Внешний Kanban (`projects=https://…` + `VC_APPLICATION_PROJECTS_SERVICE_TOKEN`) подключён к ядру: вызовы ядра в общий Kanban идут с сервисным токеном и `x-sislexa-core-id`, обратные вызовы `/internal/kanban/*` принимаются по токену приложения `projects`; прокси UI нет.

## Что выяснили (факты, которых не было в KB)

- До этого изменения внешний Kanban получал 404 на `/internal/kanban/*`: маршруты регистрировались только при `VC_KANBAN_MODE=remote`.

## Куда занесено

- docs/kb/data-auth.md (раздел «External Kanban»)

## Открытые вопросы / что осталось

- MCP-токены ядра для `/mcp/kanban` ядро пока не выдаёт (таблица MCP — только Make и Image Studio).

---
title: shared-service-mcp-authority
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# shared-service-mcp-authority

## Что сделано

- Общий сервис может действовать от имени пользователя хода по MCP-токену ядра: заголовок `x-sislexa-mcp-token` вместе с токеном приложения на путях `SHARED_SERVICE_RPC_ROUTES`. Токен с `scope` задачи — только чтение (`readMethods`).
- В таблицу добавлены методы Web Reader `context`, `logBrowserEvidence` (форма `{ userArg, field }`) и `projectResource` (`'delegated'`), а также путь `/internal/playwright-reader/service` для Web Reader.
- Ядро выдаёт MCP-токены внешним Web Reader (`/mcp/preview`) и Kanban (`/mcp/kanban`); у Playwright Reader своего MCP нет.
- Источники задач внешнего Make: по одному токену на беседу-источник с claim `scope` вместо пары `task:<id>` + отдельной подписи scope.

## Что выяснили (факты, которых не было в KB)

- На ходах, которые ведёт само ядро, у раннера есть только MCP-URL — делегирования по тикету нет, поэтому инструменты Make/Image Studio падали с `delegation_required`.

## Куда занесено

- docs/kb/data-auth.md («Shared-service RPC and MCP»), docs/kb/architecture.md

## Открытые вопросы / что осталось

- Сервисы должны перейти на Shared 0.1.41 / component-runtime 1.4.0 и присылать `x-sislexa-mcp-token` (Make B22, Web Reader B23, Image Studio B24); Make — принимать токены источников задач со `scope`.

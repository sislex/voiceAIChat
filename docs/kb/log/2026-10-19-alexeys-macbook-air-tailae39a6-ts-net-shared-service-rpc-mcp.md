---
title: shared-service-rpc-mcp
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# shared-service-rpc-mcp

## Что сделано

- B17 прогона deployment-profiles-v2: общие сервисы вызывают внутренний RPC ядра токеном приложения и делегированием тикета; пользователь берётся из делегирования по таблице методов `SHARED_SERVICE_RPC_ROUTES` (Shared).
- Ядро вызывает внешний Make (`/internal/service`) токеном сервиса, `x-sislexa-core-id` и коротким делегированием пользователя; события Make принимает с делегированием.
- MCP внешних Make и Image Studio — по токену `sxm1.` (HMAC секрета приложения) на ход: `signCoreMcpToken`/`verifyCoreMcpToken` в component-runtime.
- Делегированный `POST /api/conversations` — только с видом ассистента своего приложения.

## Что выяснили (факты, которых не было в KB)

- Без таблицы методов токен приложения пришлось бы приравнять к `VC_INTERNAL_TOKEN` — полный внутренний доступ и действия от имени любого пользователя сборки.
- Make `machineFs.*` и Reader `listPreviews`/`context`/`projectResource` не привязаны к пользователю — для общих сервисов закрыты.

## Куда занесено

- docs/kb/data-auth.md («Shared-service RPC and MCP»), docs/kb/architecture.md

## Открытые вопросы / что осталось

- Kanban внешним приложением: в ядре нет внутренних маршрутов для него при `VC_KANBAN_MODE=off`.
- Вызовы ядра во внешний Image Studio (`promptContext`, `captureImages`) — пока только Make.

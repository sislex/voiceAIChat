---
title: reader-service-round1
date: 2026-09-08
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# reader-service-round1

## Что сделано

- План `docs/plans/web-reader-service.md` (этап 4: Web Reader отдельным сервисом), круг 1: модуль
  `reader/module.ts` (прокси превью + MCP «browser» + контекст Chromium), порт `ReaderCore` (`reader/core.ts`),
  локальная реализация `readerBridge/localCore.ts`; `server.ts` собирает ридер одной функцией.
- Токены ходов превью подписаны секретом MCP (`reader/turnToken.ts`) вместо in-memory брокера: закрыт разрыв
  remote-канбана, где ход CI регистрировал токен в своём процессе, а `/mcp/preview` проверял его в ядре.
- Гейт границы `reader/boundary.test.ts`, тест токенов `reader/turnToken.test.ts`.

## Что выяснили (факты, которых не было в KB)

- Ридеру от процесса ядра нужны только четыре вещи: relay действий в панель (WS-сессии), реестр ключей
  Chromium (проверяет авторизация ядра), список feature-preview и запись кадра проверки в ленту рана.

## Куда занесено

- docs/plans/web-reader-service.md, apps/server/AGENTS.md (раскладка `reader/`, `readerBridge/`).

## Открытые вопросы / что осталось

- Круг 2: отдельный процесс `reader/standalone`, `VC_READER_MODE=remote`, прокси путей, compose-профиль.

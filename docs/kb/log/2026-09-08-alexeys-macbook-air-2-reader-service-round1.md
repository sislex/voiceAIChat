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

- Несколько `VoiceChatDb` на одной базе Postgres нельзя открывать одновременно без замка: `CREATE TABLE IF NOT
  EXISTS` двух сессий упирается в deadlock 40P01. Compose стартует сервисы разом — этапы 2–3 не ловили это случайно.
- Ридеру от процесса ядра нужны только четыре вещи: relay действий в панель (WS-сессии), реестр ключей
  Chromium (проверяет авторизация ядра), список feature-preview и запись кадра проверки в ленту рана.

## Куда занесено

- docs/plans/web-reader-service.md, apps/server/AGENTS.md (раскладка `reader/`, `readerBridge/`),
  docs/kb/server-internals.md (раздел «Web Reader»), docs/kb/deploy.md (строка распределённого стенда).

- Круг 2 (та же сессия): отдельный процесс `reader/standalone` (`buildReaderServer`, `HttpReaderCore`, порт 8795),
  RPC ядра `/internal/reader/core`, прокси `readerBridge/proxy.ts`, `VC_READER_MODE=remote`/`VC_READER_URL`/
  `VC_READER_MCP_PUBLIC_BASE`, compose-профиль `reader`, образ `reader-runtime`; тесты полноты/приоритета прокси
  и интеграция «ядро remote + процесс ридера».

- Круг 3: прогон на копии прод-БД (ядро 8799 remote + ридер 8795): превью через ядро и напрямую, 401 без сессии,
  MCP с подписанным токеном → relay ядра по RPC. Найден дефект одновременного старта на Postgres (deadlock на
  `CREATE TABLE IF NOT EXISTS`, duplicate key на `CREATE SCHEMA`) — схема ставится под `pg_advisory_xact_lock`,
  тест `db/database.pgBootstrap.test.ts` на Postgres.

## Открытые вопросы / что осталось

- Включение `VC_READER_MODE=remote` на проде (профиль `reader`) — решение пользователя, как и для остальных сервисов.
- Панель браузера с отдельным ридером вживую не проверялась (только интеграционный тест с WS-клиентом).

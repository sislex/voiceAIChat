---
title: db-postgres-round1
date: 2026-09-07
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Postgres как движок базы — круг 1: асинхронный адаптер и репозитории на нём

## Что сделано

- План `docs/plans/db-postgres.md`: почему вся база на одном движке, а не домен за доменом; один код
  репозиториев на оба движка вместо второй реализации; DDL Postgres из SQLite-схемы; проверка всей
  матрицей тестов сервера через `VC_TEST_DB_URL`.
- Адаптер `db/sql/` — `types.ts` (`Sql`: get/all/run/exec/prepare/transaction), `sqlite.ts`
  (better-sqlite3, транзакции BEGIN/COMMIT вокруг асинхронного тела через AsyncLocalStorage,
  вложенные — SAVEPOINT, чужие запросы ждут конца транзакции), `lane.ts` (полоса: методы портов
  по одному, синхронный старт при свободной полосе, `idle()` для `close()`).
- Codemod `scratchpad/sqlify.mjs`: 13 файлов, ~5 200 правок, 567 из 585 методов стали `async`
  (фикспойнт по классам и файлам через `this.repos.<домен>`), `this.db.transaction(() => …)()` →
  `await this.sql.transaction(async () => …)`; 14 async-колбэков в forEach/filter/find/flatMap
  переписаны циклами руками; аудит `promise-audit.mjs` (TS checker: промис вне await) — ноль.
- `VoiceChatDb`: `ready` (схема и миграции после конструктора), порты ждут `ready` и идут через
  полосу; `db.impl` (алиас `db.sync`); `close()` ждёт миграции и полосу. PoC pglite снят
  (`db/pg/*`, `VC_DB_RELEASES`, зависимость `@electric-sql/pglite`); добавлены `pg`/`@types/pg`.
- Все 2 163 теста сервера зелёные на SQLite; гейт — по коду возврата.

## Что выяснили (факты, которых не было в KB)

- Синхронный драйвер давал две невидимые гарантии, на которые опирается и прод, и тесты: тело
  метода репозитория атомарно относительно других вызовов, и вызов без `await` выполняется до
  следующей строки. Без полосы падали ~70 тестов (гонки `max(position)`, часы, «connection not
  open» после `close()` при незавершённых миграциях); полоса вернула обе гарантии для SQLite.
- `better-sqlite3` принимает объект как именованные параметры (`@name`) — `ci.ts`, `chat.ts`,
  `tasks.ts` так делают; для Postgres их придётся переводить в позиционные (круг 2).
- `db.transaction(fn).immediate()` в `projects.ts` (write-lock до чтения) заменён обычной
  транзакцией: полоса и мьютекс адаптера и так пускают транзакции по одной.
- `listConversations` без `scope` и прочие «сюрпризы» не при чём: все семантические падения
  сводились к гонкам вызовов без `await`.

## Куда занесено

- docs/kb/data-auth.md — «Репозитории асинхронны внутри и не знают драйвера»
- docs/kb/conventions.md — «Репозитории асинхронны внутри — правила слоя данных»
- docs/kb/deploy.md — убран `VC_DB_RELEASES`
- apps/server/AGENTS.md — раскладка `db/sql/`, правило для тестов
- docs/plans/db-postgres.md — статусы круга 1

## Открытые вопросы / что осталось

- Круг 2: `db/sql/pg.ts`, `dialect.ts`, `schemaPg.ts`, вся матрица тестов на Postgres в docker.
- Многошаговые методы без транзакций атомарны только на SQLite — на Postgres нужен аудит
  «читаю, потом пишу по прочитанному» (в первую очередь `createTask`/`moveTask`, позиции).

---
title: db-postgres-round2
date: 2026-09-07
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Postgres как движок базы — круг 2: адаптер, транслятор, схема, матрица тестов

## Что сделано

- `db/sql/pg.ts` — адаптер над node-postgres (пул, транзакции на выделенном клиенте через ALS,
  int8/numeric → Number, `VC_SQL_TRACE=1`); `db/sql/dialect.ts` — перевод SQL из диалекта SQLite
  (12 правил, каждое под тестом); `db/schemaPg.ts` — генератор DDL Postgres из `schema.ts`
  (rowid у каждой таблицы, FK отдельными ALTER, сиды, tsvector-индекс сообщений, plpgsql-триггеры
  `cost_dirty`); `ChatRepo.j` — JSON1/strftime по движку; `toPgTsQuery` в `fts.ts`.
- `VoiceChatDb`: `DbDeps.postgres`, `VC_DB_URL` в конфиге и `server.ts`, `VC_TEST_DB_URL` — каждая
  `:memory:`-база в тестах открывается свежей схемой Postgres; полоса включена на обоих движках
  (`DbDeps.concurrent` снимает).
- `db/copyToPostgres.ts` + CLI — перенос данных SQLite → Postgres с rowid и последовательностями (тест).
- Матрица: 2 190+ тестов сервера зелёные на Postgres; исключения — сырой драйвер/файловые базы
  (`ON_POSTGRES`) и карантин из 26 тестов менеджеров (см. план, раздел «Долг после круга 2»).

## Что выяснили (факты, которых не было в KB)

- **Настоящий дефект, найденный матрицей:** WS-кадры, пришедшие пока идёт проверка сессии
  (`resolveActiveUser` — запросы к базе), терялись: слушатель `message` появлялся только в
  `attachWs`. С SQLite окно укладывалось в микрозадачи, с Postgres — миллисекунды сети. Исправлено
  буфером ранних кадров в маршруте `/ws`.
- 30 колонок жили только в ALTER миграций и отсутствовали в `schema.ts` (`users.email`,
  `conversations.permission_mode`, `projects.ci_*`, …): на SQLite это незаметно, на Postgres таблица
  без них. Дописаны; гейт `schemaPg.test.ts` требует каждую ALTER-колонку в CREATE TABLE.
- Postgres опускает регистр некавыченных идентификаторов: `AS inputTokens` возвращалось как
  `inputtokens` — транслятор берёт camelCase в кавычки.
- Параметр без контекста типа (`CASE … THEN $n`, `COALESCE(col, $n)`, `$n IS NULL`) Postgres считает
  текстом: числовые параметры получают явный `::bigint`/`::double precision`, `? IS NULL`
  сворачивается в литерал по значению; `LIMIT -1` (у SQLite «без предела») → `LIMIT ALL`.
- `DROP SCHEMA … CASCADE` со 113 таблицами упирается в `max_locks_per_transaction=64` → «out of
  shared memory» под параллельными тестами; контейнер поднимается с `-c max_locks_per_transaction=1024`.
- Тесты менеджеров (`taskPreparation`, `releaseManager`, WS) считали промежуточные состояния
  ненаблюдаемыми (`validating`, `tick()` в один цикл событий): это свойство синхронного драйвера,
  не контракт; опросы переписаны на ожидание терминального состояния или реального времени.
- `ts_rank_cd` — float4: ранг поиска приводится к double до сравнения с курсором, иначе страницы
  теряли строки с равным рангом.
- В коде сервера нет `VACUUM INTO`/резервных копий — снимки прода делаются вручную.

## Куда занесено

- docs/kb/data-auth.md — «Postgres как движок всей базы»
- docs/kb/conventions.md — правило «SQL в диалекте SQLite и через транслятор»
- docs/kb/deploy.md — `VC_DB_URL`
- apps/server/AGENTS.md — раскладка `db/sql/`, `schemaPg.ts`, `copyToPostgres.ts`
- docs/plans/db-postgres.md — статусы круга 2, «Долг после круга 2»

## Открытые вопросы / что осталось

- Круг 3: сервис `postgres` в compose (опционально), docs/docker.md, прогон копии прод-БД через перенос.
- Аудит параллелизма менеджеров (26 тестов в карантине) — до включения `VC_DB_URL` в проде.

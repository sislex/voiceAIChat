---
title: pg-quarantine
date: 2026-09-08
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Карантин тестов на Postgres пройден

## Что сделано

- Сняты все `it.skipIf(ON_POSTGRES)` с тестов менеджеров (27 тестов в `turns`, `session`, `ci/cancel`, `ci/parallel`,
  `ci/runManager`, `ci/modelHooks`, `orchestration/runManager`, `releases/releaseManager`, `taskPreparation`); константа
  `ON_POSTGRES` в этих файлах удалена. Пометки на тестах сырого драйвера и файловых баз остаются по смыслу.
- Дефекты кода: замок по `taskId` в `ci/runManager.ts#startForDevelopmentTransition` (два одновременных перевода
  карточки создавали два рана); подписки WS-сессии на ленты перенесены до `await resumeQueues` в `session.ts`.
- Дефекты тестов: `setTimeout(0)`/`tick()` заменены на `turns.idle()` и `vi.waitFor` по состоянию; WS-тесты ждут
  `claude.active`; отмена в хуке модели — после старта клиента; таймаут KB-repair 300 мс; `sql.run` вместо `prepare`.
- Матрица: 9 файлов на Postgres — 333 passed / 18 skipped (легаси `describe.skip`); полная матрица сервера на
  Postgres и гейт на SQLite — см. итог ниже в плане.

## Что выяснили (факты, которых не было в KB)

- Из 23 падений карантина на Postgres два — настоящие гонки кода, остальное — тесты, считавшие `setTimeout(0)`
  моментом «база уже ответила». Признак: утверждение сразу после `await` события менеджера (onDone, cancel,
  статус в базе), а не после наблюдаемого следствия.
- `open` у WS-клиента приходит до того, как сервер проверил сессию в базе и подписал соединение на ленты;
  первый кадр `claude.active` — надёжный признак готовности сессии.
- `latestCiRunSummary` предпочитает активный ран; возврат карточки в прежнюю колонку и резюме в чат пишутся
  после финального статуса рана.

## Куда занесено

- docs/plans/db-postgres.md — «Долг после круга 2» закрыт с перечнем дефектов
- docs/kb/data-auth.md — тесты менеджеров идут на обоих движках
- docs/kb/conventions.md — правило синхронизации в тестах менеджеров

## Открытые вопросы / что осталось

- Включение `VC_DB_URL` в проде: перенос данных `copyToPostgres.cli.ts` и переключение compose-профиля `postgres`.

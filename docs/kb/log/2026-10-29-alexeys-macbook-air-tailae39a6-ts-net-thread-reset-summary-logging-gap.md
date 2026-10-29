---
title: thread-reset-summary-logging-gap
date: 2026-10-29
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# thread-reset-summary-logging-gap

## Что сделано

- Дополнена тема backend internals причиной прежнего отсутствия ошибок резюмирования в production-логах.

## Что выяснили (факты, которых не было в KB)

- Core создаёт Fastify с `logger: false`, поэтому прежний sink через `app.log.warn` ничего не выводил.
- `conversationSummary.ts` теперь пишет безопасное структурированное событие напрямую в stdout, в канал контейнерных логов рядом с `api_request_problem`.

## Куда занесено

- docs/kb/server-internals.md

## Открытые вопросы / что осталось

- Нет.

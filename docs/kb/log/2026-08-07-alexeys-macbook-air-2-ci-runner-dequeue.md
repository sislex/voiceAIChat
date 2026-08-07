---
title: ci-runner-dequeue
date: 2026-08-07
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# ci-runner-dequeue

## Что сделано

- Дополнена тема CI-раннера описанием ручного исключения ожидающего рана.

## Что выяснили (факты, которых не было в KB)

- `POST /api/ci/runs/:runId/dequeue` отменяет только ещё ожидающий ран, переносит карточку в `backlog` и сообщает фактический исход гонки с началом выполнения.

## Куда занесено

- docs/kb/features/ci-runner.md

## Открытые вопросы / что осталось

- Нет.

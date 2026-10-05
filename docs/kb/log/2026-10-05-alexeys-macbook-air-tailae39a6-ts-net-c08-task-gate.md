---
title: c08-task-gate
date: 2026-10-05
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# c08-task-gate

## Что сделано

- `npm run gate:task -- --base <sha>` ядра (dev-lane-v1 C08): проверка типов изменённых пакетов и только связанные тесты, бюджет 100 тестов / 60 с; правка корневых файлов не включает полный гейт; правка только документации — `kb:check`.
- Вывод по контракту плана: `GATE-TASK: tests=<n> seconds=<s>`, код 2 при превышении бюджета, затем `GATE-TASK-SLOW:` и файлы тестов, самые долгие первыми.

## Что выяснили (факты, которых не было в KB)

- Нет.

## Куда занесено

- docs/kb/testing-operations.md

## Открытые вопросы / что осталось

- Delivery Control вызывает `gate:task` (C06).

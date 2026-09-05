---
title: reliable-long-gates
date: 2026-09-04
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# reliable-long-gates

## Что сделано

- Сверен и зафиксирован штатный способ запуска долгих локальных гейтов с отдельными журналом и статусом.

## Что выяснили (факты, которых не было в KB)

- `npm run gate:fast:logged` отделяет worker и возвращает `runId` с путями артефактов; `npm run gate:status -- <runId>` повторно и без побочных эффектов классифицирует результат.
- Универсальный `node scripts/long-run.mjs start -- <command> [args...]` передаёт argv без shell-интерпретации, объединяет stdout/stderr в журнал и сохраняет настоящий exit code.

## Куда занесено

- `docs/kb/testing-operations.md`, раздел «Fast-stage затронутых тестов».

## Открытые вопросы / что осталось

- Нет.

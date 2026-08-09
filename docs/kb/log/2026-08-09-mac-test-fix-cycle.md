---
title: test-fix-cycle
date: 2026-08-09
machine: mac
author: alexeyrozhnov
---

# test-fix-cycle

## Что сделано

- Дополнена тема CI-раннера контрактом, схемой и границами реализации межстадийного fix cycle.
- Зафиксирована проектная настройка лимита и её owner-only HTTP-путь.

## Что выяснили (факты, которых не было в KB)

- Grouped pipeline и fix-cycle пока не подключены к конкретным DB/HTTP/WS/UI-адаптерам.
- Схема fix-cycle существует, но `VoiceChatDb` ещё не реализует store для новых таблиц; runtime-оркестрации и запуска fix-модели нет.

## Куда занесено

- `docs/kb/features/ci-runner.md`

## Открытые вопросы / что осталось

- Подключить DB-store, завершение grouped pipeline, model-run, точечные проверки, повтор полного pipeline, HTTP/WS и UI.

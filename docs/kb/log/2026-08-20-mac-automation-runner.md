---
title: automation-runner
date: 2026-08-20
machine: mac
author: alexeyrozhnov
---

# automation-runner

## Что сделано

- Дополнена тема CI-раннера устройством отдельного durable Automation Runner.
- Добавлены пути подсистемы в области свежести темы и перегенерирован индекс KB.

## Что выяснили (факты, которых не было в KB)

- Automation Protocol v1, Bearer API, SQLite WAL, идемпотентность, реплей событий, паузы, recovery и отмена уже реализованы.
- Compose запускает runner внутренним сервисом на 8800 с постоянным томом; production executor и серверный outbox/finalize пока не подключены.

## Куда занесено

- docs/kb/features/ci-runner.md

## Открытые вопросы / что осталось

- Подключить реальные MachineExecutionPort/LLM Runner адаптеры и серверный transactional outbox, reconciliation/realtime и финализацию.

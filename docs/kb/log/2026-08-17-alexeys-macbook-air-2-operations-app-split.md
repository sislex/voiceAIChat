---
title: operations-app-split
date: 2026-08-17
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# operations-app-split

## Что сделано

- Добавлена отдельная тема о публичной границе, store, lifecycle, маршрутах и текущем подключении `@voicechat/operations-app`.
- Уточнены темы UI, clients, protocol, machines и testing; корневая карта workspace дополнена новым пакетом.

## Что выяснили (факты, которых не было в KB)

- Реализован архитектурный каркас Operations, но host adapters и полноценные продуктовые surfaces в пакет пока не перенесены.
- Host использует публичный route parser и stylesheet; legacy Operations UI продолжает рендериться из `packages/ui`.
- Store уже разделяет controller generations, однако часть заявленного поведения Explorer, observer, CI subscriptions и host navigation ещё отсутствует.

## Куда занесено

- `docs/kb/operations-app.md`
- `docs/kb/ui.md`, `docs/kb/clients.md`, `docs/kb/protocol.md`, `docs/kb/machines.md`, `docs/kb/testing-operations.md`
- `AGENTS.md`

## Открытые вопросы / что осталось

- Следующие срезы должны подключить host adapters, заменить legacy surfaces и закрыть перечисленные в теме пробелы lifecycle и тестов.

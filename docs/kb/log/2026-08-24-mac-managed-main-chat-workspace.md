---
title: managed-main-chat-workspace
date: 2026-08-24
machine: mac
author: alexeyrozhnov
---

# managed-main-chat-workspace

## Что сделано

- Описаны новые контракты и persistence managed workspace разговора, reader/writer coordinator и отображение фактического состояния в UI.

## Что выяснили (факты, которых не было в KB)

- Git refresh общего main, ленивое повышение чата и manifest-guarded cleanup ещё не подключены к production turn/merge lifecycle.

## Куда занесено

- `docs/kb/machines.md`
- `docs/kb/features/merge-runner.md`

## Открытые вопросы / что осталось

- Подключить инфраструктурные контракты к production lifecycle отдельной реализацией.

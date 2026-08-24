---
title: browser-id-web-reader
date: 2026-08-24
machine: mac
author: alexeyrozhnov
---

# browser-id-web-reader

## Что сделано

- Зафиксирован общий browser-safe генератор идентификаторов и переведённые на него клиентские операции Web Reader, preview/MCP, Feature Preview, Kanban Assistant и Web Recorder.
- Уточнено покрытие standalone Web Recorder в affected-check и необходимость отдельного production build.

## Что выяснили (факты, которых не было в KB)

- `browserId()` синхронно выбирает native UUID, UUID из random bytes либо локальный fallback и не требует secure context.
- affected-check запускает typecheck/tests Web Recorder, но `frontend:build-gates` не собирает его production bundle.

## Куда занесено

- `docs/kb/ui.md`
- `docs/kb/testing-operations.md`

## Открытые вопросы / что осталось

- Нет.

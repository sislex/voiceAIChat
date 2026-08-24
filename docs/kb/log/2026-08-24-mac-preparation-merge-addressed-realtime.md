---
title: preparation-merge-addressed-realtime
date: 2026-08-24
machine: mac
author: alexeyrozhnov
---

# preparation-merge-addressed-realtime

## Что сделано

- Актуализированы темы Preparation, Merge, проектов и вкладок карточки после перехода с polling на адресные WS-инвалидации.

## Что выяснили (факты, которых не было в KB)

- Скрытые Preparation и Merge размонтируются и прекращают сетевую активность; повторное открытие делает новый одиночный REST-снимок.
- Merge-снимки обновляют историю через upsert, а изменения task repositories имеют собственное адресное WS-событие.
- Обычная мутация доски больше не инвалидирует preparation notifications.

## Куда занесено

- docs/kb/features/ci-runner.md
- docs/kb/features/merge-runner.md
- docs/kb/projects.md
- docs/kb/features/task-preparation.md

## Открытые вопросы / что осталось

- Нет.

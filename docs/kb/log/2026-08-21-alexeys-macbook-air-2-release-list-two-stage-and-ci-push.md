---
title: release-list-two-stage-and-ci-push
date: 2026-08-21
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# release-list-two-stage-and-ci-push

## Что сделано

- Зафиксирован двухэтапный контракт загрузки релизов и актуализирована диагностика публикации task-ветки.

## Что выяснили (факты, которых не было в KB)

- Список релизов содержит только облегчённые summary; полный релиз запрашивается после выбора строки с отдельными состояниями загрузки и ошибки.
- Системный push task-ветки сейчас обычный, а не force-with-lease; single-branch clone не создаёт tracking-ref task-ветки, поэтому ручной force-with-lease после fetch в FETCH_HEAD получает stale info.

## Куда занесено

- docs/kb/features/releases.md
- docs/kb/features/ci-runner.md

## Открытые вопросы / что осталось

- Нет.

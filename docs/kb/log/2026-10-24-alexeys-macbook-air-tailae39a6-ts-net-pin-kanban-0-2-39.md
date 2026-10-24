---
title: pin-kanban-0-2-39
date: 2026-10-24
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Закрепление Kanban 0.2.39

## Что сделано

- Kanban 0.2.39 (c675bf01) закреплён в `deploy/tools.lock.json`, `docker-compose.yml` и списке release-train в `deploy.md`.

## Что выяснили (факты, которых не было в KB)

- SK-74: после многорепозиторного merge Kanban отдавал один и тот же проект на любой `GET /api/projects/:id`, и Release Center не мог создать релиз. Owner-merge подменял методы в `Object.create(db.projects)`, а ловушка `set` порта писала подмену в общий репозиторий. Перезапуск не помогал: при старте `reconcile()` возобновляет висящий merge-ран.

## Куда занесено

- docs/kb/deploy.md (версия Kanban в release-train); причина и исправление — в KB Kanban (`db/repos/base.ts`).

## Открытые вопросы / что осталось

- Выкатить Core с Kanban 0.2.39 через Release Center после закрытия висящего merge-рана SK-68.

---
title: pin-kanban-0-2-13
date: 2026-10-07
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# pin-kanban-0-2-13

## Что сделано

- Закреплён Kanban 0.2.13 (`70370ce3`): `deploy/tools.lock.json`, `docker-compose.yml`, `docs/kb/deploy.md`.

## Что выяснили (факты, которых не было в KB)

- С 0.2.13 Kanban после деплоя прода удаляет неиспользуемые образы (кроме образов предыдущего
  выпуска) и старые резервные копии в `/var/backups/voicechat`, а диск прода проверяет раз в 30 минут
  с уведомлением проекта (ops-hygiene-v1 B02). Очистка впервые сработает на выпуске после 0.1.419:
  деплой 0.1.419 ведёт ещё прежний Kanban.

## Куда занесено

- docs/kb/deploy.md (закреплённая версия Kanban).

## Открытые вопросы / что осталось

-

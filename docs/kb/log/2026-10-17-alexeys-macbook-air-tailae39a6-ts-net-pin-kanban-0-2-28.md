---
title: pin-kanban-0-2-28
date: 2026-10-17
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# pin-kanban-0-2-28

## Что сделано

- Закреплён Kanban 0.2.28 (`140b167d9058acc388dcaf064580e1543daa3f0b`): `deploy/tools.lock.json` и образ в `docker-compose.yml` через `release-composition apply`.
- В выпуске: повтор упавшего системного шага «Отправить ветку задачи в origin» (sislexa-kanban #143) — `kanban_run_retry` оператора и автопилот теперь возобновляют ран с публикации ветки.

## Что выяснили (факты, которых не было в KB)

- Клон GitHub изредка падает `fetch-pack: unexpected disconnect while reading sideband packet` — повтор клонирования проходит.

## Куда занесено

- docs/kb/deploy.md

## Открытые вопросы / что осталось

- Релиз Core и деплой прода.

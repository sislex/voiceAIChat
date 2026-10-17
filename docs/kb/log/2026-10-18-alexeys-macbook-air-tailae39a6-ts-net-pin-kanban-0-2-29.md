---
title: pin-kanban-0-2-29
date: 2026-10-18
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# pin-kanban-0-2-29

## Что сделано

- Закреплён Kanban 0.2.29 (`22c7301c`): инструменты Delivery Control для ассистента доски
  (`kanban_external_task_get`, `kanban_external_attempt_log`, `kanban_external_task_retry`,
  прогон assistant-delivery-control-v1 B02) и повтор упавшего системного шага пуша ветки (#143).

## Что выяснили (факты, которых не было в KB)

- Полный клон больших репозиториев (Desktop, voiceAIChat) с GitHub 2026-10-17/18 рвался
  `fetch-pack: unexpected disconnect`; публикационный клон собирали из локальных объектов
  существующего чекаута и докачивали разницу — инкрементальный fetch проходил.

## Куда занесено

- deploy/tools.lock.json, docker-compose.yml; docs/kb/deploy.md (проверено).

## Открытые вопросы / что осталось

- Учётка ассистента для координатора (`delivery-control-assistant.token`) кладётся оператором.

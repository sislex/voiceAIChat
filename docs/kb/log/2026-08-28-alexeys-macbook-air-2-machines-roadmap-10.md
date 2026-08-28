---
title: machines-roadmap-10
date: 2026-08-28
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# machines-roadmap-10 — политика команд проекта и роли

## Что сделано

- `@shared/commandPolicy` (слои, опасные команды), `projects.command_policy`, ролевые правила в app_config, `commandGate` для консоли и MCP `bash` (+параметр `confirm`).
- UI: fieldset в настройках проекта, «Команды по ролям» в админке.
- Стенд: `docker ps` с projectId → 403 «политикой проекта»; `shutdown` у developer → 403 «политикой роли»; мусорные паттерны отбрасываются парсером.

## Что выяснили

- Роль `developer` не может создавать проекты (`project:settings`) — проекты для проверок заводим админом.

## Куда занесено

- docs/kb/machines.md — «Политика команд → Слои поверх политики машины».

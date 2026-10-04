---
title: pin-kanban-0-2-4
date: 2026-10-04
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# pin-kanban-0-2-4

## Что сделано

- Закреплён Kanban 0.2.4 (`3403c985`): подготовка запрашивает VPN-доступ окружения до создания связей, удаление его снимает.

## Что выяснили (факты, которых не было в KB)

- U04: окружение u04-check поднялось, но все связи шли через туннель агента — Kanban не запрашивал machines.ensureEnvironmentGrant (sislex/sislexa-kanban#34).

## Куда занесено

- docs/kb/deploy.md — закреплённая версия Kanban.

## Открытые вопросы / что осталось

- Продолжение U04 на окружении `u04-check`.

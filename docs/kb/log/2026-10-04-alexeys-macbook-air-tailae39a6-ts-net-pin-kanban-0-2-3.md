---
title: pin-kanban-0-2-3
date: 2026-10-04
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# pin-kanban-0-2-3

## Что сделано

- Закреплён Kanban 0.2.3 (`a6ab42f2`): связи к одной службе сервера публикуются одним портом (две и больше реплик модуля).

## Что выяснили (факты, которых не было в KB)

- U04: при двух копиях Make основная машина публиковала voicechat:8787 и postgres:5432 дважды, этап config падал с duplicate link port (sislex/sislexa-kanban#33).

## Куда занесено

- docs/kb/deploy.md — закреплённая версия Kanban.

## Открытые вопросы / что осталось

- Продолжение U04 на окружении `u04-check`.

---
title: kanban-stand-cache-prune
date: 2026-10-07
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# kanban-stand-cache-prune

## Что сделано

- `scripts/kanban-stand-prepare.mjs` после каждой подготовки стенда удаляет чекауты Kanban сверх
  `VC_E2E_KANBAN_CACHE_KEEP` (по умолчанию 3) последних по использованию; при попадании в кэш
  обновляется время маркера `.sislexa-e2e-ready`.

## Что выяснили (факты, которых не было в KB)

- Кэш `~/.cache/sislexa/kanban` не чистился: на M1 накопилось 14 чекаутов по ~300 МБ (4,1 ГБ),
  на этом Маке 5,1 ГБ — по одному на каждую сборку Kanban за 3–6 октября.

## Куда занесено

- docs/kb/testing-operations.md (e2e-стенд «ядро + канбан»).

## Открытые вопросы / что осталось

- Тёплый кэш зависимостей воркеров Delivery Control ограничивается отдельно, в репозитории delivery-control.

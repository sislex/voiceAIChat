---
title: pin-agent-0-23-0
date: 2026-10-06
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# pin-agent-0-23-0

## Что сделано

- Закреплены агент 0.23.0 и контракты агента 1.3.0 (RPC devProcess для дев-стендов, dev-lane-v1 C01).

## Что выяснили (факты, которых не было в KB)

- Контракты 1.3.0 включают ответы devProcess в союз сообщений агента; в registry.ts их отделяет type guard, иначе ветка exec теряет execId.

## Куда занесено

- docs/kb/deploy.md

## Открытые вопросы / что осталось

- Архив shared 0.1.25 под контракты 1.3.0, затем Core UI 1.5.5 и Desktop 1.0.24.

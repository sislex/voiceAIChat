---
title: dev-gateway-internal-route
date: 2026-10-18
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# dev-gateway-internal-route

## Что сделано

- Шлюз стенда направляет `/internal` в Core; готовность Kanban в реестре — `/v1/health`.

## Что выяснили (факты, которых не было в KB)

- При Core UI из dev запросы `/internal/kanban/core` через шлюз уходили в Vite (404).

## Куда занесено

- docs/kb/deploy.md.

## Открытые вопросы / что осталось

- Нет.

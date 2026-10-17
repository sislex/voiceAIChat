---
title: stand-runner-profile-dev-core
date: 2026-10-18
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# stand-runner-profile-dev-core

## Что сделано

- Локальные LLM runner стенда под профилем `local-runner`; `environment_stand.py` включает его, если внешний раннер не задан.
- `dev:component` Core не затирает переданные адреса и режимы, принимает `PORT`.
- Shared: настройки окружения для внешнего раннера и адресов MCP (`ENVIRONMENT_URL_SETTINGS`).

## Что выяснили (факты, которых не было в KB)

- Подменить Core на стенде было нельзя: все адреса сервисов уходили в шлюз, который при подменённом Core вёл обратно в него же.

## Куда занесено

- docs/kb/deploy.md.

## Открытые вопросы / что осталось

- Kanban передаёт настройки и выполняет подмену контейнера (sislexa-kanban `devSwap.ts`).

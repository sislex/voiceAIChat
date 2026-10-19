---
title: pin-shared-0-1-40
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# pin-shared-0-1-40

## Что сделано

- Выпущены и закреплены Shared 0.1.40 и component-runtime 1.3.0 из `5a097e76` (B17: RPC и MCP общих сервисов), архивы в релизе `vendor`.

## Что выяснили (факты, которых не было в KB)

- `contracts-release.mjs` записывает в `repository` адрес origin исходной копии; при упаковке из локального клона его нужно вернуть на `https://github.com/sislex/voiceAIChat` в `dependency-snapshots.json` и `vendor/owner-artifacts.json`.

## Куда занесено

- docs/kb/shared.md

## Открытые вопросы / что осталось

- Закрепить 0.1.40 / 1.3.0 в Make, Image Studio, Web Reader, Playwright Reader, Kanban и Identity.

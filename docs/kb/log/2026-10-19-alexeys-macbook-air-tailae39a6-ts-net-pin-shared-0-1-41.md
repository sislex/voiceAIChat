---
title: pin-shared-0-1-41
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# pin-shared-0-1-41

## Что сделано

- Выпущены Shared 0.1.41 и component-runtime 1.4.0 из `ce8eaefd` (B21: MCP-токен хода как основание для RPC общего сервиса, методы Web Reader, scope источников задач), архивы в релизе `vendor`; в Core закреплён Shared 0.1.41.

## Что выяснили (факты, которых не было в KB)

- `contracts-release.mjs @voicechat/shared` переписывает workspace-зависимости Core (`apps/server`, `packages/component-runtime`, `packages/knowledge`, `apps/automation-runner`) и lock на URL архива; для закрепления в Core оставляются только `dependency-snapshots.json` и `vendor/owner-artifacts.json`, остальное откатывается.

## Куда занесено

- docs/kb/shared.md

## Открытые вопросы / что осталось

- Закрепить 0.1.41 / 1.4.0 в Make, Image Studio, Web Reader (B22–B24) и Kanban.

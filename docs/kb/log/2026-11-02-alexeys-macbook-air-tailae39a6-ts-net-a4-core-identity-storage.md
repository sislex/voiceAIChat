---
title: a4-core-identity-storage
date: 2026-11-02
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# a4-core-identity-storage

## Что сделано

- A4 (SISL-838) влит в dev вручную: патч воркера застрял в acceptance_pending. Сверены темы, которые задела правка `server.ts`, `ws.ts` и `protocol.ts`.

## Что выяснили (факты, которых не было в KB)

- В режиме Identity квотами владеет Storage: `GET /api/admin/storage` отдаёт `storageAdminUrl`, а PATCH квоты в Core возвращает 409.

## Куда занесено

- docs/kb/protocol.md (Admin storage quota contract); подробности — docs/kb/data-auth.md (Identity OAuth mode).

## Открытые вопросы / что осталось

-

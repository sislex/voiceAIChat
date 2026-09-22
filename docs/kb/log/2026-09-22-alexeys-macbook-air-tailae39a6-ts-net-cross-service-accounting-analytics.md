---
title: cross-service-accounting-analytics
date: 2026-09-22
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# cross-service-accounting-analytics

## Что сделано

- Pinned SDK 1.2.0, Billing 1.2.0, Identity 1.3.2, and Analytics 1.2.0 owner archives.
- Applied Billing accounting to every stored conversation origin and added authenticated Analytics report/activity proxies.
- Added Analytics to the application catalog, installer, release owner map, Compose definitions, and provider-owned grant examples.

## Что выяснили (факты, которых не было в KB)

- Conversation capabilities are the authoritative source for usage origin; request payloads cannot override attribution.
- Analytics accepts the verified user credential through Core while its private Identity/Billing dependencies retain separate component grants.

## Куда занесено

- `docs/kb/data-auth.md`
- `docs/kb/deploy.md`
- `docs/plans/sislexa-modular-platform.md`

## Открытые вопросы / что осталось

- Merge and release the Core integration, then install Analytics and connect the independently released account UI in production.

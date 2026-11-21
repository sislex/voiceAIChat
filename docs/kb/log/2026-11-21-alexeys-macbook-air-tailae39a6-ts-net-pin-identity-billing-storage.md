---
title: pin-identity-billing-storage
date: 2026-11-21
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# pin-identity-billing-storage

## Что сделано

- Закреплены Identity 1.6.2 и Billing 1.2.6 (архивы, `vendor/owner-artifacts.json`, `deploy/tools.lock.json`, образы в compose, `deploy/s3-provider-artifacts.json`, `requiredSources` в `scripts/a07-composition.mjs`).
- Минимальная сборка (`deploy/public`) берёт опубликованные образы Identity, Billing и хранилища 0.1.1 (`ghcr.io/sislex/storage`); сборка хранилища из рабочей копии перенесена в `compose.from-dev.yml`.

## Что выяснили (факты, которых не было в KB)

- Поезд выпусков не выпускает Identity и Billing (они встроены архивами); порядок ручного выпуска записан в `deploy.md`.

## Куда занесено

- docs/kb/deploy.md

## Открытые вопросы / что осталось

-

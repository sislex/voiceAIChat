---
title: pin-shared-0-1-39
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# pin-shared-0-1-39

## Что сделано

- Выпущены Shared 0.1.39 и component-runtime 1.2.0 из коммита `de3dd79e` (B02, делегирование ядра при погашении тикета) и загружены в релиз `vendor`; в Core закреплён Shared 0.1.39.

## Что выяснили (факты, которых не было в KB)

- Версия рабочей области component-runtime в Core остаётся 1.0.1 из-за точного пира Billing; 1.2.0 поднимается только в упакованном архиве.

## Куда занесено

- docs/kb/shared.md, dependency-snapshots.json, vendor/owner-artifacts.json.

## Открытые вопросы / что осталось

- Сервисы (Make, Kanban, Identity, Web Reader, Playwright Reader, Image Studio) переходят на 0.1.39 / 1.2.0 в своих задачах этапа 1.

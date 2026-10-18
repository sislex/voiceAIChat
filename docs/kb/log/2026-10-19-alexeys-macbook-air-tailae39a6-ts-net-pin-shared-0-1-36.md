---
title: pin-shared-0-1-36
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# pin-shared-0-1-36

## Что сделано

- Выпущен и закреплён Shared 0.1.36 из коммита deployment-profiles-v1 B01 (`8d264735`): контракты профилей сборки.

## Что выяснили (факты, которых не было в KB)

- `contracts-release` для Core теперь переписывает ссылки `@voicechat/shared` в `package.json` рабочих областей на архив
  `vendor` и ломает lock: сервер получает вторую копию Shared (4 интеграционных теста Reader отвечают 500). Пин Core —
  только `dependency-snapshots.json` и `vendor/owner-artifacts.json`, как у прошлых выпусков.
- Режим потребителей `contracts-release` не понимает манифесты сервисов-владельцев (`packages` словарём, у Core UI — списком).
- Billing 1.2.2 требует component-runtime ровно 1.0.1, поэтому версию рабочей области component-runtime в Core поднять нельзя.

## Куда занесено

- dependency-snapshots.json, vendor/owner-artifacts.json; docs/kb/shared.md.

## Открытые вопросы / что осталось

- Починить режим Core и потребителей в `scripts/contracts-release.mjs`; ослабить peer Billing на component-runtime.

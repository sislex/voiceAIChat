---
title: web-reader-1-3-5-pin
date: 2026-10-30
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# web-reader-1-3-5-pin

## Что сделано

- Закреплены npm-архивы Web Reader 1.3.5 (`@sislexa/web-reader` 1.3.5, `@voicechat/web-reader-contracts` 1.3.0 из коммита 93f6b348) в package.json, lock-файле, vendor/owner-artifacts.json и dependency-snapshots.json.
- Сверены темы, чьи areas затронуты только закреплением образа (поезд 32212279) и npm-архивов.

## Что выяснили (факты, которых не было в KB)

- `release-train --apps web-reader` закрепляет в Core только образ сервиса (compose, deploy/tools.lock.json). npm-архивы Web Reader, из которых Core берёт `PreviewActionRelay`, нужно закреплять отдельно.

## Куда занесено

- docs/kb/log (эта запись)

## Открытые вопросы / что осталось

- Научить поезд закреплять и npm-архивы владельца вместе с образом.

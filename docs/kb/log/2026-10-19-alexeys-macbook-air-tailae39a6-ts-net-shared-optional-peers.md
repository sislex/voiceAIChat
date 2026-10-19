---
title: shared-optional-peers
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# shared-optional-peers

## Что сделано

- `scripts/core-contracts-release.mjs` помечает все пиры Shared (контракты приложений, Identity, SDK, Voice,
  agent-contracts) как `peerDependenciesMeta.optional`.

## Что выяснили (факты, которых не было в KB)

- Shared 0.1.36 требовал девять пакетов Core как обязательные пиры; в сервисах их нет и в публичном npm тоже,
  поэтому `npm install` у Make/Identity/Web Reader/Playwright Reader/Image Studio падал E404/ERESOLVE — сервисы
  застряли на Shared 0.1.1–0.1.10.

## Куда занесено

- docs/kb/shared.md (проверено).

## Открытые вопросы / что осталось

- Выпуск Shared 0.1.37 с необязательными пирами и пины в сервисах.

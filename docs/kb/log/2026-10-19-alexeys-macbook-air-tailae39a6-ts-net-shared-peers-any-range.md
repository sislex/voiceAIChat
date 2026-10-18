---
title: shared-peers-any-range
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# shared-peers-any-range

## Что сделано

- Пакер Shared публикует Core-side peers как необязательные с диапазоном `"*"`; точные версии Core — в `release-source.json` (`corePeers`).

## Что выяснили (факты, которых не было в KB)

- Одной пометки optional мало: у сервисов свои версии make/browser/image-studio contracts, и npm всё равно пытался взять точную версию peer из публичного реестра (E404).

## Куда занесено

- docs/kb/shared.md

## Открытые вопросы / что осталось

- Identity `packages/contracts` зависит от Shared точно 0.1.3.

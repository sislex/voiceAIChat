---
title: ipc-paged-history
date: 2026-10-05
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# ipc-paged-history

## Что сделано

- IPC-канал `conversations:get` принимает необязательные `limit` и `before` (история порциями, reliability-v2 B01).

## Что выяснили (факты, которых не было в KB)

- Core UI получает разговор через IPC-контракт `RendererApi`, а не через `REST.conversation`. Расширение REST без IPC клиенту недоступно: C01 упала на этом.

## Куда занесено

- docs/kb/protocol.md

## Открытые вопросы / что осталось

- Архив shared 0.1.21 и повтор C01.

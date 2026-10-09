---
title: make-stand-offline-machines
date: 2026-10-09
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# make-stand-offline-machines

## Что сделано

- `makeStand options` запрашивает детали стендов параллельно и только на машинах в сети; стенды
  offline-машин берутся из списка со статусом `stopped`. Поиск рабочей копии для `files`/`git`
  пропускает offline-машины.

## Что выяснили (факты, которых не было в KB)

- Kanban держит `GET /dev-stands/:standId` стенда на offline-машине около 30 с, а Make обрывает
  RPC к ядру через 15 с и отвечает 503 «Component dependency unavailable: core». На проде 0.1.428
  так ломался выбор стенда в Make, пока M1 со стендом `dev-86c476d9-38a` не в сети.

## Куда занесено

- docs/kb/server-internals.md#make-conversation-stand-worktrees

## Открытые вопросы / что осталось

- Kanban мог бы отвечать по offline-машине сразу, не дожидаясь агента.

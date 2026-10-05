---
title: b01-paged-history
date: 2026-10-05
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# b01-paged-history

## Что сделано

- История разговора порциями (reliability-v2 B01): `GET /api/conversations/:id?limit=N&before=<id>` отдаёт последние `N` сообщений старше курсора в хронологическом порядке и `history: { hasMore, oldestId, total }`. Без `limit` ответ прежний.
- Выборка идёт по индексу `idx_messages_history_page (conversation_id, state, history_position, id)` ключами, строки без позиции читаются отдельной веткой с той же сортировкой NULL, что у полной истории (SQLite и Postgres).
- Неизвестный курсор — 400 `invalid_history_cursor`, неверный `limit` — 400 `invalid_history_query`.

## Что выяснили (факты, которых не было в KB)

- SQLite ставит сообщения без позиции первыми, Postgres — последними; постраничное чтение повторяет порядок каждого движка.

## Куда занесено

- docs/kb/protocol.md

## Открытые вопросы / что осталось

- Клиент Core UI (reliability-v2 C01) после закрепления архива shared.

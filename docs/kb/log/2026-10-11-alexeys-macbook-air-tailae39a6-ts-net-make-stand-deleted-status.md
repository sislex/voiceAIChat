---
title: make-stand-deleted-status
date: 2026-10-11
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# make-stand-deleted-status

## Что сделано

- `makeBridge/projectAdapters.ts`: на 404 от Kanban статус `creating` только пока задача `create` ещё
  выполняется; `create` со статусом `succeeded` + 404 = стенд удалён → `stand_not_found`. `detach` на 404
  возвращает `idle`, чтобы сервис Make снял привязку беседы. Тесты в `makeStand.test.ts`.

## Что выяснили (факты, которых не было в KB)

- Правка B03 (make-stand-stories-v2) считала удалённый стенд «создающимся» из-за старой успешной задачи
  `create`; у беседы Make оставалась привязка к удалённому стенду, селектор стенда был заблокирован,
  а новый `create` отклонялся сервисом Make с 409 (виделось как `operation_conflict`).
- Id стенда Kanban — не UUID (`dev-5b9d0ce6-61b`); фраза «три UUID» в теме была устаревшей.

## Куда занесено

- docs/kb/server-internals.md — раздел «Make ↔ ядро».

## Открытые вопросы / что осталось

- Сервис Make при ошибке `stand_not_found` в `status` привязку не снимает — нужен явный `detach`.

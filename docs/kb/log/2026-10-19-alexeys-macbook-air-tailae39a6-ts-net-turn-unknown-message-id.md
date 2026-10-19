---
title: turn-unknown-message-id
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# turn-unknown-message-id

## Что сделано

- `claude.send` с `messageId`, которого нет среди сообщений этого разговора, теперь отклоняется ошибкой
  `message_not_found` до запуска модели и до очереди (`db.chat.hasMessage`, проверка в `turns.ts`).

## Что выяснили (факты, которых не было в KB)

- Приёмка deployment-profiles (сборка A в Docker, 2026-10-19): ход с выдуманным `messageId` доходил до модели,
  а при ошибке модели вставка в `conversation_turn_queue` падала на внешнем ключе вне запроса — процесс ядра
  завершался и контейнер перезапускался. Любой вошедший пользователь мог так остановить ядро.

## Куда занесено

- docs/kb/server-internals.md — раздел об очереди разговора.

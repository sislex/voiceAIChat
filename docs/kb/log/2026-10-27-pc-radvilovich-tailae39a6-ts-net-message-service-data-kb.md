---
title: message-service-data-kb
date: 2026-10-27
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# message-service-data-kb

## Что сделано

Проверена и актуализирована документация хранения служебных данных ответов относительно текущего кода; обновлена свежесть тем и индекс KB.

## Что выяснили (факты, которых не было в KB)

`ChatRepo` транзакционно отделяет `activity` и `request` от лёгкой метаинформации сообщения. Фоновый перенос обрабатывает до 50 старых строк за транзакцию с паузой 100 мс, а до переноса точечное чтение использует fallback из legacy `messages.meta`. История исключает диагностику на уровне SQL; новые запросы хранят `messageCount` и `lastMessageId` вместо копии переписки.

## Куда занесено

- `docs/kb/server-internals.md`, раздел `Chat message service data`
- `docs/kb/protocol.md`, контракт выдачи служебных данных

## Открытые вопросы / что осталось

Нет.

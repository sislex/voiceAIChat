---
title: pending-submit-realtime-confirmation
date: 2026-08-31
machine: macbook-air-user
author: NikolayTola
---

# pending-submit-realtime-confirmation

## Что сделано

- Уточнён жизненный цикл pendingSubmit: синхронная блокировка дубля, раннее realtime-подтверждение и защита асинхронных продолжений по operationId.

## Что выяснили (факты, которых не было в KB)

- chat.message до HTTP подтверждает пользовательскую реплику по conversationId, роли u1 и полному тексту; claude.queue — по разговору, тексту, позиции и упорядоченным attachment id.
- После подтверждения композер сразу принимает следующую реплику; ошибка или отмена возвращает исходный черновик только при пустом текущем поле.

## Куда занесено

- docs/kb/ui.md

## Открытые вопросы / что осталось

- Нет.

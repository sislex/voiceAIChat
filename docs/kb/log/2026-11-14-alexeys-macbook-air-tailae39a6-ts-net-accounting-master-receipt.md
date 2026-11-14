---
title: accounting-master-receipt
date: 2026-11-14
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# accounting-master-receipt

## Что сделано

- Учёт Core не закрывал расход, когда Core ходит в раннер мастер-токеном: раннер помечает квитанцию владельцем `master`, а Core принимал только `core`. На стенде так зависли 539 записей в состоянии `dispatching`.
- Core принимает квитанции с владельцем `core` и `master`; любой другой владелец по-прежнему `execution_receipt_mismatch`.
- Добавлен тест в `billing/chatAccounting.test.ts`, обновлена тема `llm.md`.

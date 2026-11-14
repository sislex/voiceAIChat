---
title: accounting-receipt-owner
date: 2026-11-14
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# accounting-receipt-owner

## Что сделано

- Прод-Core ходит в раннер сервисным токеном приложения `chat-production`: раннер помечает квитанцию этим именем, а Core требовал `core`. Поэтому на проде учёт не закрывался (1722 записи).
- Проверка квитанции больше не сравнивает владельца с фиксированным именем: раннер отдаёт квитанцию только тому, кто запускал ход. Остальные поля контекста сверяются как раньше.
- Тест `billing/chatAccounting.test.ts` и тема `llm.md` обновлены.

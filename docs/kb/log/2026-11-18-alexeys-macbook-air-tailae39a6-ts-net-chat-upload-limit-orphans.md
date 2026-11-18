---
title: chat-upload-limit-orphans
date: 2026-11-18
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# chat-upload-limit-orphans

## Что сделано

- Превышение размера вложения чата отвечает 413 `file_too_large` с `limitBytes` во всех путях (`uploadTooLarge`); удалённый адаптер хранилища пробрасывает ошибку источника потока, а не `storage_unavailable`.
- В системную часть ходов без инструментов добавлена подсказка `TOOL_FREE_TURN_HINT` (кроме Make).
- Административная операция `POST /api/admin/storage/orphan-chat-spaces` (сухой прогон по умолчанию) убирает пространства бесед, которых больше нет.

## Что выяснили (факты, которых не было в KB)

- Лимит вложения чата — 32 МБ (`MAX_CHAT_UPLOAD_BYTES`), а 64 МБ у `POST /api/uploads` — это лимит тела под base64. Вложения 48 и 60 МБ получали 503 `storage_unavailable`: ограничитель рвал поток внутри отправки в сервис хранения, и fetch падал без ответа. Сам сервис принимает одиночный PUT 60 МБ за 0,17 с.
- Без подсказки Haiku в ходе без инструментов отвечал выдуманным вызовом `<invoke:Bash …>`.

## Куда занесено

- docs/kb/server-internals.md

## Открытые вопросы / что осталось

- Поднимать ли лимит вложения чата выше 32 МБ — решение владельца.

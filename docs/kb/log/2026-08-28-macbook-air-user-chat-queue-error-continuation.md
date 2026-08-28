---
title: chat-queue-error-continuation
date: 2026-08-28
machine: macbook-air-user
author: NikolayTola
---

# chat-queue-error-continuation

## Что сделано

- Сверена серверная обработка ошибки активного LLM-хода и актуализированы темы очереди и VoiceBar.

## Что выяснили (факты, которых не было в KB)

- Ошибочный элемент сохраняется как `failed`, слот освобождается, а следующий `queued`-элемент запускается автоматически в FIFO-порядке; `failed` повторно не выбирается.

## Куда занесено

- `docs/kb/server-internals.md`
- `docs/kb/ui.md`

## Открытые вопросы / что осталось

- Нет.

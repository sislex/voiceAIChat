---
title: b01-thread-context-reset
date: 2026-10-08
machine: pc-radvilovich-tailae39a6-ts-net
author: unknown
---

# b01-thread-context-reset

## Что сделано

- Добавлен снимок заполнения контекста текущего LLM-потока и owner-only REST-сброс потока разговора.
- Сброс очищает provider session и usage, оставляет заметку и переводит следующий ход на bounded cold start с резюме.

## Что выяснили (факты, которых не было в KB)

- Codex thread totals кумулятивны; заполнение окна можно брать только из `last_token_usage.input_tokens`.
- Для неизвестной модели общий контракт использует консервативное окно 128k.

## Куда занесено

- docs/kb/protocol.md
- docs/kb/server-internals.md

## Открытые вопросы / что осталось

- Нет.

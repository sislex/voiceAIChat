---
title: chat-settings-llm
date: 2026-09-10
machine: macbook-air-user
author: NikolayTola
---

# chat-settings-llm

## Что сделано

- Актуализированы маршруты настроек разговора и описание LLM-переопределений чата.

## Что выяснили (факты, которых не было в KB)

- Вкладки «Общие» и «Контекст» имеют канонические маршруты `#/chat/:id/settings/general` и `#/chat/:id/settings/context`; legacy `#/chat/:id/context` заменяется новым адресом.
- Сброс LLM-переопределения сохраняет `null` во всех трёх полях разговора и возвращает динамическое наследование.

## Куда занесено

- `docs/kb/ui.md`
- `docs/kb/llm.md`

## Открытые вопросы / что осталось

- Нет.

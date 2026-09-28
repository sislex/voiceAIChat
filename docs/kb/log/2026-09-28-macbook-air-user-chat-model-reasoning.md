---
title: chat-model-reasoning
date: 2026-09-28
machine: macbook-air-user
author: NikolayTola
---

# chat-model-reasoning

## Что сделано

- Добавлены контракт, хранение и снимок следующего хода для reasoning effort и deep thinking.
- Удалена пользовательская REST-точка AI-помощника.
- Добавлена чистая проекция меню моделей с фильтрацией llm:access.

## Что выяснили (факты, которых не было в KB)

- Актуальный CODEX_MODELS содержит пять моделей и начинается с gpt-6-astra.
- Legacy-разговоры получают medium/false через миграционные defaults.

## Куда занесено

- docs/kb/llm.md
- docs/kb/usage/user-account.md

## Открытые вопросы / что осталось

- Визуальный VoiceBar принадлежит отдельному source-репозиторию sislexa-core-ui; Core хранит только pinned owner-артефакт.

---
title: kb-auto-context-lexical
date: 2026-11-18
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# kb-auto-context-lexical

## Что сделано

- Автоподстановка контекста базы знаний перед ходом (`buildKbAutoContext`: чат и CI-раны) ищет только лексически: во `KbView` добавлен признак `lexicalOnly`, `FileKnowledgeBaseService.search` и `ScopedKnowledgeBase.search` при нём не вызывают LLM-reranker.
- Явный поиск инструментом `kb:search` по-прежнему ранжируется моделью.

## Что выяснили (факты, которых не было в KB)

- На проде ход Workspace с Haiku занимал 9–12 с при 1 с у модели: 4,4–5,3 с уходило в Core до события `claude.start` — на вызов модели (Codex) для ранжирования базы знаний.
- По `kb_usage_queries` автопоиск до 2026-11-06 занимал около 0,25 с, после — 3,5–5 с на каждом ходе; доля ходов с подставленным контекстом после этого упала (26 из 232 за неделю).

## Куда занесено

- docs/kb/server-internals.md

## Открытые вопросы / что осталось

- Почему до 2026-11-06 reranker почти не вызывался, не выяснено.

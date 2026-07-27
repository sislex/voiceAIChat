---
title: project-knowledge-base
date: 2026-07-27
machine: repo-2
author: alexeyrozhnov
---

# project-knowledge-base

## Что сделано

- Добавлены карточки фич, exact/BM25-поиск, выборочный CLI-reranking, REST и read-only UI.
- Добавлен контекст `auto/manual/off`, подготовка индекса и параллельный Docker-стек.

## Что выяснили (факты, которых не было в KB)

- Текущий Anthropic gateway не поддерживает embeddings; Claude/Codex CLI дают только текст.
- Семантическое уточнение безопасно делать по ограниченному списку chunk ID с fallback на BM25.

## Куда занесено

- docs/kb/features/project-knowledge-base.md
- AGENTS.md

## Открытые вопросы / что осталось

- Настоящий vector search можно добавить отдельным совместимым provider позднее.

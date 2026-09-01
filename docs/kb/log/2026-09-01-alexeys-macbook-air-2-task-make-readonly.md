---
title: task-make-readonly
date: 2026-09-01
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# task-make-readonly

## Что сделано

- Дополнена тема проектов фактическим контрактом read-only Make-источников task-run.

## Что выяснили (факты, которых не было в KB)

- Все актуальные Make-связи задачи группируются по conversationId и передаются task-chat и CI как независимые именованные MCP-источники.
- Краткоживущий scope перепроверяется на каждом запросе и публикует только list/read; path задаёт стартовую точку, а не границу доступа к файлам.

## Куда занесено

- docs/kb/projects.md

## Открытые вопросы / что осталось

- Нет.

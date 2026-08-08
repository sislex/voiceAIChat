---
title: widget-tool-gateway
date: 2026-08-08
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# widget-tool-gateway

## Что сделано

- Добавлен общий контракт `describe/query/get/action` и закрытый серверный канбан-адаптер.
- Канбан-ассистент переведён на UI-first query и подтверждённый versioned action.
- Добавлены unit, REST integration, component и UI-store тесты.

## Что выяснили (факты, которых не было в KB)

- До этой задачи контекст содержал колонки и открытую карточку, но не семантический список всех карточек; серверного widget gateway не было.
- Живой `board.update` уже является каноническим способом заменить снимок активной доски после серверной мутации.

## Куда занесено

- `docs/kb/projects.md#универсальный-ассистент-виджета`

## Открытые вопросы / что осталось

- Нет.

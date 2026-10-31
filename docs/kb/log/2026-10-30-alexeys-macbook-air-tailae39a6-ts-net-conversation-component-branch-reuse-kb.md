---
title: conversation-component-branch-reuse-kb
date: 2026-10-30
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# conversation-component-branch-reuse-kb

## Что сделано

- Сверена реализация component attach с merge SHA и дополнено описание Make-worktree.

## Что выяснили (факты, которых не было в KB)

- Компонент получает отдельный путь worktree, но тот же default branch беседы `make/conversation-<id8>`; существующая local/origin ветка сохраняет историю.
- Если ветка уже занята другим worktree, attach возвращает его абсолютный путь и не запускает live mode.

## Куда занесено

- `docs/kb/server-internals.md`, раздел Make conversation stand worktrees.

## Открытые вопросы / что осталось

- Нет.

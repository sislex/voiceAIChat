---
title: make-stand-host-worktree
date: 2026-10-10
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# make-stand-host-worktree

## Что сделано

- Рабочая копия беседы Make теперь в `reposRoot` машины проекта-хозяина стенда: клон компонента
  `<reposRoot>/<репозиторий>` и worktree `<reposRoot>/make-worktrees/<беседа>`.

## Что выяснили (факты, которых не было в KB)

- Kanban принимает живую рабочую копию и её git common dir только внутри `path` или `reposRoot` машины
  проекта-хозяина стенда. Путь `<projectWorkdir>/../make-worktrees` из плана make-stand-v1 в эти корни не
  попадал, а у беседы в другом проекте (sislexa-core-ui) корни вообще другие: живой режим отвечал
  `invalid_request`, Make показывал `operation_conflict`.

## Куда занесено

- docs/kb/server-internals.md#make-conversation-stand-worktrees

## Открытые вопросы / что осталось

- Старая рабочая копия беседы «Проект 35» в `d1bcb83a…/make-worktrees` остаётся — удалить вручную.

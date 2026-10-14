---
title: stand-error-codes
date: 2026-10-14
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# stand-error-codes

## Что сделано

- release-reliability-v1 B07: точные коды ошибок стенда вместо общих. `sync-dev`: таймаут агента — 504
  `stand_agent_timeout` (проверка `timedOut` до разбора вывода), обрыв агента — 409 `machine_unavailable`, грязное дерево —
  409 `stand_worktree_dirty` (проверка `git status` до fetch/merge), сбой fetch — `stand_fetch_failed`, таймаут git —
  504 `stand_git_timeout`.
- Маршруты компонентов сохраняют статус и код ошибок прокси стенда; машина не в сети — 409 `machine_offline`, все порты
  заняты — 409 `storybook_no_free_port`; упавшая сессия Storybook получает `errorCode`.
- Коды перечислены в Shared: `STAND_ERROR_CODES`, `PROJECT_STORYBOOK_ERROR_CODES`.

## Что выяснили (факты, которых не было в KB)

- Неразрешённые записи прошлого синка (`UU` и т. п.) не считаются грязным деревом: синк по-прежнему возвращает конфликты.

## Куда занесено

- docs/kb/server-internals.md — «Stand delivery to dev» и раздел Make ↔ ядро (Storybook).

## Открытые вопросы / что осталось

- Тексты RU/EN для кодов — задача B08 в Make.

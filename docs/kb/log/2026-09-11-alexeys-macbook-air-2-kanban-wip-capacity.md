---
title: kanban-wip-capacity
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# kanban-wip-capacity

## Что сделано

- Added current/limit, free-slot, full, and exact overflow feedback to Kanban
  column headers.
- Added a capped visual progress track with complete progressbar semantics and
  distinct full/over-limit styling.
- Covered presentation logic and filtered-board behavior with unit, DOM, and
  real Chromium checks.

## Что выяснили (факты, которых не было в KB)

- A WIP limit describes the complete column, so its load must remain independent
  from task filters that only change the current view.
- Capping the visual track at 100% prevents layout overflow while the adjacent
  count and `aria-valuetext` preserve the real excess.

## Куда занесено

- `docs/kb/projects.md`, section `WIP capacity feedback`.

## Открытые вопросы / что осталось

- None.

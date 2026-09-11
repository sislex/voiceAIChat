---
title: kanban-priority-overview
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# kanban-priority-overview

## Что сделано

- Added an accessible four-priority overview with semantic icons and exact task
  counts.
- Connected its OR selection and clear action to the existing priority menu,
  persisted view, active chips, and result rendering.
- Kept counts actionable by excluding only the priority condition and added
  responsive horizontal overflow, DOM coverage, and Chromium checks.

## Что выяснили (факты, которых не было в KB)

- Facet counts should apply the other filters but omit their own dimension;
  otherwise selecting one value makes the remaining choices look empty.
- An active zero-count value must remain enabled so the user can remove it even
  after another filter changes the task population.

## Куда занесено

- `docs/kb/projects.md`, section `Priority overview`.

## Открытые вопросы / что осталось

- None.

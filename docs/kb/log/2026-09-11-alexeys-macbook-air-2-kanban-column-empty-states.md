---
title: kanban-column-empty-states
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# kanban-column-empty-states

## Что сделано

- Distinguished genuinely empty columns from populated columns hidden by view
  filters.
- Added exact hidden counts, filter-source explanations, scoped reset actions,
  direct focused creation, semantic evidence, and responsive styling.
- Verified the states with pure logic tests, DOM interactions, and 15 Chromium
  assertions at desktop and mobile widths.

## Что выяснили (факты, которых не было в KB)

- A local filter reset is useful only when at least one task has already passed
  the global filters; otherwise the board-filter reset is the actionable choice.
- Board-filter reset can preserve local per-column selections, allowing users to
  diagnose combined filters without losing deliberate column configuration.

## Куда занесено

- `docs/kb/projects.md`, section `Column empty states`.

## Открытые вопросы / что осталось

- None.

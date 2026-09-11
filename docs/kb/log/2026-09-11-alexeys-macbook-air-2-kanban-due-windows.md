---
title: kanban-due-windows
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# kanban-due-windows

## Что сделано

- Added mutually exclusive overdue, today, seven-day, and no-due-date board
  slices with local-calendar boundaries.
- Persisted the selection in the shared board view while retaining the legacy
  overdue boolean for mixed-version compatibility.
- Connected the selector to summary actions, filter chips, reset, counts, empty
  states, and responsive UI, with shared, DOM, and Chromium coverage.

## Что выяснили (факты, которых не было в KB)

- The planning window is day zero through day six, calculated from local day
  starts, so DST and time-of-day do not shift tasks between buckets.
- The overdue metric and selector must write one enum to remain mutually
  exclusive; a separate boolean would allow contradictory filters.

## Куда занесено

- `docs/kb/projects.md`, section `Due-date windows`.
- `docs/kb/shared.md`, persisted `BoardView` contract note.

## Открытые вопросы / что осталось

- None.

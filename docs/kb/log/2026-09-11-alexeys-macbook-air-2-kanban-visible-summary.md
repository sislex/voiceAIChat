---
title: kanban-visible-summary
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# kanban-visible-summary

## Changes

- Added a six-metric summary derived from the visible task set.
- Covered filter and live-snapshot recalculation with a DOM regression test.
- Verified desktop and mobile layouts in Chromium against built Storybook.

## New facts

- Completed tasks can carry historical deadlines and must be excluded from the
  actionable overdue count.
- The existing filtered task projection can serve both cards and summary data,
  preventing counters from drifting from the rendered board.

## Documentation

- `docs/kb/projects.md`

## Open questions

- None.

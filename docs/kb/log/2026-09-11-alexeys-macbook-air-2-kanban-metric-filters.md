---
title: kanban-metric-filters
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# kanban-metric-filters

## Changes

- Made overdue, unassigned, flagged, and completed summary metrics interactive.
- Persisted overdue and completed slices through the shared `BoardView` contract.
- Added shared and DOM regression coverage and verified ten interactions in Chromium.

## New facts

- Board views are stored as sanitized JSON, so adding defaulted booleans requires
  no database migration.
- Activating the completed slice must also request retained completed history;
  otherwise the saved filter could hide work that was never loaded.

## Documentation

- `docs/kb/projects.md`
- `docs/kb/shared.md`

## Open questions

- None.

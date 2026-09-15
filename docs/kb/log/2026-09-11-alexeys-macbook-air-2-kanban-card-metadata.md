---
title: kanban-card-metadata
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# kanban-card-metadata

## Changes

- Added relative due-state presentation, explicit metadata units, label overflow,
  and a complete accessible description to task cards.
- Updated a Web Reader history test selector to match its newly published
  numbered replay-button name.
- Verified rich and overflowing cards in Chromium against the built Storybook.

## New facts

- Board task labels need to remain available after backlog because they are
  still useful for scanning and filtering later workflow stages.
- Local calendar-day differences give stable due states across daylight-saving
  and time-of-day boundaries.

## Documentation

- `docs/kb/projects.md`

## Open questions

- None.

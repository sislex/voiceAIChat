---
title: kanban-direct-stage-menu
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# kanban-direct-stage-menu

## Changes

- Added ordered direct stage destinations to each task action menu.
- Included hidden-stage labels, current-stage exclusion, guarded movement, and bounded scrolling.

## Verified findings

- The existing board move adapter already provides stale-source protection and
  completion announcements, so the menu can reuse it without a new callback.

## Knowledge base

- `docs/kb/projects.md`, section “Task card keyboard contract”.

## Open questions

- None.

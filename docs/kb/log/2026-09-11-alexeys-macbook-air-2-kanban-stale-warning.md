---
title: kanban-stale-warning
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# kanban-stale-warning

## Changes

- Replaced the generic background error with a responsive stale-data warning.
- Linked its status, snapshot age, error detail, and retry action to the usable board.

## Verified findings

- Existing load-state policy already preserves data; the missing layer was an
  explicit semantic distinction between stale and fatal states.

## Knowledge base

- `docs/kb/projects.md`, section “Board snapshot status”.

## Open questions

- None.

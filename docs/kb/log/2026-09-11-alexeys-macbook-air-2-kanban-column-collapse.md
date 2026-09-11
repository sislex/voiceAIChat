---
title: kanban-column-collapse
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# kanban-column-collapse

## What changed

- Added per-column and bulk collapse controls for regular and swimlane boards.
- Persisted the preference by user and stable project id, with stale-id cleanup.
- Added DOM, CSS, and built-Chromium regression coverage.

## New verified facts

- Author CSS for a content wrapper must explicitly preserve `[hidden]`; a plain
  `display: contents` rule can otherwise override the browser's hidden style.
- A collapsed swimlane column must retain empty aligned cells in every lane.

## Knowledge base updates

- `docs/kb/projects.md`, section “Collapsible board columns”.

## Open questions

- None.

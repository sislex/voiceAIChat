---
title: kanban-assignee-facet
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# kanban-assignee-facet

## What changed

- Added a named, searchable assignee facet with avatars and task counts.
- Synchronized it with quick avatar buttons and included unassigned work.
- Added accessible decoration handling, responsive styles, DOM, CSS, and Chromium coverage.

## New verified facts

- Avatar initials inside a checkbox label pollute its accessible name unless marked decorative.
- The existing assignee state can safely drive both quick and detailed filter controls.

## Knowledge base updates

- `docs/kb/projects.md`, section “Active filter strip”.

## Open questions

- None.

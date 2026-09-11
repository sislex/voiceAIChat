---
title: kanban-swimlane-controls
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# kanban-swimlane-controls

## What changed

- Added persistent per-row and bulk collapse controls for swimlanes.
- Added filtered/total row counts, ARIA relationships, focus restoration, and stale-id cleanup.
- Covered the behavior with DOM, CSS, and built-Chromium checks.

## New verified facts

- Lane preferences need separate assignee and epic buckets because the empty lane shares an id.
- Author CSS must explicitly preserve the hidden state of lane content.

## Knowledge base updates

- `docs/kb/projects.md`, section “Collapsible board columns”.

## Open questions

- None.

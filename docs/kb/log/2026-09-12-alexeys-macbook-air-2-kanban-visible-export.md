---
title: kanban-visible-export
date: 2026-09-12
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Kanban visible export

## Completed

- Added a filtered, ordered plain-text export to the board toolbar.
- Covered formatting, clipboard feedback, and filtered output in DOM tests.
- Verified the real clipboard and layout against the built ManyColumns story in Chromium.

## Findings added to the knowledge base

- A portable board snapshot must use the rendered task selection rather than the full loaded board.
- The existing shared clipboard helper provides the insecure-context fallback and a boolean result.

## Recorded in

- `docs/kb/projects.md`, section "Visible board text export".

## Open questions

- None.

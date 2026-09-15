---
title: kanban-column-keyboard-order
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# kanban-column-keyboard-order

## Changes

- Made every column grip a named keyboard control with Alt+Arrow shortcuts.
- Added edge handling, complete-order callbacks, position announcements, and focus retention.

## Verified findings

- Synchronous focus retention avoids leaving a pending animation frame that can
  interfere with fake-timer drag tests.

## Knowledge base

- `docs/kb/projects.md`, section “Перетаскивание карточек и колонок”.

## Open questions

- None.

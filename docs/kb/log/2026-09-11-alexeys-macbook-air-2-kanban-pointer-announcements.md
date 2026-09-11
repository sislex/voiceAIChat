---
title: kanban-pointer-announcements
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# kanban-pointer-announcements

## Changes

- Added complete pointer-drag announcements and stable observable state attributes.
- Added source, target position, success, unchanged, and cancellation messages.

## Verified findings

- `usePointerDrag` begins an immediate handle drag on the first pointer move;
  browser verification must include that movement after pointer down.

## Knowledge base

- `docs/kb/projects.md`, section “Перетаскивание карточек и колонок”.

## Open questions

- None.

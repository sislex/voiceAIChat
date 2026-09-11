---
title: kanban-column-menu-keyboard
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# kanban-column-menu-keyboard

## Changes

- Added explicit trigger/menu/menuitem relationships to every column action popup.
- Added initial focus, wrapped arrow navigation, Home/End navigation, and
  predictable Escape and Tab behavior.
- Covered menu replacement and focus transfer between columns.

## Verified findings

- Focus must move after the React commit when one column menu replaces another.
- Tab can keep its native order while the menu closes from its bubbling key event.

## Knowledge base

- `docs/kb/projects.md`, section “Меню колонки”.

## Open questions

- None.

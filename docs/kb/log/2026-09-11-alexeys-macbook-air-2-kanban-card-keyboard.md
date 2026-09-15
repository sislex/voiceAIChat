---
title: kanban-card-keyboard
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# kanban-card-keyboard

## Что сделано

- Separated card opening (`Enter`) from keyboard dragging (`Space`) while
  preserving `Enter` as the commit action after a card is grabbed.
- Added shortcut evidence, context-menu keys and right click, menu semantics,
  focus entry/restoration, wrapped arrow navigation, and Home/End/Tab handling.
- Updated integration expectations and verified normal and grabbed cards with
  DOM and Chromium scenarios.

## Что выяснили (факты, которых не было в KB)

- A bubbled blur from an interactive child must not cancel card state while
  focus is still inside the card subtree.
- A grabbed card needs to delegate `Enter` to the board; the ordinary card can
  safely own the same key for opening details.

## Куда занесено

- `docs/kb/projects.md`, section `Task card keyboard contract`.

## Открытые вопросы / что осталось

- None.

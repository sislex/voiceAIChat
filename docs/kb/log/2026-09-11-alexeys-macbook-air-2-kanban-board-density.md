---
title: kanban-board-density
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# kanban-board-density

## Что сделано

- Added comfortable and compact Kanban density controls with accessible pressed
  states and responsive targets.
- Added scoped, validated persistence and compact geometry for the board,
  columns, cards, metadata, and drag zones.
- Hardened the CSS rule test helper to match exact selectors and covered both
  density modes in DOM, stylesheet, and Chromium tests.

## Что выяснили (факты, которых не было в KB)

- Density is a local rendering preference and should remain separate from the
  server-backed collaborative board view.
- The stylesheet guard previously matched descendant selectors as base rules;
  anchoring the selector prevents compact overrides from masking base geometry.

## Куда занесено

- `docs/kb/projects.md`, section `Board density`.

## Открытые вопросы / что осталось

- None.

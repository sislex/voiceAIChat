---
title: kanban-search-highlights
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# kanban-search-highlights

## What changed

- Highlighted board search matches in visible task metadata.
- Added bounded context for matches in assignee, overflow labels, description, and criteria.
- Added literal matching, accessibility, style, DOM, and built-browser coverage.

## New verified facts

- Search included hidden card fields but previously gave no visual reason why a card matched.
- Literal index-based segmentation handles special characters without regex escaping.

## Knowledge base updates

- `docs/kb/projects.md`, section “Board search and keyboard navigation”.

## Open questions

- None.

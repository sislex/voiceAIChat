---
title: kanban-searchable-filters
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# kanban-searchable-filters

## What changed

- Replaced static facet lists with a shared searchable multi-select.
- Added visible-result counts, partial select/clear, full reset, empty state, and Escape behavior.
- Added responsive styles plus DOM, CSS, and built-Chromium coverage.

## New verified facts

- Label lists can exceed the former fixed menu height and need an independently scrolling option area.
- Bulk changes must operate on search results without dropping selected values hidden by the query.

## Knowledge base updates

- `docs/kb/projects.md`, section “Active filter strip”.

## Open questions

- None.

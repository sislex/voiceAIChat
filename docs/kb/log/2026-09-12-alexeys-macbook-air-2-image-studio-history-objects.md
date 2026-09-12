---
title: image-studio-history-objects
date: 2026-09-12
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Image Studio history and object editing

## Work completed

- Added a non-destructive image version graph with visual history and restore.
- Added rectangle, lasso, magic-wand, and foreground-object selections.
- Added localized model retouch, transparent extraction, object placement, and
  people-retouch presets to the UI and API.
- Exposed the complete workflow through a conversation-scoped Image Studio MCP
  server for Claude and Codex, with server-enforced read-only plan mode.
- Made viewer and selection controls fit and scroll at 390 px and 320 px.

## Facts learned

- Existing `source` metadata can serve as a backward-compatible history edge;
  older galleries need no migration.
- Safe localized retouch requires the final server compositor to copy pixels
  outside the selection from the source, regardless of model output.
- An extracted object's original placement can be recovered after further edits
  by following its source ancestry to the extraction node.

## Knowledge base updates

- `docs/kb/ui.md`
- `docs/kb/server-internals.md`
- `docs/kb/llm.md`
- `docs/kb/deploy.md`

## Open questions

- None.

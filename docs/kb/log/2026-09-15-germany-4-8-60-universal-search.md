---
title: universal-search
date: 2026-09-15
machine: germany-4-8-60
author: unknown
---

# universal-search

## Changes

- Added authenticated search projections, typed navigation, opaque pagination and source isolation.
- Connected the real command palette, ID-only recent history and mobile visual viewport handling.
- Added API/security/CRUD/DOM/browser regressions and preparation-contract coverage markers.

## Verified findings

- The working palette is in packages/ui; the sidebar opener previously lived inside collapsed controls.
- The KB timestamp/count cache version can collide on same-millisecond writes; universal search reads stored documents directly.
- Make filenames support spaces, Cyrillic and #, but reject ?.

## Documentation

- docs/kb/ui.md
- docs/kb/features/task-preparation.md

## Verification limits

Physical mobile software keyboards are not exercised by desktop Chromium; simulated visual viewport events are covered separately.

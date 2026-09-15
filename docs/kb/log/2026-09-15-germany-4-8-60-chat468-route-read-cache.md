---
title: chat468-route-read-cache
date: 2026-09-15
machine: germany-4-8-60
author: unknown
---

# CHAT-468 route reads and cache

## Changes

Documented route-owned reads, session cache TTLs, shared in-flight requests,
realtime seeding, project invalidation, independent retry and stale-response guards.
Linked the existing strict DevelopmentReadiness parser/schema regressions to TC6–TC9.

## Verified findings

Account already loaded data conditionally by tab; it now shares the runtime cache.
History/Usage filters must remain mounted while loading to permit rapid changes.
`openProject(id, { board: false })` loads project detail without a board;
`ensureBoard(id)` loads it on demand and refreshes expired snapshots without hiding them.
The preparation full-response parser and compatible normalization were already
implemented in the task's starting revision; their strict rules were preserved.

## Updated articles

- docs/kb/ui.md
- docs/kb/projects.md
- docs/kb/features/task-preparation.md

## Verification

Case mapping and reproducible browser measurements: `artifacts/chat468/README.md`.
Real mobile keyboard and post-publication production checks require the dedicated
environment variables documented there; desktop emulation does not establish those results.

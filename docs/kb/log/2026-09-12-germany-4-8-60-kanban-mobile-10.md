---
title: kanban-mobile-10
date: 2026-09-12
machine: germany-4-8-60
author: unknown
---

# kanban-mobile-10

## Changes

Implemented mobile column snap and session navigation, independent column scrolling,
a single create FAB, a full filter dialog and reset, compact card details, registered
density persistence and drag target feedback. Added MobileScroll and MobileFilters,
TC1–TC8 markers, mobile axe checks, CSS checks and a repeatable Playwright script.
Brief validation now diagnoses unknown test types and the prompt explicitly requires
a numeric schemaVersion. Regression tests cover strict JSON and safe normalization.

## Verified findings

The pointer engine already implements the 200ms hold, 6px mouse threshold and scale
1.02. The strict brief parser and nullable question-link normalization also existed.
The shared dialog preserves the first-Escape-clears-search convention.

## Documentation

- docs/kb/ui.md
- docs/kb/projects.md
- docs/kb/features/task-preparation.md

## Validation

Browser checks passed at 390px, 720px and 721px; focused mobile DOM and axe checks
passed. `npm run gate:fast` passed with exit code 0 on 2026-09-12, using one
Vitest worker per pool. Persisted run: `20260912230439520-b2bcaeec-a7ce-4d0b-ae1a-d9a1a912d332`.
The gate covered server, ui-foundation, UI, web, Make, Image Studio, both readers,
desktop and the application-host contract. Desktop required its separate locked
dependencies to be installed with `npm ci --prefix apps/desktop`.
TC8 uses two representative replies with preambles because the request does not
include the literal original replies; exact fixture equivalence is unverified.

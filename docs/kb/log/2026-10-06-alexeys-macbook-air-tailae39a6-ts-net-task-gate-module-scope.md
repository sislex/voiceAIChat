---
title: task-gate-module-scope
date: 2026-10-06
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# task-gate-module-scope

## Changes

- Task gates select changed tests, same-package module tests and up to ten other direct importers. Larger importer sets are explicitly deferred to promotion.
- Node and Vitest run explicit test files with at most four workers. Promotion selection, typecheck scope and task budgets are preserved.

## Validation

- Focused planner, runner and budget tests pass (25 cases).
- The required npm task-gate command exits 255 in the sandbox; its direct Node entrypoint fails closed with `spawnSync git EPERM`. Supervisor execution is required.

## Documentation

- docs/kb/testing-operations.md

## Remaining verification

- Regenerate the KB index with working Git access: sandbox regeneration incorrectly cleared existing stale-topic warnings, so its output was discarded.
- No commissioning, commit, push or release was performed.

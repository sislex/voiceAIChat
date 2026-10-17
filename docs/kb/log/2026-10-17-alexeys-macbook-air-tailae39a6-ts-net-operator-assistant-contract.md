---
title: operator-assistant-contract
date: 2026-10-17
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# operator-assistant-contract

## Changes

- Added operator assistant modes, action permissions, limits and normalization helpers to Shared, with unit tests.
- Added optional configuration fields to project detail and project update contracts.

## Contract decisions

- Missing or unknown modes disable the assistant. Numeric limits preserve zero, truncate finite fractions and clamp to documented ranges; malformed values use defaults.
- Disabled actions are filtered and deduplicated. Kanban owns persistence and execution; this change does not commission an operator.

## Documentation

- docs/kb/protocol.md
- docs/kb/projects.md

## Validation

- Shared typecheck passed using `node node_modules/typescript/bin/tsc --noEmit -p packages/shared/tsconfig.json`.
- All 103 project tests passed using `node ../../node_modules/vitest/vitest.mjs run src/projects.test.ts` from `packages/shared`.
- The task gate needs supervisor execution: its Git subprocess fails with `spawnSync git EPERM` in the sandbox.

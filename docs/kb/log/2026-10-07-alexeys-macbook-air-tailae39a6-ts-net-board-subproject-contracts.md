---
title: Subproject board contracts B01
date: 2026-10-07
---

# Subproject board contracts B01

## Changes

Added project hierarchy fields, subproject summaries, board selection options,
REST URL builders, an IPC channel and registry entry, and the pure column helper.
Project is an alias for the existing full ProjectDetail contract.
Updated protocol and projects topics.

## Validation

- Passed: node node_modules/typescript/bin/tsc --noEmit -p packages/shared/tsconfig.json
- Passed: node node_modules/vitest/vitest.mjs run --root packages/shared src/subprojects.test.ts src/projects.test.ts src/protocol.test.ts (86 tests).
- npm run gate:task -- --base b4831420848367676324a346cc85c9849e42aa63 exited 255 without diagnostics.
- Direct planner invocation, node --import tsx scripts/task-gate.mjs --base b4831420848367676324a346cc85c9849e42aa63, failed with spawnSync git EPERM.
- npm workspace typecheck and test:files wrappers also exited 255; direct checks above passed.

## Follow-up

Supervisor must run the task gate. Server persistence, authorization and UI
integration belong to subsequent tasks outside this shared-contract patch.

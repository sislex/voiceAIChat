---
title: b01-release-train-robustness
date: 2026-10-08
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# b01-release-train-robustness

## Changes

- Added the launching checkout dependency check, bounded GitHub retries, redacted command diagnostics, publication polling, and Core pin rebase recovery.
- Added API polling fixtures and real Git fixtures for concurrent dev changes and generated-index conflicts.

## Findings

- The sandbox rejects child Git execution with `spawnSync git EPERM`; Git integration tests and task-gate planning require supervisor execution.

## Documentation

- docs/kb/deploy.md, release train execution.

## Validation follow-up

- `node node_modules/typescript/bin/tsc --noEmit --allowJs --checkJs --allowImportingTsExtensions --target es2022 --module nodenext --skipLibCheck scripts/release-train-run.mjs`: passed.
- `TMPDIR="$DELIVERY_ATTEMPT_ROOT/tmp" node --import tsx --test scripts/release-train-run.test.mjs`: 18 passed; 8 real Git fixture tests stopped at `spawnSync git EPERM` (exit 1).
- The required npm task gate exited 255; direct execution of `node --import tsx scripts/task-gate.mjs --base f338056d92b345a40408f7e2444b15324f465ace` reported `spawnSync git EPERM` before planning (exit 1).
- Run `npm run gate:task -- --base f338056d92b345a40408f7e2444b15324f465ace` outside the sandbox.
- Regenerate the KB index outside the sandbox: generation here silently loses Git freshness information. The generated output was discarded to preserve existing statuses; the deploy topic was checked against `f338056d`.

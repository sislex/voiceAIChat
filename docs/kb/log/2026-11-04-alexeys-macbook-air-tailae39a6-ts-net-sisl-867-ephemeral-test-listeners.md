---
title: sisl-867-ephemeral-test-listeners
date: 2026-11-04
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# sisl-867-ephemeral-test-listeners

## Changes

Removed all `freePort` probe/close/rebind helpers from `apps/server` and `e2e`.
Real listeners bind loopback port 0. Cyclic bridge startup uses deferred Core
HTTP addressing; E2E subprocesses report their actual port over IPC. Continuously
bound TCP relays preserve public origins and restart URLs. Docker allocates its
own Postgres host port.

## Verification

- `npm run gate:task -- --base 8677259c8b9091360667ba3822cb894305d37f4a`: passed, 50 tests and server typecheck.
- Reader integration: 20 independent Vitest runs, four concurrent processes,
  all exit 0 (140 test cases); logs in the assigned attempt's `artifacts/reader-stress`.
- Explicit TypeScript check of changed E2E files: passed.
- Browser test startup: unavailable because the assigned browser directory lacks
  Chromium headless shell. No browser download or external stand was attempted.
- Kanban stand commissioning requires its owner checkout and Postgres outside
  this task's sandbox; neither was accessed.

## Knowledge

Updated `docs/kb/testing-operations.md`, section “Ephemeral test listeners”.

---
title: stand-delivery-b02
date: 2026-10-12
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# stand-delivery-b02

## Changes

- Added Core stand delivery/history/sync routes, Shared contracts and URL builders.
- Added a project-scoped coordinator HTTP adapter and an agent-side Git program
  that preserves merge conflicts; fake coordinator/agent tests cover the flow.
- Documented configuration and behavior in `docs/kb/server-internals.md`.

## Validation

- Direct TypeScript checks passed for Server and Shared.
- Focused Vitest run passed: 90 tests across six files, including Make stand and
  Shared protocol regression tests.
- `npm run gate:task -- --base 0a2cee95f26b49c1bdf8d652794746977c7d14e1`
  exited 255; direct invocation diagnosed `spawnSync git EPERM` in the planner.
  The supervisor must run the required task gate outside this sandbox.
- npm subprocess wrappers are unavailable here; direct Node invocations of the
  installed tools work. KB touch could not read Git HEAD through a subprocess;
  its checked marker was restored from a direct `git rev-parse --short HEAD`.
- The index generator also lost Git freshness information under EPERM; its
  misleading all-green output was reverted. Regenerate `npm run kb:index`
  with the supervisor's task gate.

## Commissioning

- Configure the project's outbound coordinator URL/operator token and validate
  the persisted coordinator status payload alongside B01 before deploying.
- Deploy/release and exercise the Make push → delivery → sync flow separately.
  No credentials were changed and no persistent service was started.

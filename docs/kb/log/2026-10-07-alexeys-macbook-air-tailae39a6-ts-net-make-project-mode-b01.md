---
title: make-project-mode-b01
date: 2026-10-07
machine: alexeys-macbook-air-tailae39a6-ts-net
author: Codex
---

# make-project-mode-b01

## Changes

- Wired Core Make stand and transfer adapters, exact-request user capabilities,
  live-mode RPC compatibility, transfer design links, Git writes/commit/push and
  focused HTTP/Git/RPC/authorization tests.

## Findings

- UI Kit repository is `sislex/sielexa-ui`. Installed make-contracts 1.4 does
  not yet describe live operations or extended transfer results. The Core RPC
  adapter accepts them without changing the installed owner package.
- Make's scoped MCP still requires same-project designs; cross-project source
  reads by downstream task agents need corresponding Make-owner support.

## Documentation

- docs/kb/server-internals.md

## Verification and commissioning

- Direct server TypeScript check passed. Focused adapter/RPC/design tests passed.
- Task gate cannot spawn git in this sandbox (EPERM); the planner's server suite
  cannot bind loopback (listen EPERM). Supervisor must run the required gate.
- KB index generation could not read Git history under sandbox restrictions;
  its misleading freshness-only changes were restored. Regenerate with the
  supervisor's normal Git access.
- Real Kanban stand and project-machine Git commissioning requires configured
  owner services and repositories; no service was deployed or changes pushed.

Exact check commands and outcomes (repository root unless noted):

- `npm run gate:task -- --base 1cc31438f509411c14efa76cee682de16c6f19ac`:
  exit 255 before running checks. Direct entrypoint
  `node --import tsx scripts/task-gate.mjs --base 1cc31438f509411c14efa76cee682de16c6f19ac`:
  exit 1, `spawnSync git EPERM`, zero tests.
- `npm run -w @voicechat/server typecheck`: exit 255 in npm execution.
  `node node_modules/typescript/bin/tsc --noEmit -p apps/server/tsconfig.json`:
  exit 0 on the final implementation.
- In `apps/server`, `node ../../node_modules/vitest/vitest.mjs run src/makeBridge/projectAdapters.test.ts src/makeBridge/coreRpc.test.ts src/db/database.designs.test.ts src/kanbanBridge/internal.test.ts src/server.test.ts --maxWorkers=2 --minWorkers=1`:
  50 passed; server suite failed in setup with `listen EPERM: operation not permitted 127.0.0.1` (18 skipped).
- In `apps/server`, `node ../../node_modules/vitest/vitest.mjs run src/makeBridge/projectAdapters.test.ts src/makeBridge/coreRpc.test.ts src/db/database.designs.test.ts src/kanbanBridge/internal.test.ts src/makeBridge/projectMode.test.ts src/makeBridge/core.contract.test.ts --maxWorkers=2 --minWorkers=1`:
  final run passed, 63 tests across six files.
- `git diff --check`: exit 0.

The repository task planner was inspected using `taskPlan` with the changed
source/test paths after its Git-based entrypoint was denied. It selected the
server typecheck and the five-file run above, deferring 34 direct importers to
the supervisor promotion gate. Full/release gates were not run.

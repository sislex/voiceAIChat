---
title: stand-worktree-behind
date: 2026-10-14
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# stand-worktree-behind

## Changes

- Added read-only conversation worktree inspection and preserved its branch through Core RPC stand options.
- Added dev-behind status with read authorization and the shared per-root busy lock; successful pushes set the branch upstream.

## Findings

- The pinned Make RPC schema strips unknown stand option fields, so Core requires an extended result validator until owner contracts support the field.

## Documentation

- docs/kb/server-internals.md

## Validation and follow-up

- Focused agent, adapter, route, RPC, Git script and Shared contract tests passed; both package typechecks passed through direct Node invocation.
- The requested npm task gate exits 255 in this sandbox. Direct invocation of the task gate reports `spawnSync git EPERM`; supervisor must run the gate.
- KB index generation could not read Git history and incorrectly cleared freshness warnings; its output was restored. Regenerate the index outside the sandbox.
- Make UI support belongs to B03; no deployment, commit or push was performed.

Exact checks (all commands from the repository root):

```sh
node node_modules/vitest/vitest.mjs run src/makeBridge/standWorkspace.test.ts src/makeBridge/standDeliveryAgent.test.ts src/makeBridge/makeStand.test.ts src/routes/standDeliveries.test.ts src/git/scripts.test.ts
# Passed: 143 tests, 5 files.
node node_modules/vitest/vitest.mjs run apps/server/src/makeBridge/coreRpc.test.ts packages/shared/src/standDelivery.test.ts
# Passed: 18 tests, 2 files.
node node_modules/vitest/vitest.mjs run apps/server/src/makeBridge/projectAdapters.test.ts packages/shared/src/protocol.test.ts packages/shared/src/devStand.test.ts packages/shared/src/kbService.test.ts packages/shared/src/releaseDisk.test.ts packages/shared/src/subprojects.test.ts
# Passed: 154 tests, 6 files. Together these cover taskTests()'s selection, deferred=0.
node node_modules/typescript/bin/tsc --noEmit -p apps/server/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p packages/shared/tsconfig.json
# Both passed, exit 0.
npm run gate:task -- --base 6fb7eb5279b2ef6448d9877cff1c217612609bd6
# Exit 255, no diagnostic output after the script banner.
node --import tsx scripts/task-gate.mjs --base 6fb7eb5279b2ef6448d9877cff1c217612609bd6
# Exit 1: spawnSync git EPERM, tests=0.
git diff --check
# Passed, exit 0; xcrun cache warnings from the sandbox.
```

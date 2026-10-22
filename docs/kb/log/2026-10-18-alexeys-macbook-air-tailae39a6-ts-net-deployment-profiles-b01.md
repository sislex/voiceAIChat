---
title: deployment-profiles-b01
date: 2026-10-18
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# deployment-profiles-b01

## Changes

- Added deployment profile contracts, parsing, ticket endpoints, shared-service registry,
  redemption, delegation transport, per-core quotas and path isolation with focused tests.

## Findings

- Existing ChatDelegation requires an Identity grant without a service bearer in the
  user Authorization header. Turns, Billing and notifications use the existing WS protocol.
- Enter tickets and usage counters are process-local; replica routing and inventory
  initialization are explicit deployment responsibilities.

## Documentation

- docs/kb/architecture.md
- docs/kb/data-auth.md

## Validation and commissioning

- Focused tests and all three package typechecks ran directly through Node.
- `npm run gate:task -- --base 878af6e4a6f07e320b54130d34c5fd32816b5a33`
  exits 255 in the sandbox. Direct task-gate execution reports `spawnSync git EPERM`.
  The supervisor must run the required gate. No deployment or credentials were changed.
- `TMPDIR="$DELIVERY_ATTEMPT_ROOT/tmp" node node_modules/vitest/vitest.mjs run packages/shared/src/deploymentProfiles.test.ts packages/component-runtime/src/sharedServices.test.ts apps/server/src/routes/applicationTickets.test.ts`: 25 passed.
- `node node_modules/typescript/bin/tsc --noEmit -p packages/shared/tsconfig.json`: passed.
- `node node_modules/typescript/bin/tsc --noEmit -p packages/component-runtime/tsconfig.json`: passed.
- `node node_modules/typescript/bin/tsc --noEmit -p apps/server/tsconfig.json`: passed.
- The repository task planner selected these suites plus `server.test.ts` and deferred
  29 importers to the supervisor. `TMPDIR="$DELIVERY_ATTEMPT_ROOT/tmp" node node_modules/vitest/vitest.mjs run apps/server/src/server.test.ts`
  failed setup with `listen EPERM: operation not permitted 127.0.0.1`; 18 tests skipped.
- KB touch/log completed through `node scripts/kb.mjs`. Index generation ran but
  unavailable Git history marked unrelated topics fresh. The generated index was
  restored to its original version; the supervisor must regenerate it with Git access.

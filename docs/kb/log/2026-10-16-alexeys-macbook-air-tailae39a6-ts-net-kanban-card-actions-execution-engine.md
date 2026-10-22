---
title: kanban-card-actions-execution-engine
date: 2026-10-16
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# kanban-card-actions-execution-engine

## Changes

- Added execution engine contracts, task action request/response types, and the
  tasks:control scope in token issuance and persistence validation.
- Added the forwarding-only action ingress with authorization and transport tests.

## Findings

- Token scopes are validated both by the issuing route and the project repository.
- Internal board endpoints use the Core service credential after ingress authorization.

## Documentation

- docs/kb/protocol.md
- docs/kb/projects.md

## Verification

- Shared and server typechecks passed via direct TypeScript CLI execution.
- `node node_modules/typescript/bin/tsc --noEmit -p packages/shared/tsconfig.json`
  and `node node_modules/typescript/bin/tsc --noEmit -p apps/server/tsconfig.json`: exit 0.
- From apps/server: `node ../../node_modules/vitest/vitest.mjs run src/routes/integrationIngress.test.ts src/routes/integrationTokens.test.ts src/kanban/boundary.test.ts`:
  24 passed, 10 PostgreSQL tests skipped without a configured test database.
- From packages/shared: `node ../../node_modules/vitest/vitest.mjs run src/projects.test.ts`:
  77 passed.
- Task gate cannot spawn git in this sandbox (EPERM); supervisor must run it.
- `npm run gate:task -- --base 9deb50b151390815f819f85bd00c26075280a87d`:
  exit 255 without diagnostics. Direct execution with
  `node --import tsx scripts/task-gate.mjs --base 9deb50b151390815f819f85bd00c26075280a87d`
  reports `spawnSync git EPERM` (exit 1).
- KB index generation cannot inspect Git history here and falsely clears stale
  topic warnings. Its output was discarded; regenerate the index outside the sandbox.

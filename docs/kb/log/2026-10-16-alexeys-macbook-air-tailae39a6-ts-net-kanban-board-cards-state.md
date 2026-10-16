---
title: kanban-board-cards-state
date: 2026-10-16
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# kanban-board-cards-state

## Changes

- Added the project-scoped integration GET tasks/state ingress and BoardCardsSnapshot contract.
- Added tasks:read to token issuance validation in both the REST route and ProjectsRepo.
- Forwarded snapshots to the external board using internal authorization; board logic and log redaction remain external.
- Documented the contract in docs/kb/protocol.md.

## Validation

- `node node_modules/typescript/bin/tsc --noEmit -p packages/shared/tsconfig.json`: exit 0.
- `node node_modules/typescript/bin/tsc --noEmit -p apps/server/tsconfig.json`: exit 0.
- `node node_modules/vitest/vitest.mjs run --root apps/server apps/server/src/routes/integrationIngress.test.ts apps/server/src/routes/integrationTokens.test.ts apps/server/src/kanban/boundary.test.ts`: exit 0, 21 passed; 10 PostgreSQL cases skipped without VC_TEST_DB_URL.
- `npm run gate:task -- --base e9f8b6f8eaa4545a09e15cd90a52e7c057ee27d0`: exit 255 without diagnostics. Direct `node --import tsx scripts/task-gate.mjs --base e9f8b6f8eaa4545a09e15cd90a52e7c057ee27d0`: exit 1, spawnSync git EPERM. Supervisor must run the affected-test gate.
- npm wrappers for test:files, both package typechecks, kb:log and kb:index returned 255; direct Node checks and KB commands worked.
- `node scripts/kb.mjs touch protocol` and `node scripts/kb.mjs log kanban-board-cards-state`: exit 0. Index generation exited 0 but erased unrelated stale-topic warnings because subprocess Git was unavailable; the generated README was restored to avoid publishing inaccurate status. Supervisor should regenerate the index with Git available.

## Remaining integration work

- The external board owner supplies the internal snapshot endpoint and redacted failure tails. This Core change does not commission that service.

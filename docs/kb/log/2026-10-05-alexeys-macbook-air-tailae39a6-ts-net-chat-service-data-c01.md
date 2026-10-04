---
title: Chat service data transport (C01)
date: 2026-10-05
machine: alexeys-macbook-air-tailae39a6-ts-net
author: Codex
---

# Chat service data transport (C01)

Implemented settings validation/persistence, REST and event projections, the single-message
service-data endpoint, and atomic top-level metadata merge. Projected metadata echoed
by a client cannot overwrite the stored full request. Live turn activity and internal
history/context readers retain diagnostics. In this checkout draft and kanban ensure
are in routes/rest.ts; there is no routes/chat.ts or separate generic ensure route.

Documented in [server-internals](../server-internals.md#chat-message-service-data).

## Validation

All commands run from the repository root. Dependencies were already installed.

Final follow-up after adding projected-metadata echo protection:
`TMPDIR="$DELIVERY_ATTEMPT_ROOT/tmp" node scripts/test-files.mjs apps/server/src/routes/rest.serviceData.test.ts apps/server/src/db/database.test.ts`: 73 tests passed; the typecheck command below was rerun and passed. `git diff --check` also passed.

- `node node_modules/typescript/bin/tsc --noEmit -p apps/server/tsconfig.json`: passed.
- `TMPDIR="$DELIVERY_ATTEMPT_ROOT/tmp" node scripts/test-files.mjs apps/server/src/routes/rest.serviceData.test.ts apps/server/src/routes/rest.resumeServiceData.test.ts apps/server/src/turns.serviceData.test.ts apps/server/src/routes/rest.conversations.test.ts apps/server/src/routes/rest.admin.test.ts apps/server/src/routes/chatSettings.test.ts apps/server/src/db/chatSettings.test.ts apps/server/src/db/database.test.ts apps/server/src/turns.test.ts`: 301 tests passed in 9 files.
- `TMPDIR="$DELIVERY_ATTEMPT_ROOT/tmp" npm run gate:quick -- --base 8e5dc44797952ff3cdcd9aecf7809d30de6673ed`: exited 255 without diagnostics after printing the npm script.
- `TMPDIR="$DELIVERY_ATTEMPT_ROOT/tmp" node --import tsx scripts/quick-gate.mjs --base 8e5dc44797952ff3cdcd9aecf7809d30de6673ed --dry-run`: exited 0, but the affected-test planner reported `spawnSync git EPERM` and selected full gate fallback. Full/release gates are reserved for the supervisor and were not run.
- The npm wrappers for focused tests and typecheck also exited 255; direct Node invocations above succeeded.
- KB workflow commands were attempted via npm; direct `node scripts/kb.mjs touch server-internals`, `node scripts/kb.mjs log chat-service-data-c01`, and `node scripts/kb.mjs index` completed. Child git execution was blocked: touch emitted a blank checked SHA, corrected using the actual `git rev-parse HEAD` result. The generated index incorrectly cleared unrelated stale-topic flags, so its original generated version was restored; the supervisor should regenerate it with git available.

No commit, push, deployment, dependency installation, or persistent service startup.
The supervisor still needs to run the required quick gate outside the sandbox.

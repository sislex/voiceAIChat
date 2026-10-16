---
title: agent-api-tokens
date: 2026-10-16
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# agent-api-tokens

## Changes

Added Shared token-management routes and encoding coverage, plus Core integration
tests for bearer REST access, CSRF-free writes, read-only denial, token creation
denial, revocation and WebSocket query authentication. The REST harness accepts
an optional clock so API token expiration uses wall time in these tests.

## Documentation

Added `docs/kb/agent-api-access.md` and updated `data-auth.md` and `protocol.md`.
Identity owns API token implementation; Core consumes the pinned public handlers.

## Validation environment

Passed: `node node_modules/typescript/bin/tsc --noEmit -p packages/shared/tsconfig.json`
and `node node_modules/typescript/bin/tsc --noEmit -p apps/server/tsconfig.json`.
`node scripts/test-files.mjs packages/shared/src/protocol.test.ts apps/server/src/routes/rest.apiTokens.test.ts`
passed all 13 Shared tests and initially exposed the harness clock mismatch.
After the clock fix, `node scripts/test-files.mjs apps/server/src/routes/rest.apiTokens.test.ts`
passed all five Core integration tests. `git diff --check` passed.

The npm command wrappers exit 255 in this sandbox without diagnostics; direct
Node entry points can run typecheck and focused tests. The task gate stops at
`spawnSync git EPERM`. KB touch and log ran through their Node entry points.
KB index generation ran but could not read Git history and incorrectly marked
unrelated topics fresh. Its output was discarded; the supervisor must rerun
`npm run kb:index` and KB touch with Git subprocess access before final gates.

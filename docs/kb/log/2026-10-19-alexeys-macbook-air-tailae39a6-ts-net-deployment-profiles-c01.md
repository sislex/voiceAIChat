---
title: deployment-profiles-c01
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# deployment-profiles-c01

## Changes

Core now selects local, external and disabled applications from the B01 manifest.
Authentication and queued turns intersect tenant capabilities with deployment
selection. Disabled owners have no module/proxy/MCP startup; their route prefixes
return application_disabled. External application entry tickets remain available.
Compose derives optional service profiles and modes from the same selector.

## Knowledge

Updated docs/kb/deploy.md and docs/kb/architecture.md.

## Validation and commissioning

Focused Core matrix, HTTP entry, runner inventory and Python generator tests
pass. Server TypeScript passes when invoked directly with Node. The task gate
cannot spawn git in the worker sandbox (EPERM); the supervisor must rerun it.
Operator acceptance on dev-m2 remains required before merge. No deployment,
credential changes, commit or push were performed.

Commands and outcomes:

- `node node_modules/vitest/vitest.mjs run --root apps/server src/deploymentApplications.test.ts src/deploymentApplications.server.test.ts src/llm/runnerFsClient.applications.test.ts src/routes/applicationTickets.test.ts`: 17 tests passed.
- `node node_modules/vitest/vitest.mjs run --root apps/server src/turns.test.ts`: 99 tests passed, including disabled application admission.
- `node node_modules/typescript/bin/tsc --noEmit -p apps/server/tsconfig.json`: passed.
- `python3 -m unittest discover -s scripts/prod -p test_compose_env.py`: 5 tests passed.
- `python3 -m unittest discover -s scripts/prod -p test_environment_stands.py -k test_chat_only_accepts_no_kanban_or_postgres`: passed.
- `python3 -m unittest discover -s scripts/prod -p test_environment_stands.py`: environment failures (Python lacks `hashlib.scrypt`; denied xcrun cache writes contaminate expected subprocess diagnostics).
- `npm run gate:task -- --base b81476388a5d29053416082a029ecec3082a4fe3`: exit 255 without diagnostics. Direct `node --import tsx scripts/task-gate.mjs --base b81476388a5d29053416082a029ecec3082a4fe3` reports `spawnSync git EPERM` before executing checks.
- The existing loopback-based `runnerFsClient.test.ts` run did not finish in the restricted sandbox and was interrupted; the new inventory transport test uses injected fetch and passes.
- `bash -n scripts/prod/deploy.sh` and `git diff --check`: passed.
- KB touch, log and index completed using the direct Node entry points; git-based checked stamps are unavailable in the sandbox.

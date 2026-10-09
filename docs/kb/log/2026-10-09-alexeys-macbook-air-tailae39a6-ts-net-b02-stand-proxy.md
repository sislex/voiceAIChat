---
title: Core dev stand session proxy (B02)
date: 2026-10-09
machine: alexeys-macbook-air-tailae39a6-ts-net
author: Codex
---

# Core dev stand session proxy (B02)

Implemented session-owned expiring port leases, project membership checks,
user-attributed Kanban detail reads, isolated stand cookies, Host/Origin rewrite,
streaming HTTP/SSE and WebSocket forwarding. Added a backpressured Core Duplex
endpoint in the agent registry and an authenticated remote Machines adapter.
Added the shared REST request/response contract and opt-in Compose port overlay.
Documentation is in deploy.md and server-internals.md.

## Validation

- `node node_modules/typescript/bin/tsc --noEmit -p apps/server/tsconfig.json`: passed.
- `node node_modules/typescript/bin/tsc --noEmit -p packages/shared/tsconfig.json`: passed.
- `node node_modules/vitest/vitest.mjs run apps/server/src/agents/coreTunnel.test.ts apps/server/src/agents/registry.test.ts apps/server/src/standProxyKanban.test.ts apps/server/src/machines/boundary.test.ts packages/shared/src/protocol.test.ts`: 59 passed.
- `node node_modules/vitest/vitest.mjs run apps/server/src/standProxy.test.ts`: 3 policy tests passed; 2 listener tests unavailable in the sandbox (port binding rejected, including `listen EPERM 127.0.0.1:24019`). Assigned ports only.
- `npm run gate:task -- --base f507b5202eece0a5521c18590539234c31d15dbf`: exited 255 before checks.
- Direct planner `node --import tsx scripts/task-gate.mjs --base f507b5202eece0a5521c18590539234c31d15dbf`: exited 1, `spawnSync git EPERM`, tests=0.
- `git diff --check`: passed.

KB touch/log/index commands were attempted. Direct Node commands wrote the log
and topic dates. Index generation could not read Git history inside the sandbox
and falsely marked unrelated topics current; its generated changes were reverted.
The supervisor must regenerate the index and run the task gate/listener tests.

## Operator commissioning

No commit, push, deployment, credential changes or persistent services.
The deployment operator must enable the pool, include the optional Compose
overlay, publish the selected ports and perform same-host browser acceptance.
An empty pool keeps the existing base Compose setup unchanged.

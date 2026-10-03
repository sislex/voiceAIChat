---
title: C14 persistent environment links
date: 2026-10-03
---

Implemented environment-owned links with shared SQLite/PostgreSQL DDL, automatic
existing-database installation, ownership mapping and persistence tests.
LinkManager owns the actual agent tunnels, fixed Docker-host listeners,
authorization, reconnect/startup recovery and shutdown. Machines and Kanban RPC
adapters expose ensure/list/delete without consumer-owned authorization callbacks.
Updated [server internals](../server-internals.md).

Validation from the repository root:
- `node node_modules/typescript/bin/tsc --noEmit -p apps/server/tsconfig.json`: passed.
- From `apps/server`: `node ../../node_modules/vitest/vitest.mjs run src/agents/linkManager.test.ts src/agents/registry.test.ts src/db/database.environments.test.ts src/db/schemaPg.test.ts src/db/ownership.test.ts src/machines/boundary.test.ts src/kanbanBridge/internal.test.ts`: 77 passed, 13 skipped (PostgreSQL unavailable).
- `npm run gate:changed -- --base 348d6ae391e36e7ab47d362357e70993d894cc87`: sandbox exit 255.
- Direct planner dry run: `node --import tsx scripts/application-gate.mjs --base 348d6ae391e36e7ab47d362357e70993d894cc87 --dry-run`: exit 0, cannot select affected suites because `spawnSync git EPERM`; full gates deferred to supervisor.

KB touch/log/index were invoked. npm child commands exited 255 in the sandbox;
direct Node log/index completed. Since the generator could not read git history,
its unrelated freshness-status changes were discarded by restoring the generated
index; the supervisor can regenerate it with git access. Touch could not read git HEAD through its child
process, so its empty checked field was filled with the independently read
checkout HEAD, 348d6ae3. No commits, pushes, deployment or persistent services.
Agent upgrades to 0.21.0+ and actual Docker connectivity commissioning are
operator tasks; PostgreSQL execution and the required gate remain supervisor checks.

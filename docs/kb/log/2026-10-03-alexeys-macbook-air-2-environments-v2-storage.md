---
title: environments-v2-storage
date: 2026-10-03
machine: alexeys-macbook-air-2
author: Codex
---

# Environments-v2 Core storage (B03)

Added managed environment columns, Core selections, operation kinds, settings
storage, ownership and both-engine migration/index replacement. Repository tests
cover stage-1 migration, managed lifecycle, settings transactions and all active
statuses. Compose forwards the optional secret key to Kanban.

Updated deploy.md and data-auth.md. The KB touch command could not spawn Git in
the sandbox and emitted empty checked fields; these were filled with the actual
HEAD obtained by a direct git rev-parse: a4a13bb9.

Validation:
- Server typecheck: direct Node invocation passed.
- Environment and PG bootstrap suites: 10 passed, 13 skipped.
- Schema/ownership suites: 11 passed, 1 skipped.
- VC_TEST_DB_URL was absent; real PostgreSQL checks remain for the supervisor.
- npm child command execution exited 255. Direct planner invocation reported
  spawnSync git EPERM, so the required changed gate remains for the supervisor.

No commit, push, service start, deployment or commissioning was performed.

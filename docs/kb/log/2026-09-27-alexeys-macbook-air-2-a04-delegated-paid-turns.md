---
title: A04 delegated paid turns
date: 2026-09-27
machine: alexeys-macbook-air-2
author: codex
---

# A04 delegated paid turns

Implemented standalone grant admission through the published Billing reserve/start
contract, with original credentials confined to memory. Stable subject, tenant and
grant bindings survive in the accounting outbox without creating a user session.
Core rechecks conversation/project authority at admission, claim and dispatch.
REST/WS snapshots expose paid text availability when accounting is configured.
Child tools remain disabled pending scoped adapters.

Added integration coverage for Billing/Runner attribution, revoked grants between
admission boundaries, account mismatch, settlement after revocation, queue replay
after restart and credential cleanup. Hardened references against rebinding to a
rotated grant. Updated data-auth.md.

Validation: initial server typecheck passed. npm ci failed with registry DNS
ENOTFOUND; subsequent checks require dependency installation by the supervisor.
The gate planner could not spawn git (EPERM); the required npm gate exited 255
before its checks ran. KB index generation also lost git status information under
the sandbox, so its misleading generated diff was discarded. Regenerate the index
with the supervisor. Full native gates and operator A07 commissioning remain
pending; no deployment or credential changes were performed.

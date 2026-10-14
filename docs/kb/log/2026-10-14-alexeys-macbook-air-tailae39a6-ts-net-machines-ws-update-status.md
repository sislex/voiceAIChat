---
title: machines-ws-update-status
date: 2026-10-14
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# machines-ws-update-status

The machines WebSocket feed now includes the registry's last self-update outcome,
matching REST for initial lists and subscription updates. Tests cover REST parity,
omitted outcomes, offline machines, owner isolation, existing fields and empty lists.

Documented in `docs/kb/server-internals.md`.

Validation: server TypeScript passed; `server.agentsFeed.test.ts` passed all four tests.
The task gate requires supervisor execution: its planner fails with `spawnSync git EPERM`.
KB touch/index were attempted, but child Git execution is restricted; the previous
checked marker and generated index were retained to avoid unrelated stale-status changes.

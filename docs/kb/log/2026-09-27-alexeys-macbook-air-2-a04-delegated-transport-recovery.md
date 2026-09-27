---
title: a04-delegated-transport-recovery
date: 2026-09-27
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# a04-delegated-transport-recovery

## Changes

- Recovered the worker's delegated transport patch in a separate Core worktree.
- Removed a duplicate Fastify request decorator that prevented server startup.
- Re-ran the complete Core gate on the recovered revision.

## Findings

- Standalone delegated admission and a scoped connection handshake work, but Billing still requires a user session to reserve a paid turn.
- A standalone application grant must never fall back to unattributed execution.

## Documentation

- docs/kb/data-auth.md

## Outstanding

- Add a provider-owned delegated Billing admission or exchange contract, then prove an end-to-end standalone paid turn before accepting A04.

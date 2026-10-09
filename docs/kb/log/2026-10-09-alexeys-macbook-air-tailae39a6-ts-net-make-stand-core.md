---
title: make-stand-core
date: 2026-10-09
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# make-stand-core

## Implementation

- Implemented the Make 1.7.0 stand port, cross-project options, ready-base creation,
  conversation worktrees, bounded filesystem access, scoped project Git and proxy leases.
- Added fake Kanban/agent tests, agent-program containment tests and RPC coverage.

## Findings

- Agent exec uses a string transport; the fixed Node wrapper launches Git with
  argv and shell disabled. Files/Git locate the live conversation worktree in
  Kanban instead of persisting a second binding in Core.

## Documentation

- docs/kb/server-internals.md

## Verification and commissioning

- Direct server typecheck and focused unit/contract tests pass. The task planner
  cannot spawn Git in the sandbox (`spawnSync git EPERM`); the two Make network
  integration suites cannot bind loopback (`listen EPERM`). Supervisor gates
  and subsequent operator commissioning remain separate from implementation.
- The KB index generator cannot read Git history through its subprocess in this
  sandbox and clears unrelated stale-topic warnings. Its output was discarded;
  regenerate the index in the supervisor environment.

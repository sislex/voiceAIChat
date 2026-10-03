---
title: b05-integration-tokens
date: 2026-10-03
machine: alexeys-macbook-air-2
author: unknown
---

# b05-integration-tokens

## Changes

- Added project integration token persistence, additive SQLite/PostgreSQL migration,
  owner-only management, hashed credentials, revocation and internal resolution.
- Added real-adapter route and migration tests for both databases and a Core
  composition test; PostgreSQL execution requires the assigned test database URL.

## Findings

- Internal whoami retains service authentication and resolves the forwarded
  Authorization header. Integration responses carry a principal, never a user.
- Core rejects integration credentials on all non-internal routes.

## Documentation

- docs/kb/data-auth.md

## Remaining operations

- Supervisor runs the required affected gate and PostgreSQL matrix in its runtime.
  Consumer commissioning and deployment are outside this implementation.
- Focused validation passed: server typecheck and 88 tests; 8 PostgreSQL tests
  were skipped because no assigned test database URL was configured.
- KB touch/log/index were invoked. Sandbox denial of Git subprocesses made the
  index generator incorrectly mark unrelated topics fresh; its output was
  discarded. Regenerate the index in the supervisor runtime. The topic's checked
  revision was set to the checkout HEAD obtained by a direct Git command.

---
title: u02-canonical-chat-settings
date: 2026-09-27
machine: alexeys-macbook-air-2
author: unknown
---

# u02-canonical-chat-settings

## Implementation

- Added authenticated canonical settings routes, strict patch validation and
  transactional persistence using the existing SQLite/Postgres adapters.
- Added lazy legacy migration, durable account-wide revisions, conflict snapshots,
  and conversation adapters used by the existing turn runtime.
- Added database and HTTP tests, including independent SQLite connections and restart.

## Findings

- The S1 contract was present; the revisioned routes were not implemented.
- Legacy conversation fields require mapping and provider-specific model retention.

## Documentation

- docs/kb/protocol.md, versioned chat/application boundary.

## Validation and commissioning

- Shared and server typechecks passed. Shared: 821 tests passed. The final focused
  server run passed 21 tests (15 settings tests plus ownership and promise-audit
  checks). A full server run was attempted and stopped after repeated sandbox
  networking failures/timeouts; it is not a passing application gate.
- Supervisor must run npm ci and the required Core application gate outside the
  sandbox. Local gate planning cannot spawn Git; server integration tests that
  listen on loopback or spawn Git encounter EPERM.
- KB touch/log/index commands were attempted. The index generator cannot read Git
  history in this sandbox and incorrectly marks all topics fresh, so its output
  was restored. Regenerate the KB index with Git available during commissioning.
- No deployment or production migration was run. Migration is lazy when the
  new authenticated settings endpoints are first used after deployment.

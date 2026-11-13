---
title: message-service-data-storage
date: 2026-10-27
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# message-service-data-storage

## Changes

- Added transactional message_service_data storage, SQL history projection, background
  batches and legacy fallback for SQLite and PostgreSQL.
- Removed transcript copies from request diagnostics. Added bounded activity entries,
  point lookups and narrow turn/history queries.
- Updated Core UI plan-action compatibility and actual-prompt details in its owner repository.

## Verified facts

- SQLite and PostgreSQL persistence/backfill tests passed, including restart and
  concurrent metadata patches; REST and completion/cancellation/shutdown WS tests
  passed on both adapters.
- Read-only export of production conversation 1a40985d-b928-41bc-acc1-0aaa4d168bf5
  currently contained 16 messages and 16,586,686 bytes of metadata. After migration,
  listMessages returned 16,817 bytes in 4.59 ms (SQLite) and 4.32 ms (PostgreSQL).
  This is the current export, not the 647-message/94 MB incident snapshot.
- A synthetic 647-message fixture with 98,576,028 bytes (94 MiB) of legacy
  diagnostics returned 124,284 bytes after migration in 41.02 ms on SQLite and
  19.51 ms on PostgreSQL. Run it with VC_SERVICE_DATA_STRESS=1. This is a load
  regression test, not the original incident snapshot.
- The opt-in production-export benchmark is in database.history.test.ts and uses
  VC_SERVICE_DATA_BENCHMARK with a JSONL message export. No production payload is committed.

## Gate

- Core `npm run gate:fast` passed (exit 0), run
  20261027113503421-d6ea8731-2d93-4fd8-b880-e46164cb38a1.
- A prior run hit the unrelated timer-sensitive execStream test; its isolated
  rerun passed, followed by the successful complete fast gate above.

## Updated topics

- docs/kb/server-internals.md#chat-message-service-data
- docs/kb/protocol.md
- Core UI owner: docs/kb/chat-service-data.md

## Remaining verification limit

- The original 647-message incident snapshot was not available in the current export.

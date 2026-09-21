---
title: chat-execution-accounting
date: 2026-09-21
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Chat execution accounting

## Implementation

Published SDK 1.1.0 and Billing 1.1.1 from reviewed clean commits. Added runner
receipts, no-spawn fences, pre-spawn Codex baselines, and Core Chat admission,
session-reference propagation and durable settlement outbox. Core preserves the
login-based CLI profile key while Billing uses the stable Identity subject.

## Verified boundaries

SDK gate passed 49 tests; Billing gate passed 21 tests. Runner gate passed 472
tests plus script checks. Core targeted HTTP accounting tests cover admission,
settlement response loss, logout, isolation and finite-budget denial. Canonical
`npm run gate:fast` and `npm run gate` both passed. The server suite passed 2395 tests
(42 expected skips), and application browser checks passed 807 tests. Core/Billing
production deployment remains pending at this log checkpoint.

## Knowledge

Updated docs/kb/data-auth.md. Runner operational semantics and rollback limits
are documented in its independent docs/operations.md. Missing Codex baseline or
unknown pricing remains uncertain; a missing remote receipt must be fenced before
settling zero cost because an original request may still be in flight.

## Executor deployment

Runner 0.2.1 (`6e117b2581f663f29ebd6200fbeb4bd9a33d547f`) is deployed to both production executors. Authenticated smoke checks passed on both; CLI versions and all six profile volumes were preserved. The full pre-upgrade profile backup is `/var/backups/llm-runner/usage-0.2.0`; consistent receipt snapshots for the patch are in `/var/backups/llm-runner/usage-0.2.1`. Core and automation admission resumed at 18:09:32 UTC after both executors were ready. Core remains 0.1.317 at this checkpoint.

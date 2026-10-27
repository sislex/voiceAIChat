---
title: accounting-runner-cleanup
date: 2026-10-28
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# accounting-runner-cleanup

## Changes

- Enabled forced connection cleanup for the accounting fixture's Fastify runner.
- Added a regression with a server-accepted TCP connection that sends no HTTP headers.
- Verified the regression fails before the fix and all 22 accounting tests pass after it.
- `npm run gate:fast` passed: Core typecheck/build, 2352 server tests, and Knowledge typecheck/build with 19 tests. A preceding run hit an unrelated heartbeat timing failure in `internal/execStream.test.ts`; its isolated retry and the final gate both passed.

## Findings

- `runner.close()` waits for a requestless socket unless forced connection cleanup is enabled. The regression destroys its socket in `finally` even when the assertion fails.
- Accounting drains before runner cleanup; production background settlement behavior is unchanged.

## Knowledge topic

- docs/kb/data-auth.md#billing-reservation-service

## Remaining work

- None.

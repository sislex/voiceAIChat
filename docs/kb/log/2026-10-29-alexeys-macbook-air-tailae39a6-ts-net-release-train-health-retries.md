---
title: release-train-health-retries
date: 2026-10-29
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# release-train-health-retries

## Changes

- Bound release-train health recovery to five minutes, with logged backoff for connection errors and HTTP 502/503 on both endpoints.
- Added deterministic recovery, timeout and fail-fast journal tests.

## Verified findings

- The Release Center status request previously escaped the health retry loop on connection failure.
- Health now fails immediately on a successful response with a mismatched version or reported commit; diagnostics retain the observed version.

## Updated topic

- docs/kb/deploy.md#release-train-execution-c01

## Remaining work

- None.

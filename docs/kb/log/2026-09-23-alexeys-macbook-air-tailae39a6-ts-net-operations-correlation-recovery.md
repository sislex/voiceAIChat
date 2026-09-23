---
title: operations-correlation-recovery
date: 2026-09-23
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# operations-correlation-recovery

## Changes

- Added validated HTTP request correlation through Core and its service proxies.
- Added admin-only bounded HTTP status, alerts and Prometheus metrics.
- Added tested backup retention planning and a manifest-driven restore drill.
- Reconciled the 15-deliverable roadmap with production releases through 0.1.330.

## Findings

- The previous roadmap still reported 0/15 although eight deliverables already
  had production acceptance.
- Listing a PostgreSQL dump proves readability but not restoration; the new drill
  restores the archive into a disposable PostgreSQL instance.

## Documentation

- `docs/kb/testing-operations.md`
- `docs/kb/protocol.md`
- `docs/kb/server-internals.md`
- `docs/kb/conventions.md`

## Open questions

- Production release and a drill against real production backup copies remain.

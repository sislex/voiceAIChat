---
title: tenant-tariff-runtime
date: 2026-09-20
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# tenant-tariff-runtime

## Changes

Integrated Identity 1.1.1 personal tenants, separate system roles and configurable
tariffs into Core. Enforced live capabilities at HTTP, WebSocket, queued model,
CI, Image Studio and Reader callback boundaries. Wired the upstream account editor
through the session client and hid unavailable module navigation.

## Decisions

Existing accounts receive Standard with all current modules; tenant owner is not
an administrative role. Optional tenant hints are validated against live Identity.
Personal tenants retain existing user/resource ownership. Monetary pricing,
payments and token-credit ledgers remain outside this phase.

## Validation

Independent Identity gate passed including real PostgreSQL migration/concurrency,
SQLite rollback/backfill, account/admin/client tests and mobile visual checks.
Tool repository gates passed before publication. Focused Core checks cover live
remote Identity authorization, denied model work and WebSocket invalidation.
A restored copy of production user/session tables retained byte-equivalent rows
while provisioning personal tenants. Core's four-process PostgreSQL bootstrap
passed. CI uses its existing Identity repository port rather than importing Core's
HTTP access module. Authentication-aware model fixtures now provision users.
Identity 1.1.1 loads editor CSS only with its lazy dialog and reuses UI-kit account
summary components; route budget limits remain unchanged.
Both canonical Core gates (`npm run gate:fast` and `npm run gate`) passed with
exit code 0; each included all 807 end-to-end browser checks. The backed-up
production rollout and live verification are the remaining delivery step.

## Knowledge updated

- docs/kb/data-auth.md
- docs/kb/architecture.md
- docs/plans/tenant-tariffs.md

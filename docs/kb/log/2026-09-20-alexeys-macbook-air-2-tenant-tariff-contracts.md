---
title: tenant-tariff-contracts
date: 2026-09-20
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# tenant-tariff-contracts

## Changes

Added the tenant/tariff architecture plan and additive shared contracts for personal
tenants, tariff plans, assignments and authenticated product capabilities. Named
the existing role union SystemRole while preserving UserRole compatibility. Added
typed Identity session routes and an optional host-injected tariff client.

## Decisions

System permissions, tenant membership and product capabilities remain independent.
Default migration preserves existing access; no pricing or payment model is invented.
Tariff input validation cannot represent admin privileges or provider scopes and
requires positive optimistic revisions for updates. Missing authenticated account
context does not authorize a product capability.

## Validation

Shared typecheck and all 1,254 tests passed, including capability allowlist and
privilege-injection tests. Both canonical integration gates (`npm run gate:fast` and `npm run gate`) passed
with exit code 0 on September 20, 2026.
Runtime/storage/UI work belongs to the next implementation stage; these additive
contracts do not change production behavior by themselves.

## Knowledge updated

- docs/kb/data-auth.md
- docs/plans/tenant-tariffs.md

---
title: agent-api-limits
date: 2026-10-17
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# agent-api-limits

## Changes

- Added the four-item “Ограничения” section for external agents: user role and project membership, HTTP-method-only read restrictions, fixed expiration, and prohibition on token issuance using another token.

## Documentation

- Updated `docs/kb/agent-api-access.md` freshness and regenerated `docs/kb/README.md`.
- No application code changed.

## Validation

- `npm --script-shell=/bin/sh run kb:check` passed (exit 0); existing missing-AGENTS warnings remain for `apps/automation-runner` and `packages/knowledge`.
- `npm --script-shell=/bin/sh run gate:task -- --base 9025a6e9260302939f11cd6beae2c4f8e6ce1111` could not run checks: `spawnSync git EPERM` (exit 1). Supervisor verification is required.

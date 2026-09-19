---
title: sislexa-platform-contract-foundation
date: 2026-09-20
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# sislexa-platform-contract-foundation

## Changes

Expanded `docs/plans/sislexa-modular-platform.md` into an implementation plan with
stages and completion criteria. Implemented versioned operation metadata and
module-level consumption reporting in shared, with public exports and 44 tests.

## Implementation boundaries

Child contexts retain the initiating user, payer, environment, project, and module.
The usage reducer isolates user/issuer/environment, filters periods and resources,
deduplicates identical deliveries, rejects conflicting replays and invalid counters,
and calculates per-module token shares. Structural parsing is not authentication;
reporting is not a durable ledger or a budget authorization service.

## Documentation

- `docs/kb/shared.md`: implemented contract behavior and limitations.
- `docs/kb/architecture.md`: first implementation status and plan link.
- `docs/plans/sislexa-modular-platform.md`: staged implementation and acceptance criteria.

## Validation and remaining work

Shared typecheck and all 1,222 shared tests passed, including the 44 new tests.
The first selected consumer gate failed on an existing Administration boundary
violation: `PerformanceDashboard` subscribed directly to browser globals. Moved
connectivity lifecycle into UI Kit's public, injectable `useOnlineStatus` hook
without weakening the boundary test. Administration's gate now passes (94 tests),
as does UI Kit's gate (155 tests), including four added connectivity tests.
The full selected consumer `npm run gate:fast` finished with exit code 0.
The pre-publication `npm run gate` also finished with exit code 0 after moving
the working copy; no source changes followed either successful gate.
The working copy is now the persistent sibling `voiceAIChat-sislexa-platform`,
on `feat/sislexa-platform-foundation`; the original dirty checkout was preserved.
Immutable-ID migration, authenticated transport propagation, durable accounting,
balance reservations, activity collection, analytics UI, and repository extraction
remain separate implementation stages. Production deployment is pending publication.
The owner authorized the standard server-side
`voicechat-deploy` fallback because authenticated Release Center access was unavailable.

The pre-deployment production checks passed for core, Make, Playwright Reader,
Chromium, the external LLM endpoint, core/tool RPC authorization, the login page,
and static assets. The login page rendered in Chromium without page errors;
authenticated user workflows have not been exercised by this probe.
The private pre-release Postgres/configuration backup is
`/var/backups/voicechat/sislexa-foundation-20260919T222535Z` on the core host;
`pg_restore --list` accepted its archive. The deployed source was `5169e54033b2`
on `release/0.1.309` (only a generated KB index commit ahead of the source baseline).

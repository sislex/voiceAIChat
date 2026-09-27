---
title: a07-composition-blocker
date: 2026-09-28
machine: alexeys-macbook-air-2
author: unknown
---

# a07-composition-blocker

## Changes

- Added `VC_DELEGATED_CHAT_ENABLED=true` opt-in in `apps/server/src/config.ts`
  and `server.ts`, with disabled Compose default. Injected and managed Identity
  clients cannot implicitly enable delegated access.
- Added `server.delegationRegistry.test.ts`: actual embedded Identity issuance,
  resource-scoped REST/WS, spoof denial, rotation, application rename/revocation,
  and default-disabled access. Existing delegated server tests explicitly opt in.
- Added `scripts/a07-composition.mjs`, a fail-closed artifact preflight for the
  exact A01/A02/A03/A05/A06 source set, bytes, consumer locks and deployment pins.
  Its source-selection regression checks run in the existing S3 tooling suite.
  No owner artifact or deployment lock was replaced.

## Validation

- Server TypeScript check: exit 0.
- Two delegated server test files: exit 0, six tests passed, using in-process
  HTTP/WS injection and disposable SQLite; no listening service was started.
- `node --test scripts/s3-provider-artifacts.test.mjs`: exit 0, two tests passed.
- `node scripts/a07-composition.mjs`: exit 1, missing required SDK and Analytics
  sources. The existing artifacts point to SDK `f58c2c890b1d0aa2d81b279b3bc426114b5fb465`
  and Analytics `7ff6fb8b02f629938e4430683e7c505f423a6de5`.
- Gate planner returned the full plan because its Git subprocess received EPERM.
  Required `npm ci` and `npm run gate` remain for the supervisor outside sandbox;
  focused checks do not replace that complete gate.
- KB touch/log/index were invoked. npm subprocesses exited 255; direct Node
  log/index succeeded. Touch could not read Git through its subprocess; the
  checked field was restored using the directly observed HEAD `75422e3f`.

## Knowledge

- `docs/kb/data-auth.md`, Core delegated chat adapter.

## Blocker and remaining implementation

- Assigned dependencies contain only `a07-brief.md`. SDK artifact from
  `f6313db5ff58cc35fa8dacc90b9844f9706dcfba` and the accepted S3 A06
  Analytics artifact from `f398196a38438cc818d9d5c6db375c205dd0dea3` are missing. GitHub DNS is unavailable;
  no sibling workspace or credential was accessed.
- After receiving those owner artifacts and integrity, pin the exact SDK/Analytics
  composition while preserving S3 Billing. Implement the SDK credential/browser
  session consumer and the synthetic paid-turn path through live Identity,
  Core queue/outbox, published Billing/Runner and Analytics reports. Prove scoped
  authorization, revocation, restart recovery and exact totals without duplicate
  child charges. These are unfinished A07 code/test requirements, not merely
  operator commissioning.
- Keep external access disabled pending acceptance. Production commissioning is
  a subsequent operator action; no commit, push, deployment or live change occurred.

---
title: sm-47-sessionless-storage-kb-verification
date: 2026-11-02
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# sm-47-sessionless-storage-kb-verification

## Changes and evidence

Reviewed Core HEAD `6c74a78cbfe9f9940c5dcdb5d57ca07d216dd236` against `origin/dev`.
The runtime diff is limited to `apps/server/src/server.ts` and
`apps/server/src/routes/applicationTickets.delegation.test.ts`.
Updated the existing Make service storage authorization section in
`docs/kb/data-auth.md` with the roles of service and user authority, the Storage
403 versus internal verifier 401 distinction, and the consumer verification boundary.
Evidence: `authenticateRaw`, the direct legacy/shared GET/PUT regression,
`verifyCoreMcpTokenWithSecret` in `packages/component-runtime/src/sharedServices.ts`,
and credential handling in `packages/component-runtime/src/index.ts`.
Only data-auth was touched; the supplied strict report listed no stale topics.

## Validation

`node scripts/kb.mjs touch docs/kb/data-auth.md`, `npm run kb:index`,
`npm run kb:check -- --strict` and `git diff --check` passed.
Application tests were inspected, not rerun for this documentation-only update.
No commit or push was performed.

## Verification limit

This is the Core owner checkout. `apps/make` is absent, and the regression uses
embedded Core Storage with fake nodes. It does not prove Make installs authority
before `.stand.json` reads or execute `make_read_file` in service storage mode.
That part of the reported gap remains for the Make owner source and consumer test.

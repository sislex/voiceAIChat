---
title: sisl-763-identity-acceptance-audit
date: 2026-10-24
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# sisl-763-identity-acceptance-audit

## Work completed

Audited merged Identity PR #35, release provenance and Core's installed Identity
source. Added owner regression coverage for resend rotation, expired verification
and reset, neutral recovery responses and closed signup/resend. Preserved the
October 19 Mailpit and owner-gate reports as historical evidence.

## Verified facts

Core's Identity 1.5.2 archive identifies source b71a98e in release-source.json.
Its auth.ts matches owner main 6743560. Closure and malformed signup field fixes
are already present; no runtime reimplementation or Core pin change is needed.

## Documentation

- docs/kb/data-auth.md
- docs/plans/public-chat-v1.md (SISL-763 completion plan and evidence limits)

## Validation

Core `npm run gate:fast` passed (documentation-only selection). Identity server
 typechecking passed. The initial default-worker task gate had 28 five-second
 test timeouts; its worker-environment retry exceeded the MCP timeout. Final
 server tests with `--maxWorkers=1 --minWorkers=1` passed: 181 tests, 2 skipped,
 25 files passed and 2 skipped, 167.09 seconds. Signup/mailer alone also passed
 all 14 tests. No assertion or timeout was weakened. Full owner/release gates
 remain at the later workflow stage.

## Remaining acceptance

Retain exact stand composition and SMTP evidence for resend/expiry, then run
later workflow owner/release checks. Public outbound mail, canonical-domain
commissioning and production changes remain separate owner-controlled work.
This run does not establish physical-M1 acceptance.

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

## Workflow retry

The follow-up preserves the prior results above. Identity's server Vitest
configuration now records the one-worker limit instead of requiring manual CLI
flags. No assertions, timeout budgets or production code changed.

On MacBook with Node 22.19.0 and npm 10.9.3, the standard owner command
`npm run gate:task -- --base 67435604554cb27b1442c711c63f200531aaf380`
passed (exit 0) in 66.4 seconds including typecheck. Vitest reported 181 passing
tests and 2 PostgreSQL skips, 25 passing files and 2 skipped files, in 50.07
seconds. The gate's total of 183 includes skips. Signup's 11 tests and mailer's
3 tests passed.

The failed run's temporary JSON report was not retained. Code inspection of
`scripts/gate-task.mjs` shows why its summary can say tests=0 after executed
tests fail: counting follows the successful child exit, and cleanup removes
the report in finally. Do not interpret that summary as missing discovery.

## Remaining acceptance

Retain exact stand composition and SMTP evidence for resend/expiry, then run
later workflow owner/release checks. Public outbound mail, canonical-domain
commissioning and production changes remain separate owner-controlled work.
This run does not establish physical-M1 acceptance.

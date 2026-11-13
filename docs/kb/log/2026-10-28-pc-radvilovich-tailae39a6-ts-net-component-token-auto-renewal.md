---
title: component-token-auto-renewal
date: 2026-10-28
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# component-token-auto-renewal

## Changes

- Added temporary-installation rotation coverage for all 18 grants, expired and revoked tokens, authorization failure, ownership/mode preservation and lock exclusion.
- Connected hourly timer installation to successful managed production deployment; systemd reads the environment before switching to UID 1000.
- Added Core startup/recovery regression coverage using a real provider with an expired Identity grant and readiness expiry coverage.

## Verified findings

- Managed Core already skips local administrator bootstrap; an expired Identity grant does not prevent startup. Identity-dependent requests and readiness fail with 503, and replacing the outgoing credential restores readiness without a restart.
- The rotator matches expired non-revoked tokens by digest and issues the current grant's maximum TTL. Replacement authorization is checked before old-token revocation.
- Readiness warns within seven days; expiry is unknown on a cold start with an already expired credential.
- The extended gate's snapshot-restore test requires Python with hashlib.scrypt. Apple's CLT Python on the test machine lacks it; the isolated test passes with standalone Python 3.12 on PATH.

## Updated topics

- docs/kb/deploy.md (Managed component installation)
- docs/kb/data-auth.md (Provider-issued component tokens)

## Validation

- `npm run gate:fast` passed (exit 0), including the expanded tooling, workspace and browser integration suites, with standalone Python 3.12 on PATH.
- Rotation tests cover dry-run/apply across all 18 installation grants and failure/revocation cases.

## Operational follow-up

- Production activation occurs through the canonical deployment flow or the documented standalone timer installer. This development task did not run a production deployment.

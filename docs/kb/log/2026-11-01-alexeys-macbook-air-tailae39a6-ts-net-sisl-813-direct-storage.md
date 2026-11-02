---
title: sisl-813-direct-storage
date: 2026-11-01
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# sisl-813-direct-storage

## Implementation

- Added authenticated direct URL issuance and commit routes, HMAC capabilities,
  node CORS/Range support and ordinary Core URL fallback.
- Reused durable multipart reservations and atomic node staging for direct PUT;
  commit rechecks ACL, quota and the reserved revision before publication.

## Evidence and documentation

- `protocol`: Shared URL request/response types and Core route handlers.
- `data-auth`: coordinator reservation, expiry and commit transactions.
- `server-internals`: node staging and signed request verification; SQL upload
  records already persist the required reservation fields without migration.
- `deploy`: Core config/runtime and node entrypoint secret/origin configuration.

## Verification

- Focused storage tests and the affected-test planner in `gate:task` cover
  tampering, expiry, size/MIME mismatch, restart, publication, quota and fallback.
- No credentials or deployment configuration were changed. Public TLS routing,
  independent per-node secret files and allowed UI origins require commissioning.

## Operational limits

- Issued read URLs remain capabilities for at most five minutes after revocation.
- Direct PUT retains the existing 64 MiB node buffer limit and multipart's
  conservative double node-capacity reservation for staging plus assembly.
- Browser UI switching belongs to the separate card.

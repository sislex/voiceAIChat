---
title: public-ip-acme
date: 2026-10-13
machine: desktop-7b0sobj
author: Nikolay
---

# public-ip-acme

## Changes

- Public-host Caddy TLS now selects the Let's Encrypt ACME issuer and shortlived profile. The internal caddy hostname retains its local CA.
- Added the public-issuer regression check and normalized CRLF when reading fixtures in the Caddy test suite.

## Validation

- All 8 infra.caddy.test.ts tests passed on Windows.
- The complete edited Caddyfile passed caddy validate in an isolated disposable container using the same image as production (Caddy 2.11.4). No production configuration was loaded or changed.
- gate:quick selected gate:all but failed before executing it: spawnSync npm ENOENT on Windows. The full gate has not passed.

## Knowledge topic

- docs/kb/deploy.md, HTTPS по IP: issuer, persistent storage, external acceptance and rollback.

## Pending

- Commit/push approval and a successful gate before managed deployment.
- Public issuance, trusted external HTTPS, authenticated login/WebSocket and renewal observation remain unverified. Existing production still uses its internal CA.
- kb:index was executed; unrelated generated index churn from this Windows checkout is excluded.

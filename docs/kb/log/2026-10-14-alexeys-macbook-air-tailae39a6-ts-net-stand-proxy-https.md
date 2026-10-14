---
title: stand-proxy-https
date: 2026-10-14
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# stand-proxy-https

## Changes

- Caddy terminates TLS for stand lease ports 8790–8794; the Compose overlay publishes these ports on Caddy and exposes Core listeners internally.
- Lease URLs use the configured public scheme, defaulting to the public URL protocol or HTTP. Inspector injection uses the lease origin; Make preserves the returned HTTPS URL.

## Findings

- TLS termination leaves Core's listener socket unencrypted, so its socket protocol cannot determine the public inspector URL.

## Documentation

- docs/kb/deploy.md (stand proxy configuration and commissioning).

## Validation and remaining commissioning

- Server typecheck passed. Focused tests: 89 passed, 6 listener tests require supervisor execution because the sandbox denies binding sockets.
- The task gate requires supervisor execution: its Git subprocess failed with EPERM. KB index regeneration also cannot read Git history in this sandbox; the generated index was restored to avoid unrelated status changes.
- Operator commissioning remains separate: trust the internal CA and verify browser login, SSE and WebSocket through Caddy.

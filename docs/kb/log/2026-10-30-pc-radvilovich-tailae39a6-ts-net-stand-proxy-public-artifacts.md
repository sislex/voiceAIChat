---
title: stand-proxy-public-artifacts
date: 2026-10-30
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# stand-proxy-public-artifacts

## Changes

- Allow credential-free HTTP GET/HEAD application frontend artifacts through live stand leases.
- Preserve authentication for other HTTP requests and all WebSocket upgrades.
- Add regression coverage for cookies, methods, traversal and lease expiry.

## Verified findings

- Application frontend routes are public, while the stand proxy previously required a session for every request.

## Documentation

- docs/kb/server-internals.md#dev-stand-access-proxy

## Open questions

- None.

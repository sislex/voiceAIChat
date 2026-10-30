---
title: stand-proxy-stable-cookie-keys
date: 2026-10-30
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# stand-proxy-stable-cookie-keys

## Changes

- Derived stand lease cookie keys with HMAC-SHA256 from the existing Core session signing secret and lease identity, truncated to 32 hex characters.
- Added HTTP regression coverage for proxy recreation, cookie reuse across listener ports and isolation of all identity fields and secrets.

## Verified findings

- Core already loads a persistent session signing secret from its data directory outside injected-database tests; StandProxy now receives that secret.
- The normalized effective hostname participates in lease identity; the allocated listener port and the Core page port do not.

## Documentation

- docs/kb/server-internals.md#dev-stand-access-proxy

## Remaining work

- None.

---
title: storage-direct-urls
date: 2026-11-01
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# storage-direct-urls

## Changes

Implemented additive direct URL/commit contracts, persistent quota reservations,
node HMAC verification, immutable uploads, Range downloads and configured CORS.
Added reservation, ACL, expiry, signature, size and Core fallback tests.

## Verified facts

Commit checks node HEAD without downloading bytes. Pending replacement shrink
does not release owner quota. Expired cleanup survives coordinator restart and
space deletion, and retries offline nodes.

## Updated topics

- docs/kb/protocol.md
- docs/kb/data-auth.md
- docs/kb/server-internals.md
- docs/kb/deploy.md

## Follow-up scope

The Core UI adoption remains a separate card.

---
title: stand-proxy-frame-ancestors
date: 2026-10-30
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# stand-proxy-frame-ancestors

## Changes

- Preserve the requesting Core origin on stand leases and rewrite framing response headers for nested previews.
- Add HTTP/HTTPS listener tests and CSP policy regression coverage.

## Verified facts added to the KB

- Make preview CSP restricts frame ancestors to self; the proxy now adds the original Core parent and lease origins to every enforced framing policy, preserving explicit denial.
- SAMEORIGIN is superseded by enforced frame-ancestors or replaced with an equivalent policy extended for the proxy ancestors.

## Updated topic

- docs/kb/server-internals.md#dev-stand-access-proxy

## Open questions

- None.

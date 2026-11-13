---
title: stand-proxy-hostname
date: 2026-10-30
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# Stand proxy hostname leases

## Changes

- Include the effective origin hostname in the lease reuse key.
- Add regression coverage for hostname-specific forwarding, inspector leases, publicHost reuse and pool exhaustion.

## Verified facts

- Request hostnames need separate lease origins because Core session cookies are host-scoped.
- URL parsing normalizes the hostname and excludes the request port from lease identity.
- A configured publicHost keeps a shared lease across request hosts.

## Documentation

- docs/kb/server-internals.md#dev-stand-access-proxy

## Remaining work

- None.

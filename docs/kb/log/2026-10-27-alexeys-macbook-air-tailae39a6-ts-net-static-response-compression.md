---
title: static-response-compression
date: 2026-10-27
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# static-response-compression

## Changes

- Added bounded, content-addressed static br/gzip compression and route-level regression tests.
- Enabled Caddy zstd/gzip for all public/internal site handlers with explicit streaming exclusions.
- Validated the Caddyfile with Caddy 2.10.2 and tested live JSON, SSE, exec-stream and WebSocket forwarding.
- Aligned the delayed-search browser test's interception wait with its existing SEARCH_TIMEOUT after the full fallback exposed the default one-second wait under load.

## Verified details

- Application frontend routes return buffers; bundled browser assets use Fastify static file streams. Both now share a compressed representation cache without consuming API streams.
- Caddy response MIME matching explicitly excludes SSE; exec-stream and upgrade requests bypass encode.

## Updated topics

- docs/kb/server-internals.md#http-response-compression
- docs/kb/deploy.md (deployment application profiles)

## Scope

- Development checkout only; production deployment remains in the release workflow.

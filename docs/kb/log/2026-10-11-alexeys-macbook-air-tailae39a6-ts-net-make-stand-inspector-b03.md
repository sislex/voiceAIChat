---
title: make-stand-inspector-b03
date: 2026-10-11
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# make-stand-inspector-b03

## Changes

- Added opt-in stand proxy leases and a reusable HTML inspector injection helper.
- Added fake-upstream coverage for compression, CSP, ordinary leases, SSE and WebSocket transport.

## Findings

- Injection mode is part of lease identity; chunked streams remain unbuffered.

## Documentation

- docs/kb/server-internals.md (Dev stand access proxy).

## Validation

- Direct server TypeScript check passed. Focused tests: 31 passed; five listener tests require supervisor execution because the sandbox denies listening on allocated ports (EPERM).
- Required npm gate and focused npm commands exited 255 without diagnostics. Direct task-gate execution reported `spawnSync git EPERM`; supervisor must run the task gate.

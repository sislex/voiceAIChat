---
title: sisl-815-storage-batch
date: 2026-11-01
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# sisl-815-storage-batch

## Changes

Implemented bounded NDJSON batches with ordered independent operation results,
streamed multipart reads, small-text inline listing, and node-side blob copy.
Added contract, coordinator, client, node and Core HTTP tests.

## Findings

Preflight conservatively counts writes/copies without crediting mutations that
may fail. Each operation rechecks quota and authorization. Copy uses a new blob
and never transfers file contents through Core. Existing node reads still buffer
one file; NDJSON requests retain the 64 MiB encoded body limit.

## Knowledge updates

- docs/kb/protocol.md
- docs/kb/data-auth.md
- docs/kb/server-internals.md

## Validation

- Required gate: npm run gate:task -- --base 15f87e3610de43c5d64eb44e5aba75ae23ff3eb6
  passed (54 tests and shared/file-storage/server typechecks).
- Focused test:files runs for routes, node/server, service, client and shared
  fileStorage passed.
- git fetch origin was denied by the sandbox network allowlist.
- No commit, push, deployment or persistent service was performed.

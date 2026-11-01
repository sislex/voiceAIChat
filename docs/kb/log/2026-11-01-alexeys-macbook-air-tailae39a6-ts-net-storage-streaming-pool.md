---
title: storage-streaming-pool
date: 2026-11-01
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# storage-streaming-pool

## Changes

Core raw PUT/GET now stream through a pooled undici client to temporary node files
and file read streams. The default maximum is 1 GiB and both services read
VC_FILE_STORAGE_MAX_FILE_BYTES. Legacy byte consumers retain readFile.

## Verified details

Unknown-length uploads count bytes inside the serialized metadata transaction;
failed writes preserve previous content and clean incomplete blobs. HTTP tests
exercise 200 MiB transfer with SHA-256 verification and bounded retained memory,
client abort, known/chunked overflow, quotas and connection reuse.
Integrated dev commit 15683f3a (storage thumbnails): thumbnail generation keeps
bounded byte collection under its separate 32 MiB source limit, including cached
reads through the streaming node client.

## Updated topics

- docs/kb/protocol.md
- docs/kb/server-internals.md
- docs/kb/data-auth.md
- docs/kb/deploy.md
- docs/kb/shared.md

---
title: storage-compression-freshness
date: 2026-11-01
machine: alexeys-macbook-air-tailae39a6-ts-net
author: voicechat-ci
---

# storage-compression-freshness

## Changes

Reviewed Shared changes since 47b29314 and server changes since 15f87e361,
including the compression implementation at 5730832e. Updated both existing
topics and refreshed their markers with the configured KB CLI.

## Verified facts

Storage has its own buffered-response compression and per-part multipart
compression. Raw uploads decode gzip/br through a bounded stream pipeline.
Shared also defines batch/inline, resumable-upload and thumbnail contracts
introduced since its previous freshness marker.

## Updated topics

- docs/kb/shared.md
- docs/kb/server-internals.md

## Validation

KB check no longer reports either repaired topic. Its remaining 22 warnings
match the pre-existing topics exempted by the reported workflow check.
No runtime code or gate command changed; the workflow will rerun its full step.

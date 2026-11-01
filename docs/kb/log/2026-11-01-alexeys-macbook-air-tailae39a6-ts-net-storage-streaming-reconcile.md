---
title: storage-streaming-reconcile
date: 2026-11-01
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# storage-streaming-reconcile

## Что сделано

Merged SISL-811 into current dev, retaining direct URLs, sessions, batch operations,
validators, Range, compression, thumbnails and raw chat uploads. Preserved both
branches' tests and added bounded-memory HTTP Range/gzip/Brotli coverage.

## Что выяснили (факты, которых не было в KB)

Ordinary Core and node PUTs stream; async chat uploads retain putStream compatibility.
Upload reservations remain charged during streamed writes. Core GET uses openFile
for Range and full downloads; compression transforms the response stream.

## Куда занесено

- docs/kb/server-internals.md
- docs/kb/data-auth.md
- docs/kb/protocol.md
- docs/kb/deploy.md

## Открытые вопросы / что осталось

None.

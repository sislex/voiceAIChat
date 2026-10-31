---
title: storage-http-cache-range
date: 2026-11-01
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# storage-http-cache-range

## Changes

Added shared HTTP validators and single-range parsing, metadata-first Core
revalidation, streaming node/client downloads and the same handling for chat
attachments. Added contract, Core route, chat and real HTTP node tests.

## Verified findings

The previous node GET and HTTP client both buffered entire blobs and did not
support Range. Core evaluated ETag only after reading node bytes. The new
prepareFileRead method authorizes before validators and binds reads to the
selected blob. Ordinary chat reads preserve their JSON/base64 response.

## Updated topics

- docs/kb/protocol.md
- docs/kb/server-internals.md
- docs/kb/data-auth.md

## Remaining work

None.

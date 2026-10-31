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

## Project gate repair: freshness evidence

The project gate passed code checks but rejected nine stale KB topics.
Reviewed each topic's areas and the source diff from its recorded checked SHA
to bc7b06d9 before updating freshness markers:

- architecture.md (47b29314): storage client/node/coordinator changes in
  15683f3a, 15f87e36, 91891a52 and bc7b06d9; reviewed thumbnail reads,
  multipart reservations/composition, batch/copy and streaming downloads.
  Added the missing architecture summary.
- shared.md (47b29314): fileStorage.ts and its tests, plus the optional
  thumbnailAvailable fields in types.ts/protocol.ts. Added validators,
  range parsing, upload, batch, inline-content and thumbnail contract notes.
- conversation-groups.md (8bb433d2): tracked contract/REST changes only add
  attachment thumbnail metadata and replace the storage file-read handler.
  Group routes, membership, archive behavior and persistence are unchanged.
- features/kanban-assistant.md (dab1b380): protocol.ts adds upload thumbnail
  metadata, server.ts exposes it for storage uploads, rest.ts delegates storage
  reads. Widget contracts, relay, autonomy and Kanban bridges are unchanged.
- features/make-browser.md (dab1b380): server.ts storage upload metadata and
  rest.ts storage read handling only; browser binding and turn targets are unchanged.
- features/playwright-reader.md (f1d5fd04c): types.ts adds attachment thumbnail
  metadata and rest.ts changes storage reads; Reader bridges and browser routes
  are unchanged.
- machines.md (c17fb5ae): tracked protocol.ts/rest.ts changes concern storage
  attachments only; documented their HTTP behavior and preserved machine branch.
- projects.md (f1d5fd04c): tracked changes are attachment thumbnail metadata in
  types.ts and the storage branch in rest.ts; project contracts, task persistence
  and Kanban bridges are unchanged.
- ui.md (dab1b380): storage upload thumbnail metadata and storage attachment
  HTTP reads; documented the consumer behavior. Pinned frontend registration,
  artifacts, group contracts and telemetry are unchanged.

No runtime code, area masks or gate commands were changed for this repair.
The workflow reruns the project gate after this commit.

## Remaining work

None.

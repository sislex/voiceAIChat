---
title: sm37-storage-space-title
date: 2026-10-31
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# sm37-storage-space-title

## Changes

Added owner-only PATCH for storage space titles, backed by a metadata transaction.
Tests cover ownership, input validation and preservation of files, ref and shares.

## Verified knowledge

Core dev 768067e2 had GET and DELETE for a space, but no title mutation.
Make's SM-37 title synchronization therefore requires this paired Core endpoint.
An isolated HTTP acceptance run used this checkout's routes/coordinator and a
real disk-backed storage node, plus modified Make and a copy of cf2fda81's local
tree. Three concurrent imports created one space; five files were copied once,
and title synchronization succeeded. Authentication and title were fixtures.

## Documentation

- docs/kb/server-internals.md, Core file storage
- packages/file-storage/README.md

## Validation

`npm run gate:fast` completed with exit 0, including Core, knowledge, storage,
Shared, automation-runner and component-runtime checks. Core reported 2500
passed tests and 40 normal skips; storage reported 29 and Shared 1317 passed.
The focused storage route suite passed all six tests. No full gate was invoked.

## Boundary

Existing duplicate spaces on the live M2 stand were not deleted or merged.
Cross-process creation idempotency remains a separate Core task.

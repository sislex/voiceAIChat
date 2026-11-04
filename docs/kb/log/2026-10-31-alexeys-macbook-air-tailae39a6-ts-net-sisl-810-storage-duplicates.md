---
title: sisl-810-storage-duplicates
date: 2026-10-31
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# sisl-810-storage-duplicates

## Changes

- Deterministic same-path merge with lossless archive destinations in previews.
- Token-only apply and canonical-first lists for memory and SQL metadata.
- Regression coverage for three duplicates, archive collisions and HTTP cleanup.

## Verified findings

- Cross-space freshness uses updatedAt before revision because revisions are local.
- SQL canonical identities are stored separately from legacy spaces.
- Make reads and import share its project lookup; Core ordering must be paired.

## Topics updated

- docs/kb/server-internals.md
- docs/kb/protocol.md

## Live validation boundary

- Existing M2 Core endpoints on ports 28787 and 32787 return 401 without a session.
- Live duplicate cleanup and browser verification require authenticated stand access
  and delivery of this branch; fixture tests do not establish that live cleanup occurred.

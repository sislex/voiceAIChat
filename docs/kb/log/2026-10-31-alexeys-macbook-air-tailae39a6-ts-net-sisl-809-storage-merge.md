---
title: sisl-809-storage-merge
date: 2026-10-31
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# sisl-809-storage-merge

## Changes

- Enforced the trimmed 1..200 title limit on the existing owner-only PATCH.
- Added owner-only duplicate merge previews and transactional apply with stale-preview and path-conflict protection.
- Added HTTP authorization/validation and memory/SQL metadata contract tests.

## Verified behavior

- Merge selects the most-files space, moves unique entries without node I/O, revokes removed spaces' shares and restores canonical identity.
- Saved references to removed space IDs are not rewritten; conflicting blob paths block apply.

## Topics updated

- docs/kb/protocol.md
- docs/kb/data-auth.md

## Operational scope

- No live stand or production data was modified.

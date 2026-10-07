---
title: contracts-release
date: 2026-10-07
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# contracts-release

## Changes

- Added the contract release CLI for detached owner workspace packs and Shared builds.
- Added real fixture repository tests for Core and consumer pins, peer conflicts,
  dirty-source rejection and the Shared adapter.
- Documented explicit consumer paths, content hashes, provenance and partial-failure retry semantics.

## Knowledge topics

- docs/kb/shared.md
- docs/kb/deploy.md

## Validation

- Focused JavaScript typecheck passed.
- Fixture Git subprocesses and the task gate require supervisor execution:
  this sandbox returns `spawnSync git EPERM`.
- KB touch/index were attempted, but Git subprocess restrictions prevent accurate
  freshness calculation. Existing checked markers and the generated index were
  preserved; the supervisor should regenerate the index outside the sandbox.

---
title: vendor-archive-publication
date: 2026-10-14
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# vendor-archive-publication

## Changes

- Documented the vendor archive retention rule and added a regression covering owner publication after replacement removes the old archive.

## Findings

- The reviewed archive cleanup and tooling checks are already present in this checkout; publication reads pins, while release composition replaces them and performs cleanup.

## Topic

- docs/kb/features/releases.md

## Validation

- Focused tests require supervisor validation: child process execution fails with `spawnSync git EPERM` and `spawnSync tar EPERM` in the sandbox.
- The task gate cannot read its diff (`spawnSync git EPERM`). Clean installation validation is deferred to the supervisor; no dependencies or lockfiles were changed.
- KB touch and index were attempted; their Git history reads were unavailable, so existing checked metadata and the generated index were preserved for supervisor regeneration.

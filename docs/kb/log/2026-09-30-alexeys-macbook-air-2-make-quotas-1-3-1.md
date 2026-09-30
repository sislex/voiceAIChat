---
title: make-quotas-1-3-1
date: 2026-09-30
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Make 1.3.1 storage quotas

## Change

- Updated the current Core knowledge topic with the limits verified in the running Make 1.3.1 image.
- Marked the 64 MiB project and 512 MiB user limits as historical values.

## Evidence

- The production Make container reports commit `e43736e6ce6ac68a998683b3a1ca31cea9a4597e` and `MAKE_LIMITS.maxProjectBytes=268435456`, `maxUserBytes=2147483648`.
- The reported project's files, snapshots, and story PNGs total 68.71 MiB, which is below the current project quota.

## Knowledge topic

- `docs/kb/protocol.md` — Make storage quotas and cleanup.

## Remaining

- A live Make chat may retain old context. Confirm its answer against the current `/api/make/:id/usage` response after the knowledge source is refreshed.

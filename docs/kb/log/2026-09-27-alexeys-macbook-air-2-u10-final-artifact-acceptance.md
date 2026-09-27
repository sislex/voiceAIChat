---
title: u10-final-artifact-acceptance
date: 2026-09-27
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# u10-final-artifact-acceptance

## Changes

- Pinned 13 published S2 owner archives to Core manifests, lockfile and vendor inventory.
- Verified the final Core UI 1.4.3 and Desktop 1.0.6 archives against their release provenance and checksums.
- Adjusted only Account CSS route ceilings for the measured layout correction in Core UI 1.4.3.

## Verified facts

- The previous Core UI Make host selected the standalone default export from the new Make artifact; the corrected host selects `pane` and accepts the legacy default only when `pane` is absent.
- The Account Identity panel must retain its natural height to keep Analytics from covering mobile controls.
- Fresh Account measurements were Web navigation 387,679 raw / 67,484 gzip / 54,185 Brotli and Electron 384,293 raw / 67,027 gzip / 53,864 Brotli bytes; the adjusted limits cover these values without changing other routes.

## Knowledge base

- `docs/kb/testing-operations.md` describes installed-byte and system-owner acceptance.
- The Core UI owner KB records Make export compatibility and Account layout.

## Remaining work

- Run the complete Core release gate on the committed final source and attach its immutable log to U10 owner review.

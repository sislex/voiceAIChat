---
title: production-cleanup-candidates
date: 2026-09-20
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# production-cleanup-candidates

## Read-only findings

Measured Docker references, host caches, logs, backup and project directory sizes.
No reclaimable images or build cache remain. Re-downloadable npm/apt/Electron and
Playwright caches, journal retention and compression of rotated syslog are the
main candidates. Historical CLI profiles and backups require separate retention
choices. No additional files, containers or volumes were deleted.

## Knowledge updated

- docs/kb/deploy.md: measured candidates, active-use checks and retention boundaries.

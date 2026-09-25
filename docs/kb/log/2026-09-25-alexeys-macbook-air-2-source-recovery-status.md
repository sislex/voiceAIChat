---
title: Source recovery read-only status lease
date: 2026-09-25
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Source recovery read-only status lease

The v2 owner previously rejected status using the active effect epoch because the
read action differed from the stored deploy/recover action. Status now accepts
that epoch only with the identical lease ID and immutable operation, after its
own live action authorization under the shared host lock. It returns before any
journal write, so a higher-epoch read also leaves the effect fence unchanged.

Real process regressions cover same/higher-epoch reads, unchanged journal and
runtime calls, wrong lease and operation rejection, revocation and independent
status authorization. The planner selected `gate:all`; the complete final gate passed in 272.84 seconds.
The fresh Linux fixture passed all 18 tests with exit 0, no remaining private
processes, completed cleanup, 55,910,400-byte memory peak and no OOM/high/max
pressure events. The patch secret scanner also passed.

Initial preparation failures were corrected without weakening owner checks:
the runtime was moved from shared `/private/tmp` to a private home directory,
and `npm rebuild` supplied the native SQLite binding omitted by the initial
`npm ci --ignore-scripts`. These failed preparations are not counted as passes. No production deployment or installer change is included.

Current behavior is documented in `docs/kb/deploy.md`.

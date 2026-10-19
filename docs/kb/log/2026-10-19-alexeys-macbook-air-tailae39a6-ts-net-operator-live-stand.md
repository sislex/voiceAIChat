---
title: operator-live-stand
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Operator live stand workflow

## Changes

Added the authenticated live preview CLI with private operation journals, replay protection and read-only recovery after interrupted observation. Configuration uses a token file, never an inline credential. Documented the preview workflow separately from task and promotion gates.

## Verified behavior

On the M2 development stand, first attachment completed in 28 seconds and a warm attachment in 16 seconds. A temporary page-title edit became visible through the stand gateway in Chromium after 387 ms while the task gate was still running. The actual task gate exited 0 after 17 seconds; the title edit was restored.

An initial stop failed with `machine_unavailable` during an agent disconnect; automatic reconciliation returned the stand to its frozen base. This is not counted as successful restoration. After reconnect, attachment succeeded and a second stop restored the recorded previous SHA in 4 seconds; gateway health remained healthy. CLI tests cover lost responses and transient observation failure without replaying mutations.

## Knowledge updated

- docs/kb/deploy.md

## Validation

Full Core `gate:quick -- --base ae19ce2b952851d86d69ed1e081b90acdddf499b` selected `gate:all` and exited 0. All 8 CLI regression tests passed after the observation-recovery change. This change does not publish a product release.

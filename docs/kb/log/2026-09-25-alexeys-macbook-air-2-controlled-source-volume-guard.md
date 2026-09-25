---
title: controlled-source-volume-guard
date: 2026-09-25
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Controlled source storage guard

## Changes

- Rejected anonymous Compose volumes and inherited volume mounts before replacement.
- Required image-declared storage destinations to be covered by explicit pinned bind or existing named-volume mounts.
- Added positive named-volume coverage and both missing-storage regressions.
- Made fixture cleanup fail if its inherited kernel lock remains held.

## Validation

- Initial Linux process fixture passed 13 checks with no remaining fixture processes; it did not cover the newly identified storage gap.
- The final gate planner selected `npm run gate:all`, which passed with exit 0 in 259.16 seconds.
- Updated Linux process regressions passed 16 tests with exit 0, no remaining fixture processes and completed cleanup. Peak cgroup memory was 56,352,768 bytes with no memory/OOM events. Docker calls remain deterministic fixtures; no production release was performed.

## Documentation

- docs/kb/deploy.md
- docs/delivery-release-adapter.md

## Remaining work

- Install the immutable launcher/helper pair and commission the downstream adapter separately.
